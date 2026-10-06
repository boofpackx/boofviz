import {
  BAND_NAMES,
  DEFAULT_ANALYSIS_SETTINGS,
  FFT_SIZE,
  HOP_SIZE,
  SPECTRUM_BINS,
  type AnalysisSettings,
  type EnergyTrend,
  type RawHop,
} from '@shared/types/audio';
import { OnsetDetector } from './onset';
import { AttackRelease, coef, DbNormalizer } from './smoothing';
import { BandPower, LogSpectrum, logBandEdges, namedBandEdges, spectralBrightness } from './spectrum';

/** Per-hop musical features, everything in an AnalysisPacket except tempo/clock. */
export interface HopFeatures {
  t: number;
  fft: Float32Array;
  bands: Float32Array;
  bands32: Float32Array;
  rms: number;
  peak: number;
  lufs: number;
  energy: number;
  energyTrend: EnergyTrend;
  kick: boolean;
  snare: boolean;
  hat: boolean;
  any: boolean;
  odfKick: number;
  odfSnare: number;
  odfHat: number;
  brightness: number;
  flux: number;
  drop: boolean;
  silence: boolean;
  width: number;
  phase: number;
  balance: number;
  inputLevelDb: number;
  /** Onset-strength value for the tempo estimator. */
  tempoOdf: number;
  /** Normalized bass level (for downbeat estimation). */
  bassLevel: number;
}

/**
 * Turns raw worklet hops into musical features: log spectrum, auto-normalized
 * bands with per-band attack/release, adaptive onsets, energy, drops, silence.
 * Runs in the analysis worker; pure and deterministic for unit tests.
 */
export class AnalysisCore {
  readonly hopSec: number;
  readonly hopRate: number;
  private settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS;

  private readonly logSpec: LogSpectrum;
  private readonly bandPower: BandPower;
  private readonly band32Power: BandPower;
  private readonly bandDb = new Float32Array(BAND_NAMES.length);
  private readonly band32Db = new Float32Array(32);
  private readonly bandNorm: DbNormalizer[];
  private readonly bandSmooth: AttackRelease[];
  private readonly band32Smooth: AttackRelease[];
  private readonly specRaw = new Float32Array(SPECTRUM_BINS);
  private readonly specSmooth = new Float32Array(SPECTRUM_BINS);
  private specA = 1;
  private specR = 1;

  readonly kick: OnsetDetector;
  readonly snare: OnsetDetector;
  readonly hat: OnsetDetector;
  private sinceAny = 1e9;

  // Flux / tempo normalization.
  private fluxMax = 1e-3;
  private kickMax = 1e-3;
  private fluxSmooth = 0;

  // Energy.
  private loudRef = -30;
  private onsetRate = 0;
  private energyShort = 0;
  private energyLong = 0;
  private energy = 0;
  private brightness = 0;

  // Drop detection.
  private bassSlow = 0;
  private bassFast = 0;
  private bassRef = -60;
  private breakdownSec = 0;
  private armed = false;
  private sinceDrop = 1e9;

  // Silence.
  private quietSec = 0;
  private silent = true;

  private width = 0;
  private phase = 1;
  private balance = 0;

  constructor(readonly sampleRate: number) {
    this.hopSec = HOP_SIZE / sampleRate;
    this.hopRate = 1 / this.hopSec;
    this.logSpec = new LogSpectrum(sampleRate, FFT_SIZE, SPECTRUM_BINS);
    this.bandPower = new BandPower(sampleRate, FFT_SIZE, namedBandEdges());
    this.band32Power = new BandPower(sampleRate, FFT_SIZE, logBandEdges(32), 3);
    this.bandNorm = BAND_NAMES.map(() => new DbNormalizer(this.hopSec, 26, 10));
    this.bandSmooth = BAND_NAMES.map(() => new AttackRelease(this.hopSec, 10, 150));
    this.band32Smooth = Array.from({ length: 32 }, () => new AttackRelease(this.hopSec, 10, 140));
    this.kick = new OnsetDetector(this.hopRate, 0.8, 0.14);
    this.snare = new OnsetDetector(this.hopRate, 0.6, 0.11);
    this.hat = new OnsetDetector(this.hopRate, 0.4, 0.06);
    this.setSettings(DEFAULT_ANALYSIS_SETTINGS);
  }

