/**
 * Parameter declarations for every generator and effect. Pure data (no
 * Three.js) so the control UI, the modulation compiler and the renderers all
 * share one source of truth.
 */
import type { ModSource, ParamBag, ParamSpec } from '@shared/types/engine';

export interface ModuleDef {
  kind: string;
  label: string;
  description: string;
  params: ParamSpec[];
}

const f = (key: string, label: string, def: number, min: number, max: number, step = 0.01, hint?: string): ParamSpec => ({ key, label, type: 'float', default: def, min, max, step, hint });
const i = (key: string, label: string, def: number, min: number, max: number, hint?: string): ParamSpec => ({ key, label, type: 'int', default: def, min, max, step: 1, hint });
const e = (key: string, label: string, def: string, options: string[], hint?: string): ParamSpec => ({ key, label, type: 'enum', default: def, options, hint });
const b = (key: string, label: string, def: boolean, hint?: string): ParamSpec => ({ key, label, type: 'bool', default: def, hint });
const t = (key: string, label: string, def: string, hint?: string): ParamSpec => ({ key, label, type: 'text', default: def, hint });

export const GENERATORS: ModuleDef[] = [
  {
    kind: 'spectrumBars',
    label: 'Spectrum bars',
    description: 'Log-frequency bar EQ with peak caps, LED segments, mirroring and a reflective floor.',
    params: [
      i('bars', 'Bars', 64, 8, 256),
      f('gap', 'Gap', 0.28, 0, 0.8),
      f('height', 'Height', 0.58, 0.1, 0.95),
      f('horizon', 'Horizon', 0.3, 0.05, 0.95),
      e('mirror', 'Mirror', 'none', ['none', 'center', 'sides'], 'center: grow up and down from the horizon · sides: lows in the middle'),
      i('segments', 'LED segments', 0, 0, 48, '0 = solid bars'),
      f('roundness', 'Roundness', 1, 0, 1),
      e('colorMode', 'Colour by', 'frequency', ['frequency', 'level']),
      b('caps', 'Peak caps', true),
      f('glow', 'Glow', 0.6, 0, 2),
      f('reflection', 'Reflection', 1, 0, 1),
      f('floor', 'Floor grid', 1, 0, 1),
      f('background', 'Background', 1, 0, 1),
      f('release', 'Fall time', 0.14, 0.02, 1),
      f('punch', 'Kick punch', 0.1, 0, 0.4),
    ],
  },
  {
    kind: 'radialSpectrum',
    label: 'Radial spectrum',
    description: 'Spectrum wrapped around a circle: a ring of bars or a smooth blooming flower.',
    params: [
      e('style', 'Style', 'bars', ['bars', 'bloom']),
      i('bars', 'Bars', 96, 16, 256),
      f('radius', 'Radius', 0.22, 0.05, 0.6),
      f('length', 'Length', 0.25, 0, 0.6),
      f('thickness', 'Thickness', 0.55, 0.05, 1),
      i('symmetry', 'Symmetry', 2, 1, 8),
      f('spin', 'Spin', 0.1, -1, 1, 0.01, 'turns per phrase'),
      f('core', 'Core glow', 0.6, 0, 2),
      f('glow', 'Glow', 0.8, 0, 2),
      f('release', 'Fall time', 0.15, 0.02, 1),
      f('punch', 'Kick punch', 0.15, 0, 0.5),
    ],
  },
  {
    kind: 'barCity',
    label: '3D bar city',
    description: 'Spectrum history extruded into a city of glowing towers with a beat-synced flyover.',
    params: [
      i('columns', 'Columns', 32, 8, 64),
      i('rows', 'Rows', 40, 8, 64),
      f('height', 'Height', 1.4, 0.2, 3),
      f('speed', 'Scroll', 1, 0, 4, 0.01, 'rows per beat'),
      f('camHeight', 'Camera height', 1, 0.1, 3),
      f('swing', 'Camera swing', 0.3, 0, 1),
      f('gap', 'Gap', 0.25, 0, 0.8),
      f('fog', 'Fog', 0.5, 0, 1),
      f('windows', 'Windows', 0.6, 0, 1),
      f('glow', 'Glow', 1, 0, 2),
    ],
  },
  {
    kind: 'spectrogram',
    label: 'Spectrogram',
    description: 'Scrolling waterfall of the spectrum over time.',
    params: [
      e('direction', 'Direction', 'down', ['down', 'up', 'left', 'right']),
      f('speed', 'Speed', 1, 0.25, 4),
      f('contrast', 'Contrast', 1.4, 0.5, 3),
      f('floor', 'Floor', 0.25, 0, 0.8),
      f('glow', 'Glow', 0.4, 0, 2),
      f('perspective', 'Perspective', 0, 0, 1),
    ],
  },
  {
    kind: 'scope',
    label: 'Oscilloscope',
    description: 'Phosphor-style waveform, stereo vectorscope (Lissajous) or polar ring.',
    params: [
      e('mode', 'Mode', 'wave', ['wave', 'lissajous', 'circle']),
      f('thickness', 'Thickness', 3, 0.5, 12, 0.1),
      f('gain', 'Gain', 1.2, 0.2, 4),
      f('glow', 'Glow', 1, 0, 2),
      f('smoothing', 'Smoothing', 0.3, 0, 1),
      f('color', 'Colour', 0.6, 0, 1, 0.01, 'position in the palette'),
      f('radius', 'Radius', 0.28, 0.1, 0.5),
      f('length', 'Length', 1, 0.1, 1),
    ],
  },
  {
    kind: 'lines',
    label: 'Line work',
    description: 'Minimal line drawings: ridge lines (Joy Division), displaced horizontals or concentric rings.',
    params: [
      e('mode', 'Mode', 'joy', ['joy', 'horizontal', 'radial']),
      i('count', 'Lines', 36, 4, 80),
      f('amplitude', 'Amplitude', 0.5, 0, 1),
      f('thickness', 'Thickness', 1.5, 0.5, 6, 0.1),
      f('speed', 'Speed', 1, 0, 4),
      f('spread', 'Spread', 0.75, 0.2, 1),
      f('perspective', 'Perspective', 0.3, 0, 1),
      f('color', 'Colour', 0.85, 0, 1),
      f('glow', 'Glow', 0.3, 0, 2),
    ],
  },
  {
    kind: 'polygon',
    label: 'Shape play',
    description: 'Morphing polygons with N-fold radial instancing and nested, rotating recursion.',
    params: [
      f('sides', 'Sides', 6, 3, 12, 0.01),
      f('roundness', 'Roundness', 0, 0, 1),
      f('beatMorph', 'Beat morph', 0, 0, 1, 0.01, 'triangle → square → hexagon → circle on each beat'),
      f('size', 'Size', 0.25, 0.05, 0.6),
      i('copies', 'Copies', 1, 1, 12),
      f('spread', 'Spread', 0.25, 0, 0.5),
      i('nested', 'Nested', 1, 1, 12),
      f('nestScale', 'Nest scale', 0.78, 0.5, 0.95),
      f('twist', 'Twist', 0.1, -1, 1),
      f('spin', 'Spin', 0.25, -2, 2, 0.01, 'turns per bar'),
      f('stroke', 'Stroke', 0.012, 0, 0.1, 0.001, '0 = filled'),
      f('fill', 'Fill', 0, 0, 1),
      f('glow', 'Glow', 0.6, 0, 2),
      f('pulse', 'Kick pulse', 0.15, 0, 0.5),
      f('colorSpread', 'Colour spread', 0.6, 0, 1),
      f('background', 'Background', 0.3, 0, 1),
    ],
  },
  {
    kind: 'swissGrid',
    label: 'Swiss grid',
    description: 'International-style modular grid: columns, blocks and dots driven by the EQ.',
    params: [
      e('mode', 'Mode', 'bars', ['bars', 'blocks', 'dots']),
      i('cols', 'Columns', 8, 2, 24),
      i('rows', 'Rows', 5, 2, 16),
      f('margin', 'Margin', 0.06, 0, 0.2),
      f('gutter', 'Gutter', 0.01, 0, 0.05, 0.001),
      f('accent', 'Accent', 0.5, 0, 1),
      f('lines', 'Grid lines', 0.6, 0, 1),
      f('shift', 'Bar shift', 0.5, 0, 1),
      b('paper', 'Paper (light)', true),
    ],
  },
  {
    kind: 'tiles',
    label: 'Tiles',
    description: 'Bauhaus primitives or Truchet tiles that flip on hats, snares or beats.',
    params: [
      e('style', 'Style', 'bauhaus', ['bauhaus', 'truchet', 'arcs']),
      i('cells', 'Cells', 6, 2, 24),
      e('flipOn', 'Flip on', 'hat', ['hat', 'snare', 'kick', 'beat', 'bar']),
      f('flipAmount', 'Flip amount', 0.35, 0, 1),
      f('ease', 'Flip time', 0.5, 0.05, 1),
      f('stroke', 'Stroke', 0.12, 0.02, 0.4),
      i('colors', 'Colours', 4, 2, 5),
      f('pulse', 'Zoom pulse', 0.05, 0, 0.3),
    ],
  },
  {
    kind: 'memphis',
    label: 'Memphis',
    description: 'Confetti of squiggles, zigzags, dots and solids that hop on the beat.',
    params: [
      f('density', 'Density', 1, 0.2, 2),
      f('scale', 'Scale', 1, 0.3, 2),
      f('drift', 'Drift', 0.4, 0, 2),
      f('jitter', 'Beat hop', 0.4, 0, 1),
      f('squiggle', 'Squiggles', 0.5, 0, 1),
      f('outline', 'Outlines', 0.5, 0, 1),
      f('background', 'Background', 1, 0, 1),
    ],
  },
  {
    kind: 'kineticType',
    label: 'Kinetic type',
    description: 'Your text, animated to the beat: stacked marquees, punches or a word per beat.',
    params: [
      t('text', 'Text', 'BOOFVIZ', 'Separate words with spaces or "/"'),
      e('mode', 'Mode', 'stack', ['stack', 'punch', 'words', 'marquee']),
      e('font', 'Font', 'heavy', ['heavy', 'condensed', 'mono', 'serif']),
      i('rows', 'Rows', 5, 1, 12),
      f('speed', 'Speed', 1, -4, 4, 0.01, 'text widths per 4 beats'),
      f('size', 'Size', 0.8, 0.2, 1.5),
      f('stretch', 'Bass stretch', 0.3, 0, 1),
      f('outline', 'Outline rows', 0.5, 0, 1),
      i('wordBeats', 'Beats per word', 1, 1, 16),
      f('skew', 'Skew', 0, -0.5, 0.5),
      f('punch', 'Kick punch', 0.2, 0, 0.6),
    ],
  },
  {
    kind: 'background',
    label: 'Background',
    description: 'Palette gradient backdrop with slow drift and a kick lift.',
    params: [
      e('style', 'Style', 'vertical', ['vertical', 'radial', 'diagonal', 'noise']),
      f('from', 'From', 0, 0, 1),
      f('to', 'To', 0.4, 0, 1),
      f('intensity', 'Intensity', 0.6, 0, 2),
      f('motion', 'Motion', 0.2, 0, 1),
      f('pulse', 'Kick lift', 0.2, 0, 1),
    ],
  },
];

