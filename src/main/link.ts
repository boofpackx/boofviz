import { app } from 'electron';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { LinkState } from '@shared/ipc';

interface NativeSession {
  enable(on: boolean): void;
  snapshot(quantum: number): { micros: number; tempo: number; beat: number; phase: number; playing: boolean; peers: number };
  close(): void;
}

const QUANTUM = 4;

function addonPath(): string | null {
  const rel = join('native', 'link', 'build', 'Release', 'boofviz_link.node');
  const base = app.getAppPath();
  for (const p of [join(base.replace('app.asar', 'app.asar.unpacked'), rel), join(base, rel), join(process.cwd(), rel)]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Ableton Link session in the main process. Polls the timeline and publishes
 * (tempo, beat, epoch time) snapshots; the analysis worker anchors its beat
 * clock to them. The native add-on is optional (npm run link:build).
 */
export class LinkService {
  private session: NativeSession | null = null;
  private Native: (new (bpm: number) => NativeSession) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private loadError: string | null = null;

  constructor(private readonly publish: (s: LinkState) => void) {
    const p = addonPath();
    if (!p) {
      this.loadError = 'Link add-on not built (run "npm run link:build").';
      return;
    }
    try {
      const req = createRequire(import.meta.url);
      this.Native = (req(p) as { LinkSession: new (bpm: number) => NativeSession }).LinkSession;
    } catch (err) {
      this.loadError = `Link add-on failed to load: ${(err as Error).message}`;
    }
  }

  get available(): boolean {
    return this.Native !== null;
  }

  state(): LinkState {
    return { available: this.available, enabled: this.session !== null, peers: 0, tempo: 0, beat: 0, epochMs: 0, playing: false, error: this.loadError ?? undefined };
  }

  setEnabled(on: boolean): void {
    if (on && !this.session && this.Native) {
      this.session = new this.Native(120);
      this.session.enable(true);
      this.timer = setInterval(() => this.poll(), 50);
    } else if (!on && this.session) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.session.close();
      this.session = null;
    }
    this.publish(this.state());
  }

  private poll(): void {
    if (!this.session) return;
    const s = this.session.snapshot(QUANTUM);
    // Sampled right after the snapshot: the beat above is the beat at this instant.
    const epochMs = performance.timeOrigin + performance.now();
    this.publish({ available: true, enabled: true, peers: s.peers, tempo: s.tempo, beat: s.beat, epochMs, playing: s.playing });
  }

  dispose(): void {
    this.setEnabled(false);
  }
}
