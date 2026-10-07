import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app, net, protocol, shell } from 'electron';
import { archiveQuery, cacheName, parseLength, pickArchiveFile, VIDEO_EXT, type ArchiveClip, type ArchiveFile, type ArchiveRequest } from '@shared/archive';
import { hashSlot } from './archiveHash';

/**
 * Archive footage: searches the Internet Archive, downloads one clip at a
 * time into a size-capped disk cache, and serves it to both windows over a
 * private boofviz-archive:// scheme (with range requests, so the players
 * can seek). The same slot always resolves to the same clip, so preview and
 * output play the same film.
 */

export const ARCHIVE_SCHEME = 'boofviz-archive';
const env = (key: string, fallback: string): string => (process.env[key] || fallback).replace(/\/+$/, '');
const BASE = env('BOOFVIZ_ARCHIVE_URL', 'https://archive.org');
const CACHE_LIMIT = 3 * 1024 * 1024 * 1024;
const SLOT_MEMORY = 64;
/** How long a slot waits for fresh footage before falling back to the cache. */
const FRESH_WAIT_MS = Number(process.env.BOOFVIZ_ARCHIVE_WAIT_MS || 7000);

interface Doc {
  identifier: string;
  title?: string;
  year?: string | number;
}

/** Call before app ready. */
export function registerArchiveScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ARCHIVE_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }]);
}

export class ArchiveService {
  private readonly dir = join(app.getPath('userData'), 'archive-cache');
  /** The user's own clips (music videos, home movies...) for the archive and TV looks. */
  readonly videosDir = join(app.getPath('userData'), 'videos');
  private readonly docs = new Map<string, Promise<Doc[]>>();
  private readonly slots = new Map<string, Promise<ArchiveClip | null>>();
  private readonly recent: string[] = [];
  private readonly downloads = new Map<string, Promise<string>>();

  start(): void {
    protocol.handle(ARCHIVE_SCHEME, (req) => this.serve(req));
  }

  /** The clip for a slot (resolving and downloading it the first time it is asked for). */
  clip(req: ArchiveRequest): Promise<ArchiveClip | null> {
    if (req.collection === 'myvideos') return this.localClip(req.slot);
    const key = `${archiveQuery(req)}|${Math.round(req.slot)}`;
    let p = this.slots.get(key);
    if (!p) {
      // Fresh footage when it arrives in time; otherwise something already on disk, so
      // the screen always has a picture (the download carries on and fills the cache).
      const fresh = this.resolve(req).catch((err) => {
        console.warn('BOOFVIZ archive:', String(err));
        return null;
      });
      const wait = new Promise<null>((r) => setTimeout(() => r(null), FRESH_WAIT_MS));
      p = Promise.race([fresh, wait]).then(async (clip) => clip ?? (await this.cachedClip(req.slot)) ?? (await fresh));
      p.then((clip) => {
        if (!clip) this.slots.delete(key);
      });
      this.slots.set(key, p);
      if (this.slots.size > SLOT_MEMORY) this.slots.delete(this.slots.keys().next().value!);
    }
    return p;
  }

