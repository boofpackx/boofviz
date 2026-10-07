import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import SMTC_SCRIPT from './smtc.ps1?raw';

/**
 * Windows media session (SMTC) reader: what the Spotify desktop app tells
 * Windows about the song (title, artist, play / pause, timeline). One
 * persistent Windows PowerShell process does the WinRT calls (no native
 * modules); tests poll a URL with the same JSON shape instead
 * (BOOFVIZ_SMTC_URL). No Electron imports.
 */

export { SMTC_SCRIPT };

export type SmtcStatus = 'playing' | 'paused' | 'stopped' | 'changing';

export interface SmtcSample {
  /** Media sessions are readable (false: WinRT failed or the reader is down). */
  ok: boolean;
  /** SourceAppUserModelId of the Spotify session; null when Spotify has none. */
  app: string | null;
  title: string;
  artist: string;
  album: string;
  status: SmtcStatus;
  /** Timeline (ms), when the app reports one: Position at `updatedEpochMs`, StartTime, EndTime. */
  positionMs: number | null;
  startMs: number | null;
  endMs: number | null;
  /** When the app last updated the timeline (epoch ms). */
  updatedEpochMs: number | null;
  /** When this sample was read (epoch ms). */
  sampleEpochMs: number;
}

/** Pluggable now-playing source: PowerShell on Windows, a URL in tests. */
export interface MediaSessionSource {
  start(onSample: (s: SmtcSample) => void): void;
  stop(): void;
}

/** PlaybackStatus by name, or by number should the enum come through as one. */
const STATUS: Record<string, SmtcStatus> = { playing: 'playing', paused: 'paused', stopped: 'stopped', closed: 'stopped', opened: 'stopped', changing: 'changing', 0: 'stopped', 1: 'stopped', 2: 'changing', 3: 'stopped', 4: 'playing', 5: 'paused' };

export function offlineSample(now: number): SmtcSample {
  return { ok: false, app: null, title: '', artist: '', album: '', status: 'stopped', positionMs: null, startMs: null, endMs: null, updatedEpochMs: null, sampleEpochMs: now };
}

/** Validate one JSON line / response. Only a Spotify session counts. */
export function parseSmtcSample(raw: unknown, now: number): SmtcSample | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const at = num(o.sampleEpochMs) ?? now;
  if (o.ok !== true) return offlineSample(at);
  const app = str(o.app);
  return {
    ok: true,
    app: /spotify/i.test(app) ? app : null,
    title: str(o.title),
    artist: str(o.artist),
    album: str(o.album),
    status: STATUS[str(o.status).toLowerCase()] ?? 'stopped',
    positionMs: num(o.positionMs),
    startMs: num(o.startMs),
    endMs: num(o.endMs),
    updatedEpochMs: num(o.updatedEpochMs),
    sampleEpochMs: at,
  };
}

export interface PowerShellOptions {
  /** PowerShell runs the script from a real file (the app's own copy may sit inside app.asar). */
  scriptPath: string;
  now: () => number;
  spawn?: typeof spawn;
  writeScript?: (path: string, text: string) => void;
  log?: (message: string) => void;
}

/** Restart delays after the reader dies: 1 s, doubling to 1 min; give up after `tries` deaths without one good line. */
const RESTART_MS = { base: 1000, max: 60000, tries: 8 };
/** No line (not even the 2 s heartbeat) for this long: the reader hung, restart it. */
const HUNG_MS = 10000;

