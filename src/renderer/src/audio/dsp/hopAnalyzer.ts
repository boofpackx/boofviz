import { FFT_SIZE, HOP_SIZE, ONSET_FFT_SIZE, WAVEFORM_SIZE, type RawHop } from '@shared/types/audio';
import { FFT } from './fft';
import { kWeighting, MomentaryLoudness, type Biquad } from './loudness';

export interface HopAnalyzerSettings {
  gainDb: number;
  autoGain: boolean;
  gateDb: number;
}

export interface HopBuffers {
  mag: Float32Array;
  wave: Float32Array;
  left: Float32Array;
  right: Float32Array;
}

export function allocHopBuffers(): HopBuffers {
  return {
    mag: new Float32Array(FFT_SIZE / 2),
    wave: new Float32Array(WAVEFORM_SIZE),
    left: new Float32Array(WAVEFORM_SIZE),
    right: new Float32Array(WAVEFORM_SIZE),
  };
}

const AUTO_GAIN_TARGET_DB = -16;
const AUTO_GAIN_MIN_DB = -12;
const AUTO_GAIN_MAX_DB = 30;

interface FluxBand {
  lo: number;
  hi: number;
  weight: number;
}

function bandBins(sampleRate: number, size: number, f0: number, f1: number, weight = 1): FluxBand {
  const binHz = sampleRate / size;
  const lo = Math.max(1, Math.round(f0 / binHz));
  const hi = Math.min(size / 2 - 1, Math.max(lo, Math.round(f1 / binHz)));
  return { lo, hi, weight };
}

/**
 * Sample-level front end that runs inside the AudioWorklet: gain, auto-gain,
 * ring buffering, K-weighted loudness and, every HOP_SIZE samples, a long FFT
 * (spectrum) plus a short FFT (band-limited spectral flux for onsets).
 *
 * Pure TypeScript with no Web Audio dependencies so it can be unit-tested.
 */
export class HopAnalyzer {
  private readonly ringL = new Float32Array(FFT_SIZE);
  private readonly ringR = new Float32Array(FFT_SIZE);
  private write = 0;
  private sinceHop = 0;

  private readonly fft = new FFT(FFT_SIZE);
  private readonly shortFft = new FFT(ONSET_FFT_SIZE);
  private readonly fftIn = new Float32Array(FFT_SIZE);
  private readonly shortIn = new Float32Array(ONSET_FFT_SIZE);
  private readonly shortMag = new Float32Array(ONSET_FFT_SIZE / 2);
  private readonly shortLog = new Float32Array(ONSET_FFT_SIZE / 2);
  private readonly prevShortLog = new Float32Array(ONSET_FFT_SIZE / 2);

  private readonly kick: FluxBand[];
  private readonly snare: FluxBand[];
  private readonly hat: FluxBand[];
  private readonly all: FluxBand[];

  private readonly kL: [Biquad, Biquad];
  private readonly kR: [Biquad, Biquad];
  private readonly loudness: MomentaryLoudness;

  private manualGain = 1;
  private autoGainEnabled = true;
  private gateDb = -60;
  private autoLevelDb = AUTO_GAIN_TARGET_DB;
  private gain = 1;
  private gainTarget = 1;

  // Per-hop accumulators.
  private kSum = 0;
  private inSum = 0;
  private peak = 0;

  constructor(
    readonly sampleRate: number,
    private readonly emit: (hop: RawHop, buffers: HopBuffers) => void,
    private readonly acquire: () => HopBuffers = allocHopBuffers,
  ) {
    const sr = sampleRate;
    this.kick = [bandBins(sr, ONSET_FFT_SIZE, 40, 140)];
    this.snare = [bandBins(sr, ONSET_FFT_SIZE, 160, 320, 0.6), bandBins(sr, ONSET_FFT_SIZE, 1500, 5000, 1)];
    this.hat = [bandBins(sr, ONSET_FFT_SIZE, 7000, 16000)];
    this.all = [bandBins(sr, ONSET_FFT_SIZE, 30, 16000)];
    this.kL = kWeighting(sr);
    this.kR = kWeighting(sr);
    this.loudness = new MomentaryLoudness(Math.round((0.4 * sr) / HOP_SIZE));
  }

  setSettings(s: HopAnalyzerSettings): void {
    this.manualGain = Math.pow(10, s.gainDb / 20);
    this.autoGainEnabled = s.autoGain;
    this.gateDb = s.gateDb;
    if (!s.autoGain) this.gainTarget = this.manualGain;
  }