export const EFFECTS: ModuleDef[] = [
  {
    kind: 'feedback',
    label: 'Feedback trails',
    description: 'Re-feeds the previous frame with zoom, rotation and fade.',
    params: [
      f('amount', 'Amount', 0.85, 0, 0.98),
      f('zoom', 'Zoom', 0.01, -0.05, 0.05, 0.001),
      f('rotate', 'Rotate', 0, -0.05, 0.05, 0.001),
      f('shiftX', 'Shift X', 0, -0.02, 0.02, 0.001),
      f('shiftY', 'Shift Y', 0, -0.02, 0.02, 0.001),
      f('hueDrift', 'Hue drift', 0, -0.05, 0.05, 0.001),
      e('blend', 'Blend', 'max', ['max', 'add', 'screen']),
    ],
  },
  {
    kind: 'bloom',
    label: 'Bloom',
    description: 'Soft glow from bright areas (multi-scale).',
    params: [f('strength', 'Strength', 0.8, 0, 3), f('threshold', 'Threshold', 0.6, 0, 2), f('radius', 'Radius', 0.6, 0, 1), f('knee', 'Knee', 0.5, 0, 1)],
  },
  {
    kind: 'mirror',
    label: 'Mirror',
    description: 'Reflect the image horizontally, vertically or into quadrants.',
    params: [e('mode', 'Mode', 'horizontal', ['horizontal', 'vertical', 'quad']), b('flip', 'Flip side', false)],
  },
  {
    kind: 'kaleidoscope',
    label: 'Kaleidoscope',
    description: 'N-fold mirror symmetry around the centre.',
    params: [i('segments', 'Segments', 6, 2, 16), f('spin', 'Spin', 0.05, -1, 1, 0.01, 'turns per bar'), f('zoom', 'Zoom', 1, 0.5, 2), f('angle', 'Angle', 0, 0, 1)],
  },
  {
    kind: 'rgbSplit',
    label: 'RGB split',
    description: 'Chromatic aberration: offsets the red and blue channels.',
    params: [f('amount', 'Amount', 0.006, 0, 0.05, 0.0005), f('angle', 'Angle', 0, 0, 1), f('radial', 'Radial', 0.5, 0, 1)],
  },
  {
    kind: 'gradientMap',
    label: 'Gradient map',
    description: 'Maps brightness onto the current palette.',
    params: [f('mix', 'Mix', 1, 0, 1), f('offset', 'Offset', 0, 0, 1), f('contrast', 'Contrast', 1, 0.5, 3)],
  },
  {
    kind: 'grade',
    label: 'Colour grade',
    description: 'Exposure, contrast, saturation, hue and temperature.',
    params: [f('exposure', 'Exposure', 0, -2, 2), f('contrast', 'Contrast', 1, 0.5, 2), f('saturation', 'Saturation', 1, 0, 2), f('hue', 'Hue', 0, -180, 180, 1), f('temperature', 'Temperature', 0, -1, 1)],
  },
  {
    kind: 'vignette',
    label: 'Vignette',
    description: 'Darkens the edges to focus the centre.',
    params: [f('amount', 'Amount', 0.4, 0, 1), f('size', 'Size', 0.8, 0.2, 1.5), f('softness', 'Softness', 0.5, 0.05, 1)],
  },
  {
    kind: 'grain',
    label: 'Film grain',
    description: 'Animated luminance grain.',
    params: [f('amount', 'Amount', 0.05, 0, 0.3), f('size', 'Size', 1, 0.5, 3)],
  },
];

