import * as THREE from 'three';
import type { LostMediaSettings, CoverColorsSettings, NeoFlatSettings, RetroTvSettings } from '@shared/settings';
import { globalPost } from '../lostMedia';
import type { AudioFrame } from '@shared/types/audio';
import type { ParamBag, Renderer, RendererOptions, RenderContext, RenderStats, Scene } from '@shared/types/engine';
import type { LyricsRenderInfo } from '../generators/Lyrics';
import { OUTPUT_FRAG, OUTPUT_VERT } from '../shaders/output';
import { TRANSITION_FRAG, TRANSITION_INDEX, TRANSITION_VERT } from '../shaders/transition';
import { hdrTarget } from '../fx/effects';
import { Compositor } from './Compositor';
import { FullscreenPass } from './fullscreen';
import { ShaderWarmup } from './warmup';

const MAX_DIM = 8192;

/** How a new look comes in (settings.library.transition or a preset's transitionIn). */
export interface SceneTransition {
  type: string;
  beats: number;
}

const EMPTY_SCENE: Scene = { layers: [], palette: 'Neon', paletteCycle: { mode: 'off', every: 1, fadeBeats: 1, list: [] }, hueRotate: { mode: 'off', rate: 0, amount: 0 }, macros: [] };

/**
 * WebGL2 backend: the compositor renders the scene in linear HDR, then the
 * output pass applies master brightness/saturation/hue, ACES tonemapping,
 * sRGB encoding, dithering and blackout.
 *
 * Two compositors take turns so a new look can blend in over the old one:
 * the transition runs for a number of beats from the launch beat, so every
 * window shows the same point of the transition. Edits to the live look go
 * straight to the active compositor without a transition.
 */
