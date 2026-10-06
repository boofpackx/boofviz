import { useEffect, useReducer } from 'react';

/** Preview loop stats, written by the render loop (outside React). */
export const previewStats = { fps: 0, frameMs: 0 };

/** Re-render the calling component `hz` times per second (for live readouts). */
export function useTicker(hz: number): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = window.setInterval(force, 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz]);
}

/** requestAnimationFrame callback bound to a canvas, for meters that must not re-render React. */
export function useCanvasLoop(ref: React.RefObject<HTMLCanvasElement | null>, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number) => void): void {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      draw(ctx, w, h, (now - last) / 1000);
      last = now;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}