  /** A clip already in the download cache, or one of the user's own (for offline and slow moments). */
  private async cachedClip(slot: number): Promise<ArchiveClip | null> {
    const cached = (await fs.readdir(this.dir).catch(() => [] as string[])).filter((n) => VIDEO_EXT.test(n)).sort();
    if (cached.length) {
      const name = cached[Math.floor(hashSlot(slot + 31) * cached.length)];
      const id = name.split('__')[0];
      return { id, title: id.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2'), year: null, url: `${ARCHIVE_SCHEME}://cache/${encodeURIComponent(name)}`, duration: 0, seed: hashSlot(slot + 97) };
    }
    return this.localClip(slot);
  }

  /** A clip from the user's videos folder: the same file for the same slot, never the same one twice running. */
  private async localClip(slot: number): Promise<ArchiveClip | null> {
    await fs.mkdir(this.videosDir, { recursive: true });
    const names = (await fs.readdir(this.videosDir).catch(() => [] as string[])).filter((n) => VIDEO_EXT.test(n) && !n.startsWith('.')).sort();
    if (!names.length) return null;
    const pick = (s: number): number => Math.floor(hashSlot(s) * names.length);
    let i = pick(slot);
    if (names.length > 1 && i === pick(slot - 1)) i = (i + 1) % names.length;
    const name = names[i];
    return { id: `local:${name}`, title: name.replace(VIDEO_EXT, '').replace(/[_]+/g, ' '), year: null, url: `${ARCHIVE_SCHEME}://local/${encodeURIComponent(name)}`, duration: 0, seed: hashSlot(slot + 7777) };
  }

  async openVideosFolder(): Promise<void> {
    await fs.mkdir(this.videosDir, { recursive: true });
    await shell.openPath(this.videosDir);
  }

  private async json<T>(url: string): Promise<T> {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'BOOFVIZ (audio visualizer)' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return (await res.json()) as T;
  }

  /** A pool of matching items (a few random result pages, cached per query). */
  private search(q: string): Promise<Doc[]> {
    let p = this.docs.get(q);
    if (!p) {
      p = (async () => {
        const url = (rows: number, page: number): string =>
          `${BASE}/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&rows=${rows}&page=${page}&output=json`;
        const head = await this.json<{ response: { numFound: number } }>(url(0, 1));
        const rows = 50;
        const pages = Math.max(1, Math.ceil(Math.min(head.response.numFound, 10000) / rows));
        const picks = new Set<number>();
        while (picks.size < Math.min(3, pages)) picks.add(1 + Math.floor(Math.random() * pages));
        const lists = await Promise.all([...picks].map((pg) => this.json<{ response: { docs: Doc[] } }>(url(rows, pg)).then((r) => r.response.docs)));
        return lists.flat().filter((d) => d.identifier);
      })();
      p.catch(() => this.docs.delete(q));
      this.docs.set(q, p);
    }
    return p;
  }

  private async resolve(req: ArchiveRequest): Promise<ArchiveClip | null> {
    let docs = await this.search(archiveQuery(req));
    if (!docs.length) docs = await this.search(archiveQuery({ ...req, collection: 'ephemeral', search: '' }));
    const fresh = docs.filter((d) => !this.recent.includes(d.identifier));
    const pool = fresh.length ? fresh : docs;
    for (let tries = 0; tries < 6 && pool.length; tries++) {
      const doc = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const meta = await this.json<{ files?: ArchiveFile[]; metadata?: { title?: string; year?: string; date?: string } }>(`${BASE}/metadata/${encodeURIComponent(doc.identifier)}`).catch(() => null);
      const file = meta?.files ? pickArchiveFile(meta.files) : null;
      if (!file) continue;
      const name = await this.download(doc.identifier, file.name);
      this.recent.push(doc.identifier);
      if (this.recent.length > 40) this.recent.shift();
      const year = Number(doc.year ?? meta?.metadata?.year ?? String(meta?.metadata?.date ?? '').slice(0, 4)) || null;
      return {
        id: doc.identifier,
        title: String(doc.title ?? meta?.metadata?.title ?? doc.identifier).slice(0, 120),
        year,
        url: `${ARCHIVE_SCHEME}://cache/${encodeURIComponent(name)}`,
        duration: parseLength(file.length),
        seed: Math.random(),
      };
    }
    return null;
  }

  /** Download into the cache (once), returning the cache file name. */
  private download(id: string, file: string): Promise<string> {
    const name = cacheName(id, file);
    let p = this.downloads.get(name);
    if (!p) {
      p = (async () => {
        await fs.mkdir(this.dir, { recursive: true });
        const dest = join(this.dir, name);
        try {
          await fs.access(dest);
          const now = new Date();
          await fs.utimes(dest, now, now);
          return name;
        } catch {
          // Not cached yet.
        }
        const res = await net.fetch(`${BASE}/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`);
        if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
        const tmp = `${dest}.part`;
        await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(tmp));
        await fs.rename(tmp, dest);
        void this.prune();
        return name;
      })();
      p.catch(() => this.downloads.delete(name));
      this.downloads.set(name, p);
    }
    return p;
  }

  /** Keep the cache under its size limit (oldest first). */
  private async prune(): Promise<void> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    const stats = await Promise.all(names.filter((n) => !n.endsWith('.part')).map(async (n) => ({ n, s: await fs.stat(join(this.dir, n)) })));
    let total = stats.reduce((a, x) => a + x.s.size, 0);
    for (const { n, s } of stats.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs)) {
      if (total <= CACHE_LIMIT) break;
      await fs.rm(join(this.dir, n), { force: true });
      total -= s.size;
    }
  }

  /** Serve a cached file with HTTP range support. */
  private async serve(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if ((url.host !== 'cache' && url.host !== 'local') || !name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return new Response('not found', { status: 404 });
    const file = join(url.host === 'local' ? this.videosDir : this.dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) return new Response('not found', { status: 404 });
    const ext = name.split('.').pop()?.toLowerCase() ?? 'mp4';
    const type = ext === 'webm' ? 'video/webm' : ext === 'ogv' ? 'video/ogg' : ext === 'mov' ? 'video/quicktime' : ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';
    const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (range) {
      if (range[1]) start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
      if (!range[1] && range[2]) start = Math.max(0, stat.size - Number(range[2]));
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
    return new Response(stream, { status, headers });
  }
}
