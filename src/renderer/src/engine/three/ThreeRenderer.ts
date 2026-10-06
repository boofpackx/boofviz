import * as THREE from 'three';
import type { AudioFrame } from '@shared/types/audio';
import type { Renderer, RendererOptions, RenderContext, RenderStats, Scene } from '@shared/types/engine';
import type { Generator } from '../generators/Generator';
import { SpectrumBars } from '../generators/SpectrumBars';
import { paletteLinear } from '../palettes';
import { OUTPUT_FRAG, OUTPUT_VERT } from '../shaders/output';
import { FullscreenPass } from './fullscreen';

const MAX_DIM = 8192;

function createGenerator(kind: string): Generator {
  switch (kind) {
    case 'spectrumBars':
      return new SpectrumBars();
    default:
      throw new Error(`Unknown generator "${kind}"`);
  }
}

/**
 * WebGL2 backend. Phase 1 draws the first generator layer into a half-float
 * linear target, then tonemaps + dithers to the canvas. The Phase 2 compositor
 * slots in between (layers, blend modes, FX chain) without changing callers.
 */
export class ThreeRenderer implements Renderer {
  readonly backend = 'webgl2' as const;
  private renderer!: THREE.WebGLRenderer;
  private target!: THREE.WebGLRenderTarget;
  private output!: FullscreenPass;
  private generator: Generator | null = null;
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
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.output = new FullscreenPass(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: OUTPUT_VERT,
        fragmentShader: OUTPUT_FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uScene: { value: this.target.texture },
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
    const layer = scene.layers.find((l) => l.enabled && l.source.type === 'generator');
    if (!layer) return;
    if (!this.generator || this.generator.kind !== layer.source.kind) {
      this.generator?.dispose();
      this.generator = createGenerator(layer.source.kind);
    }
    this.generator.setParams(layer.source.params);
    this.generator.setPalette(paletteLinear(scene.palette));
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
    this.target.setSize(w, h);
    this.stats.width = w;
    this.stats.height = h;
  }

  render(frame: AudioFrame, ctx: RenderContext): void {
    const g = ctx.globals;
    // Blackout eases over ~80 ms: instant to the eye, but never a hard flash.
    this.blackout += ((g.blackout ? 1 : 0) - this.blackout) * (1 - Math.exp(-ctx.dt / 0.03));

    if (this.generator) {
      this.generator.update(frame, ctx);
      this.generator.render(this.renderer, this.target);
    } else {
      this.renderer.setRenderTarget(this.target);
      this.renderer.clear();
    }
    const u = this.output.material.uniforms;
    u.uExposure.value = g.brightness;
    u.uSaturation.value = g.saturation;
    u.uHueShift.value = (g.hueShift * Math.PI) / 180;
    u.uBlackout.value = this.blackout > 0.999 ? 1 : this.blackout;
    u.uFrame.value = this.frameIndex++ % 1024;
    this.output.render(this.renderer, null);
  }

  dispose(): void {
    this.generator?.dispose();
    this.output.dispose();
    this.target.dispose();
    this.renderer.dispose();
  }
}
