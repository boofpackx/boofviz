import * as THREE from 'three';
import type { AudioFrame } from '@shared/types/audio';
import type { Renderer, RendererOptions, RenderContext, RenderStats, Scene } from '@shared/types/engine';
import { OUTPUT_FRAG, OUTPUT_VERT } from '../shaders/output';
import { Compositor } from './Compositor';
import { FullscreenPass } from './fullscreen';
import { ShaderWarmup } from './warmup';

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
  /** A scene waiting for its launch beat (quantized preset change). */
  private pending: { scene: Scene; atBeat: number } | null = null;
  private readonly warmup = new ShaderWarmup();
  /** When the last queued scene went live: that frame's beat and the frame before's (sync checks). */
  lastSwitch: { beat: number; prevBeat: number } | null = null;
  private lastBeat = Number.NaN;
  private warmupTimer = 0;
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

  /**
   * Show `scene`. With `applyAtBeat`, it goes live on the first frame whose
   * beat counter reaches that beat, so every window switches on the same beat.
   */
  setScene(scene: Scene, applyAtBeat?: number): void {
    if (!this.warmupTimer) {
      // Once the first look is up, compile every other shader in the background.
      const kinds = scene.layers.map((l) => l.source.kind);
      this.warmupTimer = window.setTimeout(() => void this.warmup.run(this.renderer, kinds), 1500);
    }
    if (applyAtBeat === undefined) {
      this.pending = null;
      this.compositor.setScene(scene);
    } else this.pending = { scene, atBeat: applyAtBeat };
  }

  /** Beat a queued scene is waiting for, if any. */
  get pendingBeat(): number | null {
    return this.pending?.atBeat ?? null;
  }

  /** GPU resource counts (soak tests watch these for leaks). */
  get gpuInfo(): { geometries: number; textures: number; programs: number } {
    const i = this.renderer.info;
    return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
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
    if (this.pending && frame.beat >= this.pending.atBeat - 0.002) {
      this.compositor.setScene(this.pending.scene);
      this.pending = null;
      this.lastSwitch = { beat: frame.beat, prevBeat: this.lastBeat };
    }
    this.lastBeat = frame.beat;
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
    window.clearTimeout(this.warmupTimer);
    this.warmup.dispose();
    this.compositor.dispose();
    this.output.dispose();
    this.renderer.dispose();
  }
}