function writeIfChanged(path: string, text: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** Windows PowerShell 5.1 by full path (never whatever "powershell" PATH finds first). */
function powershellExe(): string {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** One persistent powershell.exe reading SMTC; restarted with backoff, killed on stop(). */
export class PowerShellSmtcSource implements MediaSessionSource {
  private child: ChildProcess | null = null;
  private emit: ((s: SmtcSample) => void) | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private lastLine = 0;

  constructor(private readonly o: PowerShellOptions) {}

  start(onSample: (s: SmtcSample) => void): void {
    if (this.emit) return;
    this.emit = onSample;
    this.failures = 0;
    this.launch();
    this.watchdog = setInterval(() => {
      if (this.child && this.o.now() - this.lastLine > HUNG_MS) this.child.kill();
    }, 2000);
  }

  stop(): void {
    this.emit = null;
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retry = this.watchdog = null;
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  private launch(): void {
    this.retry = null;
    if (!this.emit) return;
    try {
      (this.o.writeScript ?? writeIfChanged)(this.o.scriptPath, SMTC_SCRIPT);
    } catch (err) {
      return this.down(`could not write ${this.o.scriptPath}: ${(err as Error).message}`, true);
    }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.o.scriptPath, '-ParentPid', String(process.pid)];
    let child: ChildProcess;
    try {
      child = (this.o.spawn ?? spawn)(powershellExe(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return this.down(`could not start PowerShell: ${(err as Error).message}`, false);
    }
    this.child = child;
    this.lastLine = this.o.now();
    let fatal = false;
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => (stderr = (stderr + d).slice(-400)));
    child.stdout?.setEncoding('utf8');
    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (child !== this.child) return;
        this.lastLine = this.o.now();
        let raw: unknown;
        try {
          raw = JSON.parse(line.replace(/^\uFEFF/, ''));
        } catch {
          return;
        }
        if ((raw as { fatal?: unknown } | null)?.fatal === true) fatal = true;
        const s = parseSmtcSample(raw, this.o.now());
        if (!s) return;
        if (s.ok) this.failures = 0;
        this.emit?.(s);
      });
    }
    const finish = (why: string, noExe = false): void => {
      if (child !== this.child) return;
      this.child = null;
      this.down(why, fatal || noExe);
    };
    // 'on', not 'once': a later 'error' (a failed kill) must not go unhandled.
    child.on('error', (err: NodeJS.ErrnoException) => finish(`PowerShell failed: ${err.message}`, err.code === 'ENOENT'));
    child.once('close', (code) => finish(`PowerShell exited (${code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
  }

  /** The reader is gone: say so, then restart it (unless WinRT is missing or it never works, e.g. scripts blocked by policy). */
  private down(why: string, fatal: boolean): void {
    if (!this.emit) return;
    (this.o.log ?? console.warn)(`[smtc] ${why}`);
    this.emit(offlineSample(this.o.now()));
    if (fatal || this.failures >= RESTART_MS.tries) return;
    const delay = Math.min(RESTART_MS.max, RESTART_MS.base * 2 ** this.failures);
    this.failures++;
    this.retry = setTimeout(() => this.launch(), delay);
  }
}

/** Polls a URL for the same JSON (tests and e2e on Linux: BOOFVIZ_SMTC_URL). */
export class HttpSmtcSource implements MediaSessionSource {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(
    private readonly url: string,
    private readonly deps: { fetch: typeof fetch; now: () => number; intervalMs?: number },
  ) {}

  start(onSample: (s: SmtcSample) => void): void {
    const gen = ++this.generation;
    const tick = async (): Promise<void> => {
      let s: SmtcSample | null = null;
      try {
        const res = await this.deps.fetch(this.url);
        if (res.ok) s = parseSmtcSample(await res.json(), this.deps.now());
      } catch {
        // Unreachable: report the source as down.
      }
      if (gen !== this.generation) return;
      onSample(s ?? offlineSample(this.deps.now()));
      if (gen === this.generation) this.timer = setTimeout(() => void tick(), this.deps.intervalMs ?? 500);
    };
    void tick();
  }

  stop(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** BOOFVIZ_SMTC_URL → URL source; Windows → PowerShell (BOOFVIZ_SMTC=off disables it); else none. */
export function createMediaSource(o: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; scriptPath: string; fetch: typeof fetch; now: () => number }): MediaSessionSource | null {
  const url = o.env.BOOFVIZ_SMTC_URL?.trim();
  if (url) return new HttpSmtcSource(url, { fetch: o.fetch, now: o.now });
  if (o.platform !== 'win32' || o.env.BOOFVIZ_SMTC === 'off') return null;
  return new PowerShellSmtcSource({ scriptPath: o.scriptPath, now: o.now });
}