  setSettings(s: AnalysisSettings): void {
    this.settings = s;
    BAND_NAMES.forEach((name, i) => {
      const sm = s.bandSmoothing[name];
      this.bandSmooth[i].set(this.hopSec, sm.attackMs, sm.releaseMs);
    });
    for (const b of this.band32Smooth) b.set(this.hopSec, s.spectrumSmoothing.attackMs, s.spectrumSmoothing.releaseMs);
    this.specA = coef(this.hopSec, s.spectrumSmoothing.attackMs / 1000);
    this.specR = coef(this.hopSec, s.spectrumSmoothing.releaseMs / 1000);
    this.kick.sensitivity = s.onsetSensitivity.kick;
    this.snare.sensitivity = s.onsetSensitivity.snare;
    this.hat.sensitivity = s.onsetSensitivity.hat;
  }

  process(hop: RawHop, out: HopFeatures): HopFeatures {
    const dt = this.hopSec;

    // --- Silence / gate (on the real input level, before auto-gain) ---
    const gate = this.settings.gateDb;
    if (hop.inputDb < gate) this.quietSec += dt;
    else if (hop.inputDb > gate + 3) this.quietSec = 0;
    this.silent = this.quietSec > 0.4;
    const silent = this.silent;

    // --- Spectrum (2048 log bins, smoothed) ---
    this.logSpec.map(hop.mag, this.specRaw);
    const spec = this.specSmooth;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const x = silent ? 0 : this.specRaw[i];
      spec[i] += (x - spec[i]) * (x > spec[i] ? this.specA : this.specR);
    }
    out.fft = spec;

    // --- Named bands: power → dB → auto-normalize → attack/release ---
    this.bandPower.measure(hop.mag, this.bandDb);
    for (let i = 0; i < BAND_NAMES.length; i++) {
      const norm = this.bandNorm[i].step(this.bandDb[i]);
      out.bands[i] = this.bandSmooth[i].step(silent ? 0 : norm);
    }

    // --- 32-band EQ (absolute dB window with pink tilt so bars read musically) ---
    this.band32Power.measure(hop.mag, this.band32Db);
    for (let i = 0; i < 32; i++) {
      const v = (this.band32Db[i] + 62) / 56;
      out.bands32[i] = this.band32Smooth[i].step(silent ? 0 : v < 0 ? 0 : v > 1 ? 1 : v);
    }

    // --- Onsets ---
    const kick = this.kick.step(hop.fluxKick, silent);
    const snare = this.snare.step(hop.fluxSnare, silent);
    const hat = this.hat.step(hop.fluxHat, silent);
    this.sinceAny++;
    const any = (kick || snare || hat) && this.sinceAny * dt > 0.05;
    if (any) this.sinceAny = 0;

    // --- Flux (normalized, smoothed) and tempo onset-strength envelope ---
    this.fluxMax = Math.max(hop.fluxAll, this.fluxMax * Math.exp(-dt / 10), 1e-4);
    this.kickMax = Math.max(hop.fluxKick, this.kickMax * Math.exp(-dt / 10), 1e-4);
    const fluxN = silent ? 0 : hop.fluxAll / this.fluxMax;
    this.fluxSmooth += (fluxN - this.fluxSmooth) * coef(dt, 0.25);
    const tempoOdf = silent ? 0 : 0.6 * fluxN + 0.4 * (hop.fluxKick / this.kickMax);

    // --- Brightness ---
    const bright = silent ? this.brightness : spectralBrightness(hop.mag, hop.sampleRate, FFT_SIZE);
    this.brightness += (bright - this.brightness) * coef(dt, 0.6);

