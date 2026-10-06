import type { AudioFrame } from '@shared/types/audio';
import type { Scene } from '@shared/types/engine';
import { alignedBeat } from './modulation';

/**
 * Curated 5-colour palette packs (sRGB hex), darkest → lightest by convention:
 * generators use stop 0 as background and stop 4 as highlight.
 */
export const PALETTES: Record<string, readonly string[]> = {
  Neon: ['#0b0630', '#3a0ca3', '#f72585', '#4cc9f0', '#e0fbfc'],
  Vaporwave: ['#1a1036', '#5b2a86', '#ff71ce', '#01cdfe', '#fffb96'],
  Acid: ['#050505', '#1b5e20', '#aeea00', '#ffea00', '#f5f5f5'],
  Sunset: ['#1d0f2e', '#6a1b4d', '#e8505b', '#f9a65a', '#ffe8a3'],
  Mono: ['#050505', '#2b2b2b', '#6e6e6e', '#bdbdbd', '#ffffff'],
  Ocean: ['#020c1b', '#0a3d62', '#0f7ea6', '#38d9c3', '#d8fff8'],
  Infrared: ['#0a0000', '#4a0000', '#c1121f', '#ff7b00', '#fff3b0'],
  Pastel: ['#2d2a3e', '#a39fe1', '#f7a8c4', '#a8e6cf', '#fdfd96'],
  'Brutalist B&W': ['#000000', '#1a1a1a', '#ffffff', '#ffffff', '#ff2d00'],
  'Film Stock': ['#14110f', '#3d2b1f', '#8a6a4b', '#d9b382', '#f2e8cf'],
};

export const PALETTE_NAMES = Object.keys(PALETTES);

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string, out: Float32Array, offset: number): void {
  const v = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  out[offset] = srgbToLinear(((v >> 16) & 255) / 255);
  out[offset + 1] = srgbToLinear(((v >> 8) & 255) / 255);
  out[offset + 2] = srgbToLinear((v & 255) / 255);
}

export function paletteHexes(name: string, custom?: Record<string, string[]>): readonly string[] {
  return custom?.[name] ?? PALETTES[name] ?? PALETTES.Neon;
}

/** Palette as linear-RGB triplets, flattened (5 × 3). */
export function paletteLinear(name: string, custom?: Record<string, string[]>): Float32Array {
  const out = new Float32Array(15);
  paletteHexes(name, custom).forEach((hex, i) => hexToLinear(hex, out, i * 3));
  return out;
}

/** Rotate a linear-RGB colour around the grey axis (same maths as the output pass). */
function hueRotate(out: Float32Array, o: number, deg: number): void {
  if (deg === 0) return;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = 0.57735;
  const r = out[o];
  const g = out[o + 1];
  const b = out[o + 2];
  const dot = k * (r + g + b);
  // v*cos + (k × v)*sin + k(k·v)(1-cos)
  const cx = k * (b - g);
  const cy = k * (r - b);
  const cz = k * (g - r);
  out[o] = Math.max(0, r * c + cx * s + k * dot * (1 - c));
  out[o + 1] = Math.max(0, g * c + cy * s + k * dot * (1 - c));
  out[o + 2] = Math.max(0, b * c + cz * s + k * dot * (1 - c));
}

function smooth(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * Per-frame palette: cycles through a list on beat/bar/phrase/drop/energy with
 * crossfades, then applies hue rotation. Stateless for tempo modes (derived
 * from the beat counter), so every window shows the same colours.
 */
export class PaletteRuntime {
  readonly current = new Float32Array(15);
  private cache = new Map<string, Float32Array>();
  private scene: Scene | null = null;
  private drops = 0;
  private dropTime = -Infinity;
  private energyIdx = 0;

  setScene(scene: Scene): void {
    this.scene = scene;
    this.cache.clear();
  }

  private colors(name: string): Float32Array {
    let c = this.cache.get(name);
    if (!c) {
      c = paletteLinear(name, this.scene?.customPalettes);
      this.cache.set(name, c);
    }
    return c;
  }

  update(f: AudioFrame, dt: number): Float32Array {
    const scene = this.scene;
    const out = this.current;
    if (!scene) return out;
    const cyc = scene.paletteCycle;
    const list = cyc.list.length ? cyc.list : [scene.palette];
    let a = scene.palette;
    let b = scene.palette;
    let t = 0;

    if (cyc.mode !== 'off' && list.length > 1) {
      const n = list.length;
      const every = Math.max(1, cyc.every);
      if (cyc.mode === 'beat' || cyc.mode === 'bar' || cyc.mode === 'phrase') {
        const unit = cyc.mode === 'beat' ? 1 : cyc.mode === 'bar' ? f.beatsPerBar : f.beatsPerPhrase;
        const period = every * unit;
        const pos = alignedBeat(f) / period;
        const idx = Math.floor(pos);
        const into = (pos - idx) * period; // beats into this period
        b = list[((idx % n) + n) % n];
        a = list[(((idx - 1) % n) + n) % n];
        t = cyc.fadeBeats > 0 ? smooth(into / cyc.fadeBeats) : 1;
      } else if (cyc.mode === 'drop') {
        if (f.drop) {
          this.drops++;
          this.dropTime = f.time;
        }
        const idx = Math.floor(this.drops / every);
        b = list[idx % n];
        a = list[(idx - 1 + n) % n];
        const fadeSec = (cyc.fadeBeats * 60) / Math.max(1, f.bpm);
        t = fadeSec > 0 ? smooth((f.time - this.dropTime) / fadeSec) : 1;
      } else if (cyc.mode === 'energy') {
        this.energyIdx += (f.energy * (n - 1) - this.energyIdx) * (1 - Math.exp(-dt / 1.5));
        const i0 = Math.min(n - 1, Math.floor(this.energyIdx));
        a = list[i0];
        b = list[Math.min(n - 1, i0 + 1)];
        t = smooth(this.energyIdx - i0);
      }
    }

    const ca = this.colors(a);
    const cb = this.colors(b);
    for (let i = 0; i < 15; i++) out[i] = ca[i] + (cb[i] - ca[i]) * t;

    const hr = scene.hueRotate;
    let deg = 0;
    if (hr.mode === 'lfo') deg = hr.amount * Math.sin(2 * Math.PI * hr.rate * f.time);
    else if (hr.mode === 'beat') deg = hr.rate * f.beat;
    else if (hr.mode === 'bar') deg = (hr.rate * f.beat) / f.beatsPerBar;
    deg %= 360;
    if (deg) for (let i = 0; i < 5; i++) hueRotate(out, i * 3, deg);
    return out;
  }
}
