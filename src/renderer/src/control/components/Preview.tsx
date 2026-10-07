import { useEffect, useRef, useState } from 'react';
import { ThreeRenderer } from '@/engine/three/ThreeRenderer';
import { RenderLoop } from '@/engine/RenderLoop';
import { sceneOf } from '@/engine/presetIO';
import { engine, preview } from '../runtime';
import { currentScene, useShow } from '../show';
import { useControl } from '../store';
import { transitionFor } from '../launcher';
import { DebugHud } from '../hud/DebugHud';
import { previewStats } from '../hooks';
import { Button } from './ui';
import { useSourceActions } from './SourcePanel';

/** Live preview of the same scene the output window renders, plus the debug HUD. */
export function Preview() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const hudCanvas = hudRef.current!;
    const wrap = wrapRef.current!;
    const renderer = new ThreeRenderer();
    const hud = new DebugHud();
    const hudCtx = hudCanvas.getContext('2d')!;
    let loop: RenderLoop | null = null;
    let ro: ResizeObserver | null = null;
    let disposed = false;
    let hudWasOn = false;
    let unsubscribe: (() => void) | null = null;

    void renderer.init(canvas, { renderScale: 1, isOutput: false }).then(() => {
      if (disposed) return;
      renderer.setScene(currentScene());
      renderer.setLyricsOverlay(useControl.getState().settings.lyrics.overlay);
      renderer.setLostMedia(useControl.getState().settings.lostMedia);
      renderer.setRetroTv(useControl.getState().settings.retroTv);
      preview.renderer = renderer;
      const offOverlay = useControl.subscribe((s, prev) => {
        if (s.settings.lyrics.overlay !== prev.settings.lyrics.overlay) renderer.setLyricsOverlay(s.settings.lyrics.overlay);
        if (s.settings.lostMedia !== prev.settings.lostMedia) renderer.setLostMedia(s.settings.lostMedia);
        if (s.settings.retroTv !== prev.settings.retroTv) renderer.setRetroTv(s.settings.retroTv);
      });
      const offShow = useShow.subscribe((s, prev) => {
        // A queued launch going live: the renderer already holds it for its beat.
        const fromQueue = !!prev.queued && !s.queued && prev.queued.entry.id === s.sourceId;
        const newLook = s.sourceId !== prev.sourceId && !fromQueue;
        if (!fromQueue && (s.doc !== prev.doc || (s.queued !== prev.queued && !s.queued))) renderer.setScene(sceneOf(s.doc), undefined, newLook ? transitionFor(s.doc) : undefined);
        // A queued launch goes live on its beat in the preview exactly as in the output.
        if (s.queued && (s.queued !== prev.queued || s.doc !== prev.doc)) renderer.setScene(sceneOf(s.queued.entry.preset), s.queued.atBeat, transitionFor(s.queued.entry.preset));
      });
      unsubscribe = () => {
        offShow();
        offOverlay();
      };
      const fit = (): void => {
        const r = wrap.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        renderer.resize(r.width, r.height, dpr);
        hudCanvas.width = Math.round(r.width * dpr);
        hudCanvas.height = Math.round(r.height * dpr);
      };
      ro = new ResizeObserver(fit);
      ro.observe(wrap);
      fit();
      loop = new RenderLoop(
        renderer,
        engine.builder,
        () => useControl.getState().globals,
        (dt) => {
          previewStats.fps = loop!.fps;
          previewStats.frameMs = loop!.frameMs;
          const on = useControl.getState().hud;
          if (on) {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            hud.draw(hudCtx, hudCanvas.width, hudCanvas.height, dpr, engine.builder.frame, engine.builder.latest, dt, loop!.fps);
          } else if (hudWasOn) hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
          hudWasOn = on;
        },
      );
      loop.run();
    }).catch((err: Error) => {
      if (!disposed) setGpuError(err.message);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
      if (preview.renderer === renderer) preview.renderer = null;
      loop?.stop();
      ro?.disconnect();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-ink-950 p-3">
      <div ref={wrapRef} className="relative aspect-video max-h-full w-full max-w-full overflow-hidden rounded-md bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" style={{ maxWidth: 'calc((100vh - 120px) * 16 / 9)' }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <canvas ref={hudRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {gpuError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="max-w-md">
              <div className="mb-1 text-sm font-semibold text-bad">WebGL2 is unavailable</div>
              <p className="text-ink-300">BOOFVIZ needs a GPU with WebGL2. Update your graphics driver, and on laptops make sure BOOFVIZ runs on the high-performance GPU.</p>
              <p className="mt-2 font-mono text-[10px] text-ink-500">{gpuError}</p>
            </div>
          </div>
        ) : (
          <PreviewOverlay />
        )}
      </div>
    </div>
  );
}

function PreviewOverlay() {
  const status = useControl((s) => s.engineStatus);
  const platform = window.boofviz.platform;
  const set = useControl((s) => s.set);
  const { selectLoopback } = useSourceActions();
  if (status.state === 'running') return null;

  let title = 'Pick an audio source';
  let body = platform === 'win32' ? 'System Audio captures whatever is playing (Serato, Rekordbox, Spotify…) with no drivers.' : 'Choose an input device or drop an audio file to start.';
  if (status.state === 'starting') {
    title = `Connecting ${status.label}…`;
    body = platform === 'win32' && status.label === 'System Audio' ? 'Capturing the default output device via WASAPI loopback.' : '';
  }
  if (status.state === 'error') {
    title = `${status.label}: not available`;
    body =
      status.hint === 'loopback-unsupported'
        ? 'System Audio capture is Windows-only. On macOS, route your DJ software into BlackHole and pick it as an input device.'
        : status.hint === 'permission'
          ? 'Audio permission was denied. Allow microphone/screen capture for BOOFVIZ in your OS privacy settings.'
          : status.message;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <div className="max-w-md rounded-lg border border-ink-600 bg-ink-900/95 p-5 text-center shadow-2xl">
        <div className="mb-1 text-sm font-semibold text-ink-100">{title}</div>
        {body && <p className="mb-4 text-ink-300">{body}</p>}
        <div className="flex justify-center gap-2">
          {platform === 'win32' && status.state !== 'starting' && (
            <Button tone="accent" onClick={() => void selectLoopback()}>
              Use System Audio
            </Button>
          )}
          {status.state !== 'starting' && <Button onClick={() => set({ showGuide: true })}>Routing guide</Button>}
        </div>
      </div>
    </div>
  );
}
