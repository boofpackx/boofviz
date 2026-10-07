/**
 * Now-playing + synced-lyrics contracts and pure helpers, shared by the main
 * process (lookup, Spotify polling) and both renderers (lyrics generator).
 */

export interface LyricWord {
  /** Song time in ms. */
  t: number;
  text: string;
}

export interface LyricLine {
  /** Song time in ms (the file's [offset:] already applied). */
  t: number;
  /** Empty text marks the end of the previous line (an instrumental gap). */
  text: string;
  /** Enhanced-LRC word stamps, when the file has them. */
  words?: LyricWord[];
}

export interface ParsedLrc {
  lines: LyricLine[];
  /** The file's [offset:] tag (positive = lyrics sooner); already applied to `lines`. */
  offsetMs: number;
}

/** What Spotify is playing, as last sampled by the main process. */
export interface NowPlaying {
  connected: boolean;
  /** Waiting for the browser login to finish. */
  connecting?: boolean;
  error?: string;
  playing: boolean;
  trackId: string | null;
  title: string;
  artists: string[];
  album: string;
  /** Album art as a data: URL (renderer CSP allows no remote images). Sent once per track. */
  artDataUrl?: string;
  durationMs: number;
  /** Playback position at `sampleEpochMs` (Date.now() clock). */
  progressMs: number;
  sampleEpochMs: number;
}

export type LyricsSource = 'file' | 'cache' | 'lrclib' | 'none';

export interface TrackLyrics {
  trackId: string | null;
  source: LyricsSource;
  synced: LyricLine[] | null;
  plain: string | null;
  instrumental: boolean;
  /** A lookup for this track is still running. */
  loading?: boolean;
}

export type SpotifyCommand = 'play' | 'pause' | 'next' | 'previous' | 'sync';

export const SPOTIFY_REDIRECT_PORT = 43821;
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;

export const EMPTY_NOW_PLAYING: NowPlaying = { connected: false, playing: false, trackId: null, title: '', artists: [], album: '', durationMs: 0, progressMs: 0, sampleEpochMs: 0 };
export const EMPTY_LYRICS: TrackLyrics = { trackId: null, source: 'none', synced: null, plain: null, instrumental: false };

// [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx] (also "mm:ss:xx" seen in the wild).
const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;
const WORD_STAMP = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function stampMs(m: string, s: string, frac: string | undefined): number {
  const f = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;
  return Number(m) * 60000 + Number(s) * 1000 + f;
}

/** Parse LRC / enhanced LRC. Lines come back sorted by time (stable for equal stamps). */
export function parseLrc(text: string): ParsedLrc {
  let offsetMs = 0;
  const raw: Array<LyricLine & { order: number }> = [];
  let order = 0;
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('[')) continue;
    const off = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(line);
    if (off) {
      offsetMs = Number(off[1]);
      continue;
    }
    // One or more leading timestamps; anything else in brackets ([ar:], [ti:], [length:]…) is metadata.
    const stamps: number[] = [];
    let pos = 0;
    STAMP.lastIndex = 0;
    for (let m = STAMP.exec(line); m; m = STAMP.exec(line)) {
      stamps.push(stampMs(m[1], m[2], m[3]));
      pos = STAMP.lastIndex;
      while (line[pos] === ' ') pos++;
      STAMP.lastIndex = pos;
    }
    if (!stamps.length) continue;
    const body = line.slice(pos);
    let words: LyricWord[] | undefined;
    WORD_STAMP.lastIndex = 0;
    if (WORD_STAMP.test(body)) {
      words = [];
      const parts = body.split(WORD_STAMP);
      // split() with 3 capture groups: [before, m, s, frac, text, m, s, frac, text…]
      for (let i = 1; i + 3 < parts.length; i += 4) {
        const w = (parts[i + 3] ?? '').trim();
        if (w) words.push({ t: stampMs(parts[i], parts[i + 1], parts[i + 2]), text: w });
      }
      const lead = parts[0].trim();
      if (lead && words.length) words[0] = { t: words[0].t, text: `${lead} ${words[0].text}` };
    }
    const clean = body.replace(WORD_STAMP, ' ').replace(/\s+/g, ' ').trim();
    for (const t of stamps) {
      const entry: LyricLine & { order: number } = { t, text: clean, order: order++ };
      if (words?.length) entry.words = words.map((w) => ({ ...w, t: w.t + (t - stamps[0]) }));
      raw.push(entry);
    }
  }
  raw.sort((a, b) => a.t - b.t || a.order - b.order);
  const lines = raw.map(({ t, text: lineText, words }) => {
    const l: LyricLine = { t: Math.max(0, t - offsetMs), text: lineText };
    if (words) l.words = words.map((w) => ({ t: Math.max(0, w.t - offsetMs), text: w.text }));
    return l;
  });
  return { lines, offsetMs };
}

