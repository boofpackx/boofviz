import { positionAt } from '@shared/lyrics';

/**
 * Automatic lyric timing: when a song starts from the top, find the moment it
 * is actually heard (sound after a gap) and compare it with when the player
 * says it started. The median of the last few songs sets the lyrics offset.
 */

export interface LevelSample {
  /** Date.now() clock. */
  t: number;
  silent: boolean;
}

/** Measurements outside this window (ms) are a fade-in, a crossfade or a skip, not the delay. */
export const DELAY_RANGE: [number, number] = [-800, 2500];

/**
 * When the sound starts after a gap near `reportedStart`: ms after it
 * (negative: before). Null when there's no clean start (a crossfade with no
 * gap, a flicker of sound).
 */
export function measureStartDelay(samples: readonly LevelSample[], reportedStart: number, minGapMs = 150, minSoundMs = 300): number | null {
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.silent || !samples[i - 1].silent) continue;
    if (s.t < reportedStart + DELAY_RANGE[0]) continue;
    if (s.t > reportedStart + DELAY_RANGE[1]) break;
    let j = i - 1;
    while (j > 0 && samples[j - 1].silent) j--;
    if (s.t - samples[j].t < minGapMs) continue;
    // The sound has to hold, not just blip.
    let k = i;
    while (k + 1 < samples.length && !samples[k + 1].silent) k++;
    const held = samples[k].t - s.t;
    if (held < minSoundMs && k + 1 < samples.length) continue;
    if (held < minSoundMs) return null;
    return s.t - reportedStart;
  }
  return null;
}

/** Keep the newest measurements (a handful is enough for a stable median). */
export function addMeasurement(timing: readonly number[], delay: number, keep = 7): number[] {
  return [...timing, Math.round(delay)].slice(-keep);
}

interface Pending {
  trackId: string;
  reportedStart: number;
  evalAt: number;
}

/**
 * Samples the analysis' silence flag every 20 ms and measures each song that
 * starts from the top. `report` receives each new measurement.
 */
export function startAutoTiming(deps: {
  silent: () => boolean | null;
  now: () => number;
  song: () => { trackId: string | null; playing: boolean; progressMs: number; sampleEpochMs: number; durationMs: number; connected: boolean };
  enabled: () => boolean;
  report: (delayMs: number) => void;
}): () => void {
  const samples: LevelSample[] = [];
  let lastTrack: string | null = null;
  let pending: Pending | null = null;
  const id = window.setInterval(() => {
    const now = deps.now();
    const silent = deps.silent();
    if (silent !== null) samples.push({ t: now, silent });
    while (samples.length && now - samples[0].t > 10000) samples.shift();
    const np = deps.song();
    if (!np.connected || !np.trackId) {
      lastTrack = null;
      pending = null;
      return;
    }
    if (np.trackId !== lastTrack) {
      lastTrack = np.trackId;
      const pos = positionAt(np, now);
      // Only songs heard from the top: a seek or a mid-song start says nothing about the delay.
      pending = np.playing && pos < 3000 && deps.enabled() ? { trackId: np.trackId, reportedStart: now - pos, evalAt: Math.max(now, now - pos + DELAY_RANGE[1]) + 600 } : null;
    }
    if (pending && now >= pending.evalAt) {
      const p = pending;
      pending = null;
      if (p.trackId !== np.trackId) return;
      const d = measureStartDelay(samples, p.reportedStart);
      if (d !== null) deps.report(d);
    }
  }, 20);
  return () => window.clearInterval(id);
}