const genMap = new Map(GENERATORS.map((g) => [g.kind, g]));
const fxMap = new Map(EFFECTS.map((x) => [x.kind, x]));

export function generatorDef(kind: string): ModuleDef | undefined {
  return genMap.get(kind);
}

export function effectDef(kind: string): ModuleDef | undefined {
  return fxMap.get(kind);
}

export function defaultParams(def: ModuleDef | undefined): ParamBag {
  const out: ParamBag = {};
  for (const p of def?.params ?? []) out[p.key] = p.default;
  return out;
}

export const OPACITY_SPEC: ParamSpec = { key: 'opacity', label: 'Opacity', type: 'float', default: 1, min: 0, max: 1, step: 0.01 };

/** Spec for a layer-relative path ("source.params.x", "fx.2.params.y", "opacity"). */
export function specForLayerPath(layer: { source: { kind: string }; fx: Array<{ type: string }> }, path: string): ParamSpec | undefined {
  if (path === 'opacity') return OPACITY_SPEC;
  const parts = path.split('.');
  if (parts[0] === 'source' && parts[1] === 'params') return generatorDef(layer.source.kind)?.params.find((p) => p.key === parts[2]);
  if (parts[0] === 'fx' && parts[2] === 'params') {
    const fx = layer.fx[Number(parts[1])];
    return fx ? effectDef(fx.type)?.params.find((p) => p.key === parts[3]) : undefined;
  }
  return undefined;
}

