/**
 * Composition, modulation and preset contracts.
 */
import type { AudioFrame, BandName, OnsetKind } from './audio';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type ParamValue = number | boolean | string;
export type ParamBag = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  type: 'float' | 'int' | 'bool' | 'enum' | 'text';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Short help shown as a tooltip. */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'difference' | 'lighten';
export const BLEND_MODES: readonly BlendMode[] = ['normal', 'add', 'screen', 'multiply', 'overlay', 'difference', 'lighten'];

export type LayerSourceType = 'generator' | 'clip' | 'text' | 'logo' | 'camera';

export interface LayerSource {
  type: LayerSourceType;
  /** Generator id, e.g. "spectrumBars", "polygon". */
  kind: string;
  params: ParamBag;
}

export interface FxInstance {
  /** Effect id, e.g. "bloom", "feedback", "kaleidoscope". */
  type: string;
  enabled: boolean;
  params: ParamBag;
}

export type MaskShape = 'circle' | 'rect' | 'ring' | 'linear' | 'triangle';

export interface LayerMask {
  /** luma: use the brightness of a lower layer; shape: a procedural shape. */
  type: 'luma' | 'shape';
  /** luma: index of the (lower) layer whose brightness is the mask. */
  layer?: number;
  shape?: MaskShape;
  /** Shape size, 0..1 of the frame. */
  size: number;
  feather: number;
  invert: boolean;
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

export const MAX_LAYERS = 8;

export interface PaletteCycle {
  mode: 'off' | 'beat' | 'bar' | 'phrase' | 'drop' | 'energy';
  /** Change every N units (beats / bars / phrases / drops). */
  every: number;
  /** Crossfade length in beats. */
  fadeBeats: number;
  /** Palettes to cycle through (the scene palette is used first if empty). */
  list: string[];
}

export interface HueRotate {
  mode: 'off' | 'lfo' | 'beat' | 'bar';
  /** lfo: Hz. beat/bar: degrees advanced per beat/bar. */
  rate: number;
  /** lfo: swing in degrees. */
  amount: number;
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

/** Everything the renderer needs to draw a look. */
export interface Scene {
  /** Up to 8 layers, bottom first. */
  layers: Layer[];
  palette: string;
  paletteCycle: PaletteCycle;
  hueRotate: HueRotate;
  /** Palettes defined inside this preset (name → 5 sRGB hex colours). */
  customPalettes?: Record<string, string[]>;
  macros: Macro[];
  camera?: CameraSpec;
}

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
export type EnvelopeTrigger = `onset.${OnsetKind | 'any'}` | 'drop' | 'downbeat' | 'phrase';

/**
 * Adds `offset + amount × source` (source 0..1 after curve/invert, optionally
 * clamped) to a parameter, in units of the parameter's full range. Several
 * modulators on one parameter are summed.
 */
export interface Modulator {
  /** Param path relative to the layer: "source.params.height", "fx.0.params.amount", "opacity". */
  target: string;
  source: ModSource;
  amount: number;
  offset?: number;
  curve?: ModCurve;
  /** Clamp the modulator's contribution (range units). */
  clamp?: [number, number];
  invert?: boolean;
  /** Tempo/LFO waveform. */
  shape?: ModShape;
  /** Tempo/random: period in beats (0.25..32). */
  rate?: number;
  /** LFO / smooth random: frequency in Hz. */
  hz?: number;
  /** Envelope trigger. */
  trigger?: EnvelopeTrigger;
  attackMs?: number;
  holdMs?: number;
  decayMs?: number;
  /** Random: sample-and-hold per `rate` beats, or smooth noise at `hz`. */
  randomMode?: 'hold' | 'smooth';
}

// ---------------------------------------------------------------------------
// Presets & templates
// ---------------------------------------------------------------------------

export interface MacroTarget {
  /** Scene path: "layers.0.source.params.height", "layers.1.fx.0.params.amount", "layers.0.modulators.2.amount". */
  path: string;
  range: [number, number];
  curve?: ModCurve;
}

export interface Macro {
  name: string;
  /** 0..1 */
  value: number;
  targets: MacroTarget[];
}

export const MACRO_COUNT = 8;

export interface TransitionSpec {
  type: 'crossfade' | 'cut' | 'lumaWipe' | 'blurDissolve' | 'glitchCut' | 'zoomThrough' | 'feedbackSmear' | 'flashWhite' | 'flashBlack';
  beats: number;
  quantize: 'none' | 'beat' | 'bar' | 'phrase';
}

export const PRESET_CATEGORIES = [
  'Equalizers',
  '2D Graphic',
  '3D Worlds',
  'Trippy / Psychedelic',
  'Mellow / Ambient',
  'Live Action to BPM',
  'Cartoon to BPM',
  'Random Clips to BPM',
  'Retro / Glitch',
  'Club / Strobe',
  'Logo / Branding',
  'Icons & Homages',
  'Pop Culture',
  'Lyrics',
] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

/** On-disk preset JSON (schema-versioned, hand-editable). */
export interface Preset extends Scene {
  schema: 1;
  name: string;
  category: PresetCategory;
  tags: string[];
  energy: 1 | 2 | 3 | 4 | 5;
  bpmHint?: [number, number];
  transitionIn?: TransitionSpec;
  /** Template = structure only (no palette or clips baked in). */
  isTemplate?: boolean;
  description?: string;
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
