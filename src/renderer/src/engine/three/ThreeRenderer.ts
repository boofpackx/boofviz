import * as THREE from 'three';
import type { AudioFrame } from '@shared/types/audio';
import type { Renderer, RendererOptions, RenderContext, RenderStats, Scene } from '@shared/types/engine';
import { OUTPUT_FRAG, OUTPUT_VERT } from '../shaders/output';
import { Compositor } from './Compositor';
import { FullscreenPass } from './fullscreen';

const MAX_DIM = 8192;

/**
 * WebGL2 backend: the compositor renders the scene in linear HDR, then the
 * output pass applies master brightness/saturation/hue, ACES tonemapping,
 * sRGB encoding, dithering and blackout.
 */
export class ThreeRenderer implements Renderer {
  readonly backend = 'webgl2' as const;
  private renderer!: THREE.WebGLRenderer;
  private compositor!: Compositor;
  private output!: FullscreenPass;
  private options: RendererOptions = { renderScale: 1, isOutput: false };
  private frameIndex = 0;
  private blackout = 0;
  private css = { w: 1, h: 1, dpr: 1 };
  readonly stats: RenderStats = { fps: 0, frameMs: 0, width: 0, height: 0 };

  async init(canvas: HTMLCanvasElement, options: RendererOptions): Promise<void> {
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    // We own colour management: generators write linear light, the output pass encodes sRGB.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);
    this.compositor = new Compositor(this.renderer);
    this.output = new FullscreenPass(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: OUTPUT_VERT,
        fragmentShader: OUTPUT_FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uScene: { value: null },
          uExposure: { value: 1 },
          uSaturation: { value: 1 },
          uHueShift: { value: 0 },
          uBlackout: { value: 0 },
          uFrame: { value: 0 },
        },
      }),
    );
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  }

  setScene(scene: Scene): void {
    this.compositor.setScene(scene);
  }

  /** Live modulated parameter values for UI meters. */
  get live(): Map<string, number> | null {
    return this.compositor?.live ?? null;
  }

  setRenderScale(scale: number): void {
    this.options = { ...this.options, renderScale: scale };
    this.resize(this.css.w, this.css.h, this.css.dpr);
  }

  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    this.css = { w: cssWidth, h: cssHeight, dpr: pixelRatio };
    const s = pixelRatio * this.options.renderScale;
    const w = Math.max(1, Math.min(MAX_DIM, Math.round(cssWidth * s)));
    const h = Math.max(1, Math.min(MAX_DIM, Math.round(cssHeight * s)));
    if (w === this.stats.width && h === this.stats.height) return;
    this.renderer.setSize(w, h, false);
    this.compositor.resize(w, h);
    this.stats.width = w;
    this.stats.height = h;
  }

  render(frame: AudioFrame, ctx: RenderContext): void {
    const g = ctx.globals;
    // Blackout eases over ~80 ms: instant to the eye, but never a hard flash.
    this.blackout += ((g.blackout ? 1 : 0) - this.blackout) * (1 - Math.exp(-ctx.dt / 0.03));
    const scene = this.compositor.render(frame, ctx.dt, g);
    const u = this.output.material.uniforms;
    u.uScene.value = scene.texture;
    u.uExposure.value = g.brightness;
    u.uSaturation.value = g.saturation;
    u.uHueShift.value = (g.hueShift * Math.PI) / 180;
    u.uBlackout.value = this.blackout > 0.999 ? 1 : this.blackout;
    u.uFrame.value = this.frameIndex++ % 1024;
    this.output.render(this.renderer, null);
  }

  dispose(): void {
    this.compositor.dispose();
    this.output.dispose();
    this.renderer.dispose();
  }
}