  /** Feed one render quantum. `right` may be null for mono sources. */
  process(left: Float32Array | undefined, right: Float32Array | undefined, frames: number, blockStartTime: number): void {
    const { ringL, ringR } = this;
    const mask = FFT_SIZE - 1;
    const [kl1, kl2] = this.kL;
    const [kr1, kr2] = this.kR;
    for (let i = 0; i < frames; i++) {
      const inL = left ? left[i] : 0;
      const inR = right ? right[i] : inL;
      const mL = inL * this.manualGain;
      const mR = inR * this.manualGain;
      // Loudness and gate reflect the real (manually gained) level, not the auto-gained one.
      const kL = kl2.process(kl1.process(mL));
      const kR = kr2.process(kr1.process(mR));
      this.kSum += kL * kL + kR * kR;
      this.inSum += 0.25 * (mL + mR) * (mL + mR);

      this.gain += (this.gainTarget - this.gain) * 0.0015;
      const l = inL * this.gain;
      const r = inR * this.gain;
      ringL[this.write] = l;
      ringR[this.write] = r;
      this.write = (this.write + 1) & mask;
      const a = Math.abs(0.5 * (l + r));
      if (a > this.peak) this.peak = a;

      if (++this.sinceHop >= HOP_SIZE) {
        this.sinceHop = 0;
        this.hop(blockStartTime + (i + 1) / this.sampleRate);
      }
    }
  }

  private hop(t: number): void {
    const n = FFT_SIZE;
    const mask = n - 1;
    const { ringL, ringR, fftIn } = this;
    const start = this.write; // oldest sample
    for (let i = 0; i < n; i++) {
      const j = (start + i) & mask;
      fftIn[i] = 0.5 * (ringL[j] + ringR[j]);
    }
    const buf = this.acquire();
    this.fft.magnitudes(fftIn, buf.mag);

    // Short FFT for onset flux.
    const sn = ONSET_FFT_SIZE;
    this.shortIn.set(fftIn.subarray(n - sn));
    this.shortFft.magnitudes(this.shortIn, this.shortMag);
    const { shortLog, prevShortLog } = this;
    for (let k = 0; k < sn / 2; k++) shortLog[k] = Math.log1p(1000 * this.shortMag[k]);
    const fluxKick = this.flux(this.kick);
    const fluxSnare = this.flux(this.snare);
    const fluxHat = this.flux(this.hat);
    const fluxAll = this.flux(this.all);
    prevShortLog.set(shortLog);

    // Waveforms + stereo stats over the last WAVEFORM_SIZE samples.
    const w = WAVEFORM_SIZE;
    let sLL = 0;
    let sRR = 0;
    let sLR = 0;
    let sMid = 0;
    let sSide = 0;
    for (let i = 0; i < w; i++) {
      const l = ringL[(start + n - w + i) & mask];
      const r = ringR[(start + n - w + i) & mask];
      buf.left[i] = l;
      buf.right[i] = r;
      buf.wave[i] = 0.5 * (l + r);
      sLL += l * l;
      sRR += r * r;
      sLR += l * r;
      sMid += (l + r) * (l + r);
      sSide += (l - r) * (l - r);
    }
    const rms = Math.sqrt((0.25 * sMid) / w);
    const corr = sLL > 1e-12 && sRR > 1e-12 ? sLR / Math.sqrt(sLL * sRR) : 1;
    const sideRatio = sMid > 1e-12 ? sSide / (sMid + sSide) : 0;

    const lufs = this.loudness.push(this.kSum, HOP_SIZE);

    // Auto-gain: follow the real input level and aim the visual signal at a fixed RMS.
    const inDb = 10 * Math.log10(this.inSum / HOP_SIZE + 1e-12);
    if (this.autoGainEnabled) {
      if (inDb > this.gateDb) {
        const hopSec = HOP_SIZE / this.sampleRate;
        const tau = inDb > this.autoLevelDb ? 0.8 : 4;
        this.autoLevelDb += (inDb - this.autoLevelDb) * (1 - Math.exp(-hopSec / tau));
      }
      const autoDb = Math.min(AUTO_GAIN_MAX_DB, Math.max(AUTO_GAIN_MIN_DB, AUTO_GAIN_TARGET_DB - this.autoLevelDb));
      this.gainTarget = this.manualGain * Math.pow(10, autoDb / 20);
    } else {
      this.gainTarget = this.manualGain;
    }

    const hop: RawHop = {
      type: 'hop',
      t,
      sampleRate: this.sampleRate,
      mag: buf.mag,
      wave: buf.wave,
      left: buf.left,
      right: buf.right,
      fluxKick,
      fluxSnare,
      fluxHat,
      fluxAll,
      rms,
      peak: this.peak,
      lufs,
      rmsL: Math.sqrt(sLL / w),
      rmsR: Math.sqrt(sRR / w),
      corr,
      sideRatio,
      appliedGain: this.gain,
      inputDb: inDb,
    };
    this.kSum = 0;
    this.inSum = 0;
    this.peak = 0;
    this.emit(hop, buf);
  }

  private flux(bands: FluxBand[]): number {
    let total = 0;
    let weight = 0;
    for (const b of bands) {
      let s = 0;
      for (let k = b.lo; k <= b.hi; k++) {
        const d = this.shortLog[k] - this.prevShortLog[k];
        if (d > 0) s += d;
      }
      total += (b.weight * s) / (b.hi - b.lo + 1);
      weight += b.weight;
    }
    return total / weight;
  }
}
