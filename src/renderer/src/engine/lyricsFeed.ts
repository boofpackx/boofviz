import type { BoofvizApi } from '@shared/ipc';
import { EMPTY_LYRICS, EMPTY_NOW_PLAYING, estimateLines, lineIndexAt, positionAt, type LyricLine, type NowPlaying, type TrackLyrics } from '@shared/lyrics';

/**
 * Per-window singleton holding the latest now-playing sample and lyrics from
 * the main process. Generators read it every frame; because both windows get
 * the same sample and share the wall clock, preview and output agree on the
 * song position (and so on the current line).
 */
export const lyricsFeed = {
  now: { ...EMPTY_NOW_PLAYING } as NowPlaying,
  lyrics: { ...EMPTY_LYRICS } as TrackLyrics,
  /** Settings offset (ms, positive = lyrics earlier). */
  offsetMs: 0,
  /** Bumped on every track / lyrics change. */
  version: 0,
};

let estimated: { key: string; lines: LyricLine[] | null } = { key: '', lines: null };

/**
 * Timed lines for the track playing now (never a previous track's). Lyrics
 * found without timestamps are spread across the song so they still show.
 */
export function currentLines(): LyricLine[] | null {
  const { now, lyrics } = lyricsFeed;
  if (!now.trackId || lyrics.trackId !== now.trackId) return null;
  if (lyrics.synced) return lyrics.synced;
  if (!lyrics.plain || lyrics.instrumental) return null;
  const key = `${now.trackId}|${now.durationMs}`;
  if (estimated.key !== key) estimated = { key, lines: estimateLines(lyrics.plain, now.durationMs) };
  return estimated.lines;
}

/** Song position (ms) at `epochMs`, including the settings offset and `leadMs`. */
export function songPositionMs(epochMs: number, leadMs = 0): number {
  return positionAt(lyricsFeed.now, epochMs) + lyricsFeed.offsetMs + leadMs;
}

/** Current line at `epochMs` (debug hooks and the control panel's preview). */
export function lyricAt(epochMs: number, leadMs = 0): { index: number; text: string; next: string; positionMs: number } {
  const lines = currentLines();
  const positionMs = songPositionMs(epochMs, leadMs);
  const index = lines ? lineIndexAt(lines, positionMs) : -1;
  return { index, text: lines?.[index]?.text ?? '', next: lines?.[index + 1]?.text ?? '', positionMs };
}

export type TextSource = 'text' | 'lyrics' | 'title';

/** What a text look should show right now. */
export interface LiveText {
  /** 'text' means: use the look's own text. */
  kind: 'text' | 'lyrics' | 'title';
  /** Lines to show (lyrics: a window around the current line). */
  lines: string[];
  /** Index of the current line within `lines`. */
  current: number;
  /** 0..1 progress through the current line. */
  progress: number;
}

const OWN_TEXT: LiveText = { kind: 'text', lines: [], current: 0, progress: 0 };

/** The song's name while a track is known (no lyrics yet, or none at all), else nothing. */
export function songTitle(): string {
  const { now } = lyricsFeed;
  return now.connected && now.trackId ? now.title : '';
}

/**
 * Resolve a text look's source. Lyrics fall back to the song title (before
 * the first line, or when the track has no lyrics), and to nothing at all
 * when no song is known: never placeholder words. Only "Text from: text"
 * uses the look's own text. `before`/`after` size the window of lines around
 * the current one.
 */
export function liveText(source: TextSource, epochMs: number, leadMs = 150, before = 0, after = 0): LiveText {
  const kind = source;
  const { now } = lyricsFeed;
  if (kind === 'text') return OWN_TEXT;
  const name = songTitle();
  const title: LiveText = { kind: 'title', lines: name ? [name] : [], current: 0, progress: 0 };
  if (!name) return title;
  if (kind === 'title') return { ...title, lines: [now.title, now.artists.join(', ')].filter(Boolean) };
  const lines = currentLines();
  if (!lines?.length) return title;
  const pos = songPositionMs(epochMs, leadMs);
  const i = lineIndexAt(lines, pos);
  if (i < 0) return title;
  const first = Math.max(0, i - before);
  const last = Math.min(lines.length - 1, i + after);
  const t0 = lines[i].t;
  const t1 = lines[i + 1]?.t ?? t0 + 4000;
  // Instrumental gaps are empty lines: show the last sung words rather than nothing.
  const window = lines.slice(first, last + 1).map((l) => l.text || '♪');
  return { kind: 'lyrics', lines: window, current: i - first, progress: Math.min(1, Math.max(0, (pos - t0) / Math.max(1, t1 - t0))) };
}

export function setNowPlaying(s: NowPlaying): void {
  const prev = lyricsFeed.now;
  // Album art is sent once per track: keep it across the 1 Hz updates.
  const art = s.artDataUrl ?? (s.trackId && s.trackId === prev.trackId ? prev.artDataUrl : undefined);
  lyricsFeed.now = { ...s, artDataUrl: art };
  if (s.trackId !== prev.trackId) lyricsFeed.version++;
}

export function setTrackLyrics(l: TrackLyrics): void {
  lyricsFeed.lyrics = l;
  lyricsFeed.version++;
}

/** Subscribe this window's feed to main. Call before any await so a replay can't arrive unheard. */
export function connectLyricsFeed(api: Pick<BoofvizApi, 'onNowPlaying' | 'onLyrics'>, onChange?: () => void): () => void {
  const offA = api.onNowPlaying((s) => {
    setNowPlaying(s);
    onChange?.();
  });
  const offB = api.onLyrics((l) => {
    setTrackLyrics(l);
    onChange?.();
  });
  return () => {
    offA();
    offB();
  };
}
