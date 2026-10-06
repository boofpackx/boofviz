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
  /** User .lrc files named "Artist - Title.lrc". */
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
  constructor(private readonly deps: LyricsDeps) {}

  async lookup(track: TrackInfo): Promise<TrackLyrics> {
    const file = await this.fromFiles(track);
    if (file) return file;
    const cached = await this.readCache(track.id);
    if (cached) {
      if (cached.found) return lyricsFromText(track.id, 'cache', cached.synced, cached.plain, cached.instrumental);
      if (this.deps.now() - cached.fetchedAt < NOT_FOUND_TTL_MS) return none(track.id);
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
    const name = lrcFileName(track.artists[0] ?? '', track.title);
    await fsp.writeFile(join(this.deps.lyricsDir, name), text, 'utf8');
    return lyricsFromText(track.id, 'file', text);
  }

  private async fromFiles(track: TrackInfo): Promise<TrackLyrics | null> {
    let names: string[];
    try {
      names = (await fsp.readdir(this.deps.lyricsDir)).filter((n) => /\.lrc$/i.test(n));
    } catch {
      return null;
    }
    if (!names.length) return null;
    const byKey = new Map(names.map((n) => [matchKey(n.replace(/\.lrc$/i, '')), n]));
    const artists = [track.artists[0] ?? '', track.artists.join(', '), track.artists.join(' & ')];
    const titles = [track.title, normalizeTitle(track.title)];
    for (const title of titles) {
      for (const artist of artists) {
        const name = byKey.get(matchKey(`${artist} - ${title}`));
        if (!name) continue;
        try {
          return lyricsFromText(track.id, 'file', await fsp.readFile(join(this.deps.lyricsDir, name), 'utf8'));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  private async lrclib(path: string, params: Record<string, string>): Promise<unknown> {
    const res = await this.deps.fetch(`${this.deps.baseUrl}${path}?${new URLSearchParams(params)}`, { headers: { 'User-Agent': LRCLIB_USER_AGENT, Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
    return res.json();
  }

  /** /get with the exact title, then the normalized one; then /search for synced lyrics within ±2 s. */
  private async fromLrclib(track: TrackInfo): Promise<LrclibRecord | null> {
    const artist = track.artists[0] ?? '';
    const durationS = Math.round(track.durationMs / 1000);
    const norm = normalizeTitle(track.title);
    const titles = norm !== track.title ? [track.title, norm] : [track.title];
    let fallback: LrclibRecord | null = null;
    for (const title of titles) {
      const rec = (await this.lrclib('/get', { track_name: title, artist_name: artist, album_name: track.album, duration: String(durationS) })) as LrclibRecord | null;
      if (rec?.syncedLyrics) return rec;
      if (rec && !fallback && (rec.plainLyrics || rec.instrumental)) fallback = rec;
    }
    const results = await this.lrclib('/search', { track_name: norm, artist_name: artist });
    if (Array.isArray(results)) {
      const close = (r: LrclibRecord): boolean => typeof r.duration === 'number' && Math.abs(r.duration - track.durationMs / 1000) <= DURATION_TOLERANCE_S;
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

function none(trackId: string): TrackLyrics {
  return { trackId, source: 'none', synced: null, plain: null, instrumental: false };
}