export function isNumericSpec(s: ParamSpec | undefined): boolean {
  return !!s && (s.type === 'float' || s.type === 'int');
}

// ---------------------------------------------------------------------------
// Modulation sources (for menus)
// ---------------------------------------------------------------------------

export interface ModSourceOption {
  source: ModSource;
  label: string;
  group: 'Audio' | 'Onset' | 'Tempo' | 'LFO' | 'Envelope' | 'Random';
  /** Extra fields the modulator starts with. */
  init?: Partial<import('@shared/types/engine').Modulator>;
}

export const MOD_SOURCES: ModSourceOption[] = [
  { source: 'audio.sub', label: 'Sub', group: 'Audio' },
  { source: 'audio.bass', label: 'Bass', group: 'Audio' },
  { source: 'audio.lowMid', label: 'Low mid', group: 'Audio' },
  { source: 'audio.mid', label: 'Mid', group: 'Audio' },
  { source: 'audio.highMid', label: 'High mid', group: 'Audio' },
  { source: 'audio.presence', label: 'Presence', group: 'Audio' },
  { source: 'audio.air', label: 'Air', group: 'Audio' },
  { source: 'audio.rms', label: 'RMS level', group: 'Audio' },
  { source: 'audio.energy', label: 'Energy (slow)', group: 'Audio' },
  { source: 'audio.flux', label: 'Flux', group: 'Audio' },
  { source: 'audio.brightness', label: 'Brightness', group: 'Audio' },
  { source: 'audio.onset.kick', label: 'Kick', group: 'Onset' },
  { source: 'audio.onset.snare', label: 'Snare', group: 'Onset' },
  { source: 'audio.onset.hat', label: 'Hat', group: 'Onset' },
  { source: 'audio.onset.any', label: 'Any onset', group: 'Onset' },
  { source: 'tempo.beat', label: 'Beat', group: 'Tempo', init: { shape: 'sine', rate: 1 } },
  { source: 'tempo.bar', label: 'Bar', group: 'Tempo', init: { shape: 'saw', rate: 4 } },
  { source: 'tempo.phrase', label: 'Phrase', group: 'Tempo', init: { shape: 'saw', rate: 16 } },
  { source: 'lfo', label: 'LFO', group: 'LFO', init: { shape: 'sine', hz: 0.25 } },
  { source: 'envelope', label: 'Kick envelope', group: 'Envelope', init: { trigger: 'onset.kick', attackMs: 5, holdMs: 30, decayMs: 250, curve: 'exp' } },
  { source: 'envelope', label: 'Snare envelope', group: 'Envelope', init: { trigger: 'onset.snare', attackMs: 5, holdMs: 20, decayMs: 200, curve: 'exp' } },
  { source: 'envelope', label: 'Drop envelope', group: 'Envelope', init: { trigger: 'drop', attackMs: 30, holdMs: 400, decayMs: 2500, curve: 'smooth' } },
  { source: 'random', label: 'Random per beat', group: 'Random', init: { randomMode: 'hold', rate: 1 } },
  { source: 'random', label: 'Random per bar', group: 'Random', init: { randomMode: 'hold', rate: 4 } },
  { source: 'random', label: 'Smooth noise', group: 'Random', init: { randomMode: 'smooth', hz: 0.3 } },
];

export function modSourceLabel(m: { source: ModSource; trigger?: string; randomMode?: string; rate?: number }): string {
  if (m.source === 'envelope') return `Env · ${m.trigger?.replace('onset.', '') ?? 'kick'}`;
  if (m.source === 'random') return m.randomMode === 'smooth' ? 'Noise' : `Random /${m.rate ?? 1}b`;
  return MOD_SOURCES.find((s) => s.source === m.source)?.label ?? m.source;
}
