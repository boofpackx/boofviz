import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { lrcFileName, matchKey, normalizeTitle, parseLrc, type TrackLyrics } from '@shared/lyrics';

/**
 * Lyrics lookup for a Spotify track: the user's .lrc folder first, then the
 * on-disk cache, then LRCLIB (/get, then /search with a ±2 s duration match).
 * No Electron imports: fetch, folders and the clock are injected.
 */

export const LRCLIB_USER_AGENT = 'BOOFVIZ (https://github.com/boofpackx/boofviz)';
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const DURATION_TOLERANCE_S = 2;

export interface TrackInfo {
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
}

export interface LyricsDeps {
  fetch: typeof fetch;
  now: () => number;
  /** The user's .lrc folder ("Artist - Title.lrc" and other namings, subfolders too). */
  lyricsDir: string;
  /** JSON cache keyed by Spotify track id. */
  cacheDir: string;
  baseUrl: string;
  online: () => boolean;
}

interface LrclibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface CacheEntry {
  fetchedAt: number;
  found: boolean;
  synced?: string | null;
  plain?: string | null;
  instrumental?: boolean;
}

/** TrackLyrics from LRC (or plain) text. */
export function lyricsFromText(trackId: string, source: TrackLyrics['source'], text: string | null | undefined, plain?: string | null, instrumental = false): TrackLyrics {
  const lines = text ? parseLrc(text).lines : [];
  const synced = lines.some((l) => l.text) ? lines : null;
  // A file without timestamps is plain lyrics.
  const plainText = plain ?? (!synced && text && !/^\s*\[\d/m.test(text) ? text.trim() : null);
  return { trackId, source, synced, plain: plainText || null, instrumental };
}

export class LyricsService {
  private index: { at: number; map: Map<string, string[]> } | null = null;

  constructor(private readonly deps: LyricsDeps) {}

  /** `fresh`: ignore a cached miss (better metadata arrived). */
  async lookup(track: TrackInfo, fresh = false): Promise<TrackLyrics> {
    const file = await this.fromFiles(track);
    if (file) return file;
    const cached = await this.readCache(track.id);
    if (cached) {
      if (cached.found) return lyricsFromText(track.id, 'cache', cached.synced, cached.plain, cached.instrumental);
      if (!fresh && this.deps.now() - cached.fetchedAt < NOT_FOUND_TTL_MS) return none(track.id);
    }
    if (!this.deps.online()) return none(track.id);
    let rec: LrclibRecord | null;
    try {
      rec = await this.fromLrclib(track);
    } catch {
      // Network trouble: don't cache a miss, try again next time.
      return none(track.id);
    }
    if (!rec) {
      await this.writeCache(track.id, { fetchedAt: this.deps.now(), found: false });
      return none(track.id);
    }
    const entry: CacheEntry = { fetchedAt: this.deps.now(), found: true, synced: rec.syncedLyrics ?? null, plain: rec.plainLyrics ?? null, instrumental: rec.instrumental === true };
    await this.writeCache(track.id, entry);
    return lyricsFromText(track.id, 'lrclib', entry.synced, entry.plain, entry.instrumental);
  }

  /** Save dropped .lrc text for a track (it then wins over the cache and LRCLIB). */
  async saveLrc(track: TrackInfo, text: string): Promise<TrackLyrics> {
    await fsp.mkdir(this.deps.lyricsDir, { recursive: true });
    this.index = null;
    const name = lrcFileName(track.artists[0] ?? '', track.title);
    await fsp.writeFile(join(this.deps.lyricsDir, name), text, 'utf8');
    return lyricsFromText(track.id, 'file', text);
  }

  /** Forget the folder index (files were added, changed or removed). */
  invalidateFiles(): void {
    this.index = null;
  }

  /**
   * The track's lyrics from the user's folder (subfolders too), matched by
   * file name ("Artist - Title", "Title - Artist", "01. Title", the Spotify
   * track id, or the title alone when only one file has it) or by the
   * [ar:] / [ti:] tags inside the file. Null when no file matches or it holds no lyrics.
   */
  async fromFiles(track: TrackInfo): Promise<TrackLyrics | null> {
    const index = await this.fileIndex();
    if (!index.size) return null;
    const full = track.artists[0] ?? '';
    const artists = [...new Set([full, track.artists.join(', '), track.artists.join(' & '), track.artists.join('; '), primaryArtist(full)].filter(Boolean))];
    const titles = [...new Set([track.title, normalizeTitle(track.title)].filter(Boolean))];
    const keys: string[] = [];
    if (/^[0-9A-Za-z]{22}$/.test(track.id)) keys.push(`id:${track.id}`);
    for (const t of titles) for (const a of artists) keys.push(matchKey(`${a} - ${t}`), matchKey(`${t} - ${a}`));
    for (const key of keys) {
      const hit = index.get(key);
      if (hit?.length) return this.readLrc(track.id, hit[0]);
    }
    // The title alone, only when a single file has it (common titles would match the wrong song).
    for (const t of titles) {
      const hit = index.get(matchKey(t));
      if (hit?.length === 1) return this.readLrc(track.id, hit[0]);
    }
    return null;
  }

  private async readLrc(trackId: string, path: string): Promise<TrackLyrics | null> {
    try {
      const l = lyricsFromText(trackId, 'file', decodeText(await fsp.readFile(path)));
      // A file still being written (or empty) is not a match yet.
      return l.synced || l.plain ? l : null;
    } catch {
      return null;
    }
  }

  /** key → .lrc paths, rebuilt after a change (or a minute, without a folder watcher). */
  private async fileIndex(): Promise<Map<string, string[]>> {
    if (this.index && this.deps.now() - this.index.at < 60000) return this.index.map;
    const map = new Map<string, string[]>();
    const add = (key: string, path: string): void => {
      if (!key || key === 'id:') return;
      const list = map.get(key) ?? [];
      if (!list.includes(path)) list.push(path);
      map.set(key, list);
    };
    let count = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const path = join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 3) await walk(path, depth + 1);
          continue;
        }
        if (!/\.lrc$/i.test(e.name) || ++count > 20000) continue;
        const base = e.name.replace(/\.lrc$/i, '');
        add(matchKey(base), path);
        add(matchKey(base.replace(/^\d{1,3}\s*[.\-_)]\s*/, '')), path);
        const id = /(?:^|[^0-9A-Za-z])([0-9A-Za-z]{22})(?:$|[^0-9A-Za-z])/.exec(base);
        if (id && /\d/.test(id[1]) && /[A-Za-z]/.test(id[1])) add(`id:${id[1]}`, path);
        // [ti:] and [ar:] tags at the top of the file.
        try {
          const fh = await fsp.open(path, 'r');
          const buf = Buffer.alloc(2048);
          const { bytesRead } = await fh.read(buf, 0, 2048, 0);
          await fh.close();
          const head = decodeText(buf.subarray(0, bytesRead));
          const ti = /\[ti:([^\]]*)\]/i.exec(head)?.[1]?.trim();
          const ar = /\[ar:([^\]]*)\]/i.exec(head)?.[1]?.trim();
          if (ti) {
            add(matchKey(ti), path);
            add(matchKey(normalizeTitle(ti)), path);
            if (ar) {
              for (const a of new Set([ar, primaryArtist(ar)])) {
                add(matchKey(`${a} - ${ti}`), path);
                add(matchKey(`${a} - ${normalizeTitle(ti)}`), path);
              }
            }
          }
        } catch {
          // Unreadable: matched by name only.
        }
      }
    };
    await walk(this.deps.lyricsDir, 0);
    this.index = { at: this.deps.now(), map };
    return map;
  }

  private async lrclib(path: string, params: Record<string, string>): Promise<unknown> {
    const res = await this.deps.fetch(`${this.deps.baseUrl}${path}?${new URLSearchParams(params)}`, { headers: { 'User-Agent': LRCLIB_USER_AGENT, Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
    return res.json();
  }

  /**
   * /get with the exact title, then the normalized one (and the first artist
   * when one name holds several); then /search for synced lyrics within ±2 s
   * (any length when it isn't known).
   */
  private async fromLrclib(track: TrackInfo): Promise<LrclibRecord | null> {
    const full = track.artists[0] ?? '';
    const first = primaryArtist(full);
    const artists = first && first !== full ? [full, first] : [full];
    const durationS = Math.round(track.durationMs / 1000);
    const norm = normalizeTitle(track.title);
    const titles = norm !== track.title ? [track.title, norm] : [track.title];
    let fallback: LrclibRecord | null = null;
    if (durationS > 0) {
      for (const artist of artists) {
        for (const title of titles) {
          const rec = (await this.lrclib('/get', { track_name: title, artist_name: artist, album_name: track.album, duration: String(durationS) })) as LrclibRecord | null;
          if (rec?.syncedLyrics) return rec;
          if (rec && !fallback && (rec.plainLyrics || rec.instrumental)) fallback = rec;
        }
      }
    }
    const results = await this.lrclib('/search', { track_name: norm, artist_name: first || full });
    if (Array.isArray(results)) {
      const close = (r: LrclibRecord): boolean => durationS <= 0 || (typeof r.duration === 'number' && Math.abs(r.duration - track.durationMs / 1000) <= DURATION_TOLERANCE_S);
      const hit = (results as LrclibRecord[]).find((r) => r.syncedLyrics && close(r));
      if (hit) return hit;
      fallback ??= (results as LrclibRecord[]).find((r) => (r.plainLyrics || r.instrumental) && close(r)) ?? null;
    }
    return fallback;
  }

  private cacheFile(trackId: string): string {
    return join(this.deps.cacheDir, `${trackId.replace(/[^\w-]/g, '_')}.json`);
  }

  private async readCache(trackId: string): Promise<CacheEntry | null> {
    try {
      return JSON.parse(await fsp.readFile(this.cacheFile(trackId), 'utf8')) as CacheEntry;
    } catch {
      return null;
    }
  }

  private async writeCache(trackId: string, entry: CacheEntry): Promise<void> {
    try {
      await fsp.mkdir(this.deps.cacheDir, { recursive: true });
      await fsp.writeFile(this.cacheFile(trackId), JSON.stringify(entry), 'utf8');
    } catch {
      // A read-only profile just means no cache.
    }
  }
}

/** The first of several artists named in one string ("A, B", "A feat. B", "A & B"). */
export function primaryArtist(name: string): string {
  return name.split(/\s*,\s*|\s+(?:feat\.?|ft\.?|featuring|x|&|and)\s+/i)[0]?.trim() ?? name;
}

/** File text as UTF-8, or UTF-16 when it starts with a byte-order mark. */
function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))).swap16().toString('utf16le');
  return buf.toString('utf8');
}

function none(trackId: string): TrackLyrics {
  return { trackId, source: 'none', synced: null, plain: null, instrumental: false };
}
