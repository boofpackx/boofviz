/**
 * Composition, modulation and preset contracts.
 *
 * Phase 1 renders a single generator layer; these types are the contract the
 * Phase 2 compositor, modulation system and preset store build on.
 */
import type { AudioFrame, BandName, OnsetKind } from './audio';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type ParamValue = number | boolean | string | [number, number, number];
export type ParamBag = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  type: 'float' | 'int' | 'bool' | 'enum' | 'color';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Whether modulators may target this param (all numeric params by default). */
  modulatable?: boolean;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'difference' | 'lighten';

export type LayerSourceType = 'generator' | 'clip' | 'text' | 'logo' | 'camera';

export interface LayerSource {
  type: LayerSourceType;
  /** Generator / technique id, e.g. "spectrumBars", "terrain". */
  kind: string;
  params: ParamBag;
}

export interface FxInstance {
  /** Effect id, e.g. "bloom", "feedback", "kaleidoscope". */
  type: string;
  enabled: boolean;
  params: ParamBag;
}

export interface LayerMask {
  type: 'luma' | 'shape';
  /** Index of the layer used as the luma source, or a shape id. */
  ref: number | string;
  invert: boolean;
  feather: number;
}

export interface Layer {
  id: string;
  name: string;
  enabled: boolean;
  source: LayerSource;
  fx: FxInstance[];
  blend: BlendMode;
  opacity: number;
  mask?: LayerMask;
  modulators: Modulator[];
}

export interface Scene {
  /** Up to 8 layers, bottom first. */
  layers: Layer[];
  palette: string;
  camera?: CameraSpec;
}

export interface CameraSpec {
  move: 'static' | 'orbit' | 'dolly' | 'truck' | 'crane' | 'roll' | 'dutch' | 'spline';
  /** Musical rate, e.g. "8 beats", "1 bar". */
  rate: string;
  punchOnKick: number;
  easing?: EasingName;
  snap?: boolean;
}

export type EasingName = 'linear' | 'inQuad' | 'outQuad' | 'inOutQuad' | 'outCubic' | 'inOutCubic' | 'outExpo' | 'inOutExpo' | 'outBack' | 'outElastic';

// ---------------------------------------------------------------------------
// Modulation
// ---------------------------------------------------------------------------

export type AudioModSource =
  | `audio.${BandName}`
  | 'audio.rms'
  | 'audio.energy'
  | 'audio.flux'
  | 'audio.brightness'
  | `audio.onset.${OnsetKind | 'any'}`;

export type TempoModSource = 'tempo.beat' | 'tempo.bar' | 'tempo.phrase';

export type ModSource = AudioModSource | TempoModSource | 'lfo' | 'envelope' | 'random';

export type ModShape = 'sine' | 'saw' | 'square' | 'ramp' | 'bounce' | 'stepped';
export type ModCurve = 'linear' | 'exp' | 'log' | 'smooth';

export interface Modulator {
  /** Param path relative to the layer, e.g. "source.params.height". */
  target: string;
  source: ModSource;
  amount: number;
  offset?: number;
  curve?: ModCurve;
  clamp?: [number, number];
  invert?: boolean;
  /** Tempo modulators: waveform shape and rate in beats (0.25..32). */
  shape?: ModShape;
  rate?: number;
  /** LFO: frequency in Hz. */
  hz?: number;
  /** Envelope: trigger + ADSR-ish times in ms. */
  trigger?: `onset.${OnsetKind | 'any'}` | 'drop';
  attackMs?: number;
  holdMs?: number;
  decayMs?: number;
  /** Random: sample-and-hold on beat/bar, or smooth noise. */
  randomMode?: 'holdBeat' | 'holdBar' | 'smooth';
}

// ---------------------------------------------------------------------------
// Presets & templates
// ---------------------------------------------------------------------------

export interface MacroTarget {
  path: string;
  range: [number, number];
  curve?: ModCurve;
}

export interface Macro {
  name: string;
  value?: number;
  targets: MacroTarget[];
}

export interface TransitionSpec {
  type: 'crossfade' | 'cut' | 'lumaWipe' | 'blurDissolve' | 'glitchCut' | 'zoomThrough' | 'feedbackSmear' | 'flashWhite' | 'flashBlack';
  beats: number;
  quantize: 'none' | 'beat' | 'bar' | 'phrase';
}

export type PresetCategory =
  | 'Equalizers'
  | '2D Graphic'
  | '3D Worlds'
  | 'Trippy / Psychedelic'
  | 'Mellow / Ambient'
  | 'Live Action to BPM'
  | 'Cartoon to BPM'
  | 'Random Clips to BPM'
  | 'Retro / Glitch'
  | 'Club / Strobe'
  | 'Logo / Branding';

/** On-disk preset JSON (schema-versioned, hand-editable). */
export interface Preset {
  schema: 1;
  name: string;
  category: PresetCategory;
  tags: string[];
  energy: 1 | 2 | 3 | 4 | 5;
  bpmHint?: [number, number];
  palette: string;
  layers: Array<Omit<Layer, 'id' | 'name' | 'enabled'> & Partial<Pick<Layer, 'id' | 'name' | 'enabled'>>>;
  camera?: CameraSpec;
  macros: Macro[];
  transitionIn?: TransitionSpec;
  /** Template = structure only (no palette/clips baked in). */
  isTemplate?: boolean;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export type RendererBackend = 'webgl2' | 'webgpu';

export interface RendererOptions {
  /** Internal render scale relative to the canvas size (0.5..2). */
  renderScale: number;
  /** Treat this instance as the clean output (never draws guides/overlays). */
  isOutput: boolean;
}

export interface RenderContext {
  /** Seconds since renderer start (wall clock). */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Global quick-controls layered over any preset. */
  globals: GlobalControls;
}

export interface GlobalControls {
  brightness: number;
  reactivity: number;
  speed: number;
  hueShift: number;
  saturation: number;
  trails: number;
  strobe: boolean;
  blackout: boolean;
}

export const DEFAULT_GLOBALS: GlobalControls = {
  brightness: 1,
  reactivity: 1,
  speed: 1,
  hueShift: 0,
  saturation: 1,
  trails: 0,
  strobe: false,
  blackout: false,
};

export interface RenderStats {
  fps: number;
  frameMs: number;
  width: number;
  height: number;
}

/**
 * Backend-agnostic renderer. The WebGL2/Three.js implementation lives in
 * engine/three; a WebGPU backend can implement the same contract later.
 */
export interface Renderer {
  readonly backend: RendererBackend;
  init(canvas: HTMLCanvasElement, options: RendererOptions): Promise<void>;
  setScene(scene: Scene): void;
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  render(frame: AudioFrame, ctx: RenderContext): void;
  readonly stats: RenderStats;
  dispose(): void;
}
