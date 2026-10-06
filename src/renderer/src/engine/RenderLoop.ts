import type { GlobalControls, Renderer } from '@shared/types/engine';
import type { AudioFrameBuilder } from '../audio/frameBuilder';

/**
 * requestAnimationFrame driver: builds the AudioFrame, renders, measures fps.
 * `onFrame` runs after rendering (HUD, meters) with the same frame.
 */
export class RenderLoop {
  fps = 0;
  frameMs = 0;
  private raf = 0;
  private last = 0;
  private readonly start = performance.now();

  constructor(
    private readonly renderer: Renderer,
    private readonly builder: AudioFrameBuilder,
    private readonly globals: () => GlobalControls,
    private readonly onFrame?: (dt: number) => void,
  ) {}

  run(): void {
    const tick = (now: number): void => {
      this.raf = requestAnimationFrame(tick);
      const dt = this.last ? Math.min((now - this.last) / 1000, 0.25) : 1 / 60;
      this.last = now;
      if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
      const t0 = performance.now();
      const frame = this.builder.build();
      this.renderer.render(frame, { time: (now - this.start) / 1000, dt, globals: this.globals() });
      this.frameMs += (performance.now() - t0 - this.frameMs) * 0.05;
      this.onFrame?.(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