/** Index of the line playing at `ms` (the last line with t ≤ ms), or −1 before the first. */
/**
 * Lines for lyrics that came without timestamps: spread across the song by
 * length (stanza breaks become short gaps), skipping a typical intro and
 * outro. Only a guess, but it keeps the words moving with the song.
 */
export function estimateLines(plain: string, durationMs: number): LyricLine[] | null {
  if (!plain.trim() || durationMs < 20000) return null;
  const rows = plain.split(/\r?\n/).map((r) => r.trim());
  while (rows.length && !rows[0]) rows.shift();
  const weights = rows.map((r) => (r ? 6 + r.length : 4));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const start = Math.min(15000, durationMs * 0.08);
  const span = durationMs * 0.9 - start;
  const out: LyricLine[] = [];
  let acc = 0;
  rows.forEach((text, i) => {
    const t = Math.round(start + (acc / total) * span);
    acc += weights[i];
    // Consecutive breaks collapse into one gap.
    if (!text && (!out.length || !out[out.length - 1].text)) return;
    out.push({ t, text });
  });
  out.push({ t: Math.round(start + span), text: '' });
  return out;
}

export function lineIndexAt(lines: readonly LyricLine[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Playback position at `epochMs`, extrapolated from the last sample while playing. */
export function positionAt(s: Pick<NowPlaying, 'playing' | 'progressMs' | 'sampleEpochMs' | 'durationMs'>, epochMs: number): number {
  const p = s.playing ? s.progressMs + (epochMs - s.sampleEpochMs) : s.progressMs;
  return Math.max(0, s.durationMs > 0 ? Math.min(s.durationMs, p) : p);
}

// Edition / credit suffixes that don't change the words: "- 2006 Remaster", "(Single Version)", "(feat. X)"…
const EDITION = /\b(re-?master(ed)?|single|edit|version|mono|stereo|feat\.?|ft\.?|featuring|with|deluxe|bonus track|anniversary|digital)\b/i;

/** Title with remaster / single-version / featuring suffixes removed (for lyric lookups). */
export function normalizeTitle(title: string): string {
  let t = title.replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) => (EDITION.test(inner) ? '' : whole));
  for (;;) {
    const m = /^(.*\S)\s+-\s+([^-]+)$/.exec(t);
    if (!m || !EDITION.test(m[2])) break;
    t = m[1];
  }
  return t.replace(/\s+/g, ' ').trim() || title.trim();
}

/** Loose key for matching "Artist - Title" file names: lowercase letters (any script) and digits only. */
export function matchKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** File name used when attaching an .lrc to a track. */
/** The first of several artists named in one string ("A, B", "A feat. B", "A & B"). */
export function primaryArtist(name: string): string {
  return name.split(/\s*,\s*|\s+(?:feat\.?|ft\.?|featuring|x|&|and)\s+/i)[0]?.trim() ?? name;
}

export function lrcFileName(artist: string, title: string): string {
  const clean = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${clean(artist) || 'Unknown'} - ${clean(normalizeTitle(title)) || 'Untitled'}.lrc`;
}