    // --- Energy: loudness vs. the track's recent hottest level, bass presence, onset density ---
    if (!silent) {
      if (hop.lufs > this.loudRef) this.loudRef += (hop.lufs - this.loudRef) * coef(dt, 0.5);
      else this.loudRef += (hop.lufs - this.loudRef) * coef(dt, 60);
    }
    const relLoud = silent ? 0 : clamp01((hop.lufs - (this.loudRef - 12)) / 12);
    this.onsetRate += ((any ? 1 / dt : 0) - this.onsetRate) * coef(dt, 2);
    const bass = (out.bands[0] + out.bands[1]) * 0.5;
    const inst = silent ? 0 : 0.45 * relLoud + 0.3 * bass + 0.25 * clamp01(this.onsetRate / 6);
    this.energyShort += (inst - this.energyShort) * coef(dt, 1.5);
    this.energyLong += (inst - this.energyLong) * coef(dt, 8);
    this.energy += (inst - this.energy) * coef(dt, inst > this.energy ? 2.5 : 5);
    const diff = this.energyShort - this.energyLong;
    const energyTrend: EnergyTrend = diff > 0.06 ? 'building' : diff < -0.06 ? 'dropping' : 'steady';

    // --- Drop: sustained bass absence (breakdown) then a sudden bass return ---
    // Measured on the real input level (auto-gain removed) so riding the gain can't fake one.
    const gainDb = 20 * Math.log10(Math.max(hop.appliedGain, 1e-6));
    const bassPow = Math.pow(10, (this.bandDb[0] - gainDb) / 10) + Math.pow(10, (this.bandDb[1] - gainDb) / 10);
    this.bassSlow += (bassPow - this.bassSlow) * coef(dt, 0.5);
    this.bassFast += (bassPow - this.bassFast) * coef(dt, 0.04);
    const slowDb = 10 * Math.log10(this.bassSlow + 1e-12);
    const fastDb = 10 * Math.log10(this.bassFast + 1e-12);
    if (!silent) {
      if (slowDb > this.bassRef) this.bassRef += (slowDb - this.bassRef) * coef(dt, 1);
      else this.bassRef -= 0.15 * dt; // relax 0.15 dB/s
    }
    this.sinceDrop += dt;
    let drop = false;
    if (!silent && slowDb < this.bassRef - 8) {
      this.breakdownSec += dt;
      if (this.breakdownSec > 2.5) this.armed = true;
    } else if (!this.armed && slowDb > this.bassRef - 4) {
      this.breakdownSec = 0;
    }
    if (this.armed && !silent && fastDb > this.bassRef - 3) {
      drop = this.sinceDrop > 8;
      if (drop) this.sinceDrop = 0;
      this.armed = false;
      this.breakdownSec = 0;
    }

    // --- Stereo ---
    this.width += (hop.sideRatio * 2 - this.width) * coef(dt, 0.3);
    this.phase += (hop.corr - this.phase) * coef(dt, 0.3);
    const lr = hop.rmsL + hop.rmsR;
    this.balance += ((lr > 1e-6 ? (hop.rmsR - hop.rmsL) / lr : 0) - this.balance) * coef(dt, 0.3);

    out.t = hop.t;
    out.rms = silent ? 0 : hop.rms;
    out.peak = silent ? 0 : hop.peak;
    out.lufs = hop.lufs;
    out.energy = clamp01(this.energy);
    out.energyTrend = energyTrend;
    out.kick = kick;
    out.snare = snare;
    out.hat = hat;
    out.any = any;
    out.odfKick = this.kick.level;
    out.odfSnare = this.snare.level;
    out.odfHat = this.hat.level;
    out.brightness = this.brightness;
    out.flux = clamp01(this.fluxSmooth * 1.5);
    out.drop = drop;
    out.silence = silent;
    out.width = clamp01(this.width);
    out.phase = this.phase;
    out.balance = this.balance;
    out.inputLevelDb = hop.inputDb;
    out.tempoOdf = tempoOdf;
    out.bassLevel = bass;
    return out;
  }

  static allocFeatures(): HopFeatures {
    return {
      t: 0,
      fft: new Float32Array(SPECTRUM_BINS),
      bands: new Float32Array(BAND_NAMES.length),
      bands32: new Float32Array(32),
      rms: 0,
      peak: 0,
      lufs: -70,
      energy: 0,
      energyTrend: 'steady',
      kick: false,
      snare: false,
      hat: false,
      any: false,
      odfKick: 0,
      odfSnare: 0,
      odfHat: 0,
      brightness: 0,
      flux: 0,
      drop: false,
      silence: true,
      width: 0,
      phase: 1,
      balance: 0,
      inputLevelDb: -120,
      tempoOdf: 0,
      bassLevel: 0,
    };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