export class ThreeRenderer implements Renderer {
  readonly backend = 'webgl2' as const;
  private renderer!: THREE.WebGLRenderer;
  private compositor!: Compositor;
  /** The idle compositor; during a transition it renders the outgoing look. */
  private spare!: Compositor;
  private output!: FullscreenPass;
  private blend!: FullscreenPass;
  private blendTarget: THREE.WebGLRenderTarget | null = null;
  private transition: { type: number; startBeat: number; beats: number } | null = null;
  private options: RendererOptions = { renderScale: 1, isOutput: false };
  private frameIndex = 0;
  private blackout = 0;
  private lostMedia: LostMediaSettings | undefined;
  private retroTv: RetroTvSettings | undefined;
  private neoFlat: NeoFlatSettings | undefined;
  private css = { w: 1, h: 1, dpr: 1 };
  /** A scene waiting for its launch beat (quantized preset change). */
  private pending: { scene: Scene; atBeat: number; transition?: SceneTransition } | null = null;
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
    this.spare = new Compositor(this.renderer);
    this.blend = new FullscreenPass(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: TRANSITION_VERT,
        fragmentShader: TRANSITION_FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: { uA: { value: null }, uB: { value: null }, uT: { value: 0 }, uType: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
      }),
    );
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
   * With a `transition`, it is a new look that blends in over the old one;
   * without, it replaces the live look as is (edits, cuts).
   */
  setScene(scene: Scene, applyAtBeat?: number, transition?: SceneTransition): void {
    if (!this.warmupTimer) {
      // Once the first look is up, compile every other shader in the background.
      const kinds = scene.layers.map((l) => l.source.kind);
      this.warmupTimer = window.setTimeout(() => void this.warmup.run(this.renderer, kinds), 1500);
    }
    if (applyAtBeat === undefined && !this.wantsBlend(transition)) {
      this.pending = null;
      this.compositor.setScene(scene);
    } else this.pending = { scene, atBeat: applyAtBeat ?? Number.NEGATIVE_INFINITY, transition };
  }

  private wantsBlend(t: SceneTransition | undefined): t is SceneTransition {
    return !!t && t.type !== 'cut' && t.beats > 0;
  }

  /** Make `scene` live now (frame beat `beat`), blending from the old look when asked. */
  private goLive(scene: Scene, beat: number, transition: SceneTransition | undefined): void {
    if (!this.wantsBlend(transition)) {
      this.compositor.setScene(scene);
      return;
    }
    // A transition still running ends here: its outgoing look is dropped.
    const out = this.compositor;
    this.compositor = this.spare;
    this.spare = out;
    this.compositor.setScene(scene);
    this.transition = { type: TRANSITION_INDEX[transition.type] ?? 0, startBeat: beat, beats: transition.beats };
  }

  /** The running transition's type and progress (debug hooks). */
  get transitionInfo(): { type: number; t: number } | null {
    return this.transition ? { type: this.transition.type, t: this.transitionT } : null;
  }

  private transitionT = 0;

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

  /** Lyrics over every look (settings.lyrics.overlay). */
  setLyricsOverlay(overlay: { enabled: boolean; params: ParamBag } | null): void {
    this.compositor.setOverlay(overlay?.enabled ? overlay.params : null);
    this.spare.setOverlay(overlay?.enabled ? overlay.params : null);
  }

  /** "Make it lost media" over every look (settings.lostMedia). */
  setLostMedia(s: LostMediaSettings | undefined): void {
    this.lostMedia = s;
    this.applyPost();
  }

  /** "Watch on a TV" over every look (settings.retroTv). */
  setRetroTv(s: RetroTvSettings | undefined): void {
    this.retroTv = s;
    this.applyPost();
  }

  /** Looks take the album cover's colours (settings.coverColors). */
  setCoverColors(s: CoverColorsSettings | undefined): void {
    this.compositor.coverColors = s;
    this.spare.coverColors = s;
  }

  /** "Neo-brutal flat" over every look (settings.neoFlat). */
  setNeoFlat(s: NeoFlatSettings | undefined): void {
    this.neoFlat = s;
    this.applyPost();
  }

  private applyPost(): void {
    const spec = globalPost(this.lostMedia, this.retroTv, this.neoFlat);
    this.compositor.setPost(spec);
    this.spare.setPost(spec);
  }

  /** What the lyrics overlay showed last frame (debug hooks). */
  get lyricsInfo(): LyricsRenderInfo | null {
    return this.compositor?.overlayInfo ?? null;
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
    this.spare.resize(w, h);
    this.blendTarget?.setSize(w, h);
    this.stats.width = w;
    this.stats.height = h;
  }

  render(frame: AudioFrame, ctx: RenderContext): void {
    const g = ctx.globals;
    // Blackout eases over ~80 ms: instant to the eye, but never a hard flash.
    // With the TV's power effect the tube collapses first (~0.4 s), then the output fades.
    const crt = !!(this.retroTv?.enabled && this.retroTv.powerFx);
    this.blackout += ((g.blackout ? 1 : 0) - this.blackout) * (1 - Math.exp(-ctx.dt / (crt ? 0.14 : 0.03)));
    const power = crt ? 1 - Math.min(1, this.blackout / 0.8) : 1 - this.blackout;
    this.compositor.power = power;
    this.spare.power = power;
    if (this.pending && frame.beat >= this.pending.atBeat - 0.002) {
      const { scene, atBeat, transition } = this.pending;
      this.pending = null;
      // Quantized launches count the transition from the launch beat itself, so windows agree.
      this.goLive(scene, Number.isFinite(atBeat) ? atBeat : frame.beat, transition);
      if (Number.isFinite(atBeat)) this.lastSwitch = { beat: frame.beat, prevBeat: this.lastBeat };
    }
    this.lastBeat = frame.beat;
    let result = this.compositor.render(frame, ctx.dt, g);
    if (this.transition) {
      const tr = this.transition;
      this.transitionT = (frame.beat - tr.startBeat) / Math.max(1e-3, tr.beats);
      if (this.transitionT >= 1) {
        this.transition = null;
        // Free the outgoing look's generators and buffers.
        this.spare.setScene(EMPTY_SCENE);
      } else {
        const old = this.spare.render(frame, ctx.dt, g);
        this.blendTarget ??= hdrTarget(result.width, result.height);
        if (this.blendTarget.width !== result.width || this.blendTarget.height !== result.height) this.blendTarget.setSize(result.width, result.height);
        const bu = this.blend.material.uniforms;
        bu.uA.value = old.texture;
        bu.uB.value = result.texture;
        bu.uT.value = Math.max(0, this.transitionT);
        bu.uType.value = tr.type;
        (bu.uRes.value as THREE.Vector2).set(result.width, result.height);
        this.blend.render(this.renderer, this.blendTarget);
        result = this.blendTarget;
      }
    }
    const u = this.output.material.uniforms;
    u.uScene.value = result.texture;
    u.uExposure.value = g.brightness;
    u.uSaturation.value = g.saturation;
    u.uHueShift.value = (g.hueShift * Math.PI) / 180;
    const fade = crt ? Math.max(0, (this.blackout - 0.8) / 0.2) : this.blackout;
    u.uBlackout.value = fade > 0.999 ? 1 : fade;
    u.uFrame.value = this.frameIndex++ % 1024;
    this.output.render(this.renderer, null);
  }

  dispose(): void {
    window.clearTimeout(this.warmupTimer);
    this.warmup.dispose();
    this.compositor.dispose();
    this.spare.dispose();
    this.blend.dispose();
    this.blendTarget?.dispose();
    this.output.dispose();
    this.renderer.dispose();
  }
}
