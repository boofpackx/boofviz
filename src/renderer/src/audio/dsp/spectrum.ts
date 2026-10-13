import { BAND_EDGES, BAND_NAMES } from '@shared/types/audio';

const EPS = 1e-12;

/** dB of a linear magnitude. */
export function magDb(m: number): number {
  return 20 * Math.log10(m + 1e-9);
}

interface BinRange {
  lo: number;
  hi: number;
  /** Fractional bin position for interpolation when lo === hi. */
  pos: number;
  /** Pink-noise tilt compensation in dB (so music reads roughly flat). */
  tiltDb: number;
}

function tiltFor(freq: number, dbPerOctave: number): number {
  return dbPerOctave * Math.log2(Math.max(freq, 20) / 1000);
}

/**
 * Maps a linear FFT magnitude array onto `outBins` log-spaced bins from fMin to
 * Nyquist (interpolating where output is denser than input, taking the max
 * where several input bins fold into one), then to 0..1 via a dB window.
 */
export class LogSpectrum {
  private readonly ranges: BinRange[];

  constructor(
    sampleRate: number,
    fftSize: number,
    readonly outBins: number,
    readonly fMin = 20,
    private readonly floorDb = -78,
    private readonly ceilDb = -6,
    tiltDbPerOctave = 3,
  ) {
    const binHz = sampleRate / fftSize;
    const nyquist = sampleRate / 2;
    const fMax = Math.min(20000, nyquist);
    const inBins = fftSize / 2;
    this.ranges = [];
    for (let i = 0; i < outBins; i++) {
      const f0 = fMin * Math.pow(fMax / fMin, i / outBins);
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / outBins);
      const lo = Math.min(inBins - 1, Math.floor(f0 / binHz));
      const hi = Math.min(inBins - 1, Math.max(lo, Math.floor(f1 / binHz)));
      const center = Math.sqrt(f0 * f1);
      this.ranges.push({ lo, hi, pos: Math.min(inBins - 1.001, center / binHz), tiltDb: tiltFor(center, tiltDbPerOctave) });
    }
  }

  map(mag: Float32Array, out: Float32Array): void {
    const span = this.ceilDb - this.floorDb;
    for (let i = 0; i < this.outBins; i++) {
      const r = this.ranges[i];
      let m: number;
      if (r.hi - r.lo <= 1) {
        const p = r.pos;
        const k = Math.floor(p);
        const f = p - k;
        m = mag[k] * (1 - f) + mag[k + 1] * f;
      } else {
        m = 0;
        for (let k = r.lo; k <= r.hi; k++) if (mag[k] > m) m = mag[k];
      }
      const v = (magDb(m) + r.tiltDb - this.floorDb) / span;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
}

/** Sums FFT power inside fixed frequency bands and reports dB per band. */
export class BandPower {
  private readonly ranges: Array<{ lo: number; hi: number; tiltDb: number }>;

  constructor(sampleRate: number, fftSize: number, edges: Array<[number, number]>, tiltDbPerOctave = 0) {
    const binHz = sampleRate / fftSize;
    const maxBin = fftSize / 2 - 1;
    this.ranges = edges.map(([f0, f1]) => {
      const lo = Math.min(maxBin, Math.max(1, Math.round(f0 / binHz)));
      const hi = Math.min(maxBin, Math.max(lo, Math.round(f1 / binHz) - 1));
      return { lo, hi, tiltDb: tiltFor(Math.sqrt(f0 * f1), tiltDbPerOctave) };
    });
  }

  get count(): number {
    return this.ranges.length;
  }

  /** Writes band levels in dB (power sum, i.e. energy in the band) to `outDb`. */
  measure(mag: Float32Array, outDb: Float32Array): void {
    for (let b = 0; b < this.ranges.length; b++) {
      const { lo, hi, tiltDb } = this.ranges[b];
      let p = 0;
      for (let k = lo; k <= hi; k++) p += mag[k] * mag[k];
      outDb[b] = 10 * Math.log10(p + EPS) + tiltDb;
    }
  }
}

export function namedBandEdges(): Array<[number, number]> {
  return BAND_NAMES.map((n) => BAND_EDGES[n]);
}

/** 32 log-spaced band edges from 20 Hz to 20 kHz. */
export function logBandEdges(count = 32, fMin = 20, fMax = 20000): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    edges.push([fMin * Math.pow(fMax / fMin, i / count), fMin * Math.pow(fMax / fMin, (i + 1) / count)]);
  }
  return edges;
}

/** Spectral centroid mapped to 0..1 on a log-frequency axis (50 Hz → 12 kHz). */
export function spectralBrightness(mag: Float32Array, sampleRate: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  let num = 0;
  let den = 0;
  const hi = Math.min(mag.length, Math.floor(16000 / binHz));
  for (let k = 1; k < hi; k++) {
    const p = mag[k] * mag[k];
    num += p * k * binHz;
    den += p;
  }
  if (den < EPS) return 0;
  const c = num / den;
  const v = Math.log(c / 50) / Math.log(12000 / 50);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * How strongly the spectrum looks like a voice right now (raw, unnormalised):
 * the best harmonic series for a pitch in the singing range (90–700 Hz, up to
 * eight harmonics), weighted toward the 1–4 kHz presence region where a voice
 * sits in a mix. Instruments with clear pitches score too, so callers
 * normalise it adaptively and combine it with other hints. About 1,500
 * multiply-adds a hop.
 */
export function voicePresence(mag: Float32Array, sampleRate: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(90 / binHz));
  const top = Math.min(mag.length - 2, Math.floor(5600 / binHz));
  let mean = 0;
  for (let k = lo; k <= top; k++) mean += mag[k];
  mean /= Math.max(1, top - lo + 1);
  if (mean < EPS) return 0;
  let best = 0;
  for (let f0 = 90; f0 <= 700; f0 += binHz) {
    let sum = 0;
    let n = 0;
    for (let h = 1; h <= 8; h++) {
      const b = Math.round((f0 * h) / binHz);
      if (b + 1 > top) break;
      const peak = Math.max(mag[b - 1], mag[b], mag[b + 1]);
      // Harmonics in the presence band count more: that is where a voice cuts through.
      const hz = f0 * h;
      sum += peak * (hz > 1000 && hz < 4000 ? 1.4 : 1);
      n++;
    }
    if (n >= 4) best = Math.max(best, sum / n);
  }
  let pres = 0;
  let all = 0;
  for (let k = lo; k <= top; k++) {
    const p = mag[k] * mag[k];
    all += p;
    if (k * binHz > 1000 && k * binHz < 4000) pres += p;
  }
  const presence = all > EPS ? pres / all : 0;
  return (best / mean) * (0.5 + presence);
}
