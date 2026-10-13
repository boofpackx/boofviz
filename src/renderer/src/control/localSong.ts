import { songFromFile } from '@shared/audioTags';
import type { LocalSong } from '@shared/lyrics';
import { engine } from './runtime';

/**
 * A song in BOOFVIZ's own file player gets lyrics like a Spotify song: its
 * tags (or file name) say what it is, main looks the lyrics up (an .lrc beside
 * the file first), and the player's position drives the lyrics. The beat
 * needs nothing extra: it is heard in the audio itself, and the beat tracker
 * snaps to a seek or the loop back to the start within about a second.
 */

const HEAD_BYTES = 16 * 1024 * 1024;
const TAIL_BYTES = 2 * 1024 * 1024;

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function readSong(file: File, durationMs: number): Promise<LocalSong> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const tail = file.size > HEAD_BYTES ? new Uint8Array(await file.slice(Math.max(HEAD_BYTES, file.size - TAIL_BYTES)).arrayBuffer()) : head;
  let path: string | null = null;
  try {
    path = window.boofviz.pathForFile(file) || null;
  } catch {
    path = null;
  }
  let tags = { title: '', artists: [] as string[], album: '', lyrics: null as string | null };
  try {
    tags = songFromFile(file.name, head, tail);
  } catch {
    tags = songFromFile(file.name, new Uint8Array(0));
  }
  return { id: `file-${hash(`${path ?? file.name}|${file.size}`)}`, path, durationMs, ...tags };
}

let stop: (() => void) | null = null;

/** Follow the file the engine just started playing. */
export async function followLocalSong(file: File): Promise<void> {
  stop?.();
  const el = engine.filePlayer;
  if (!el) return;
  const api = window.boofviz;
  const durationMs = (): number => (Number.isFinite(el.duration) ? el.duration * 1000 : 0);
  // What's heard lags the player by the output's latency.
  const progress = (): void => {
    if (engine.filePlayer !== el) return;
    api.localProgress({ playing: !el.paused, progressMs: Math.max(0, el.currentTime * 1000 - engine.outputLatencyMs), durationMs: durationMs(), sampleEpochMs: Date.now() });
  };
  const ended = (): void => {
    if (engine.filePlayer === el) return;
    cleanup();
    // Only when nothing replaced it (a new file reports itself).
    if (!engine.filePlayer) api.setLocalSong(null);
  };
  const events: Array<[string, () => void]> = [
    ['play', progress],
    ['pause', progress],
    ['ratechange', progress],
    ['seeked', progress],
    ['emptied', ended],
  ];
  for (const [e, fn] of events) el.addEventListener(e, fn);
  // Once a second too: the loop back to the start, and drift between the clocks.
  const timer = window.setInterval(progress, 1000);
  const cleanup = (): void => {
    for (const [e, fn] of events) el.removeEventListener(e, fn);
    window.clearInterval(timer);
    if (stop === cleanup) stop = null;
  };
  stop = cleanup;
  api.setLocalSong(await readSong(file, durationMs()));
  progress();
}
