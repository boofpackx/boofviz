import type { BoofvizApi } from '@shared/ipc';
import { EMPTY_LYRICS, EMPTY_NOW_PLAYING, lineIndexAt, positionAt, type LyricLine, type NowPlaying, type TrackLyrics } from '@shared/lyrics';

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

/** Synced lines for the track playing now (never a previous track's). */
export function currentLines(): LyricLine[] | null {
  const { now, lyrics } = lyricsFeed;
  return now.trackId && lyrics.trackId === now.trackId ? lyrics.synced : null;
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
