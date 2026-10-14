import { HOP_SIZE } from '@shared/types/audio';
import { FFT } from '../dsp/fft';
import { OnsetDetector } from '../dsp/onset';
import { Hpss } from './hpss';
import { StereoStream } from './stream';

const SHORT = 1024;

/**
 * One drum: an adaptive onset detector, then a check against how hard this
 * drum's real hits have been lately: a guitar or bass attack can poke over
 * the adaptive threshold (it adapts to whatever is playing, drums or not)
 * but is far weaker than a kick, so it doesn't count.
 */
class DrumVoice {
  readonly det: OnsetDetector;
  private ref = 0;
  constructor(
    hopRate: number,
    history: number,
    refractory: number,
    sensitivity: number,
    private readonly minRel: number,
  ) {
    this.det = new OnsetDetector(hopRate, history, refractory);
    this.det.sensitivity = sensitivity;
  }

  /** Strength 0..1 of a hit this hop (0: none). */
  step(flux: number, silent: boolean): number {
    // The reference relaxes (half-life ≈ 20 s) so a quieter part of the song re-adapts.
    this.ref *= 0.99965;
    if (!this.det.step(flux, silent)) return 0;
    if (flux < this.ref * this.minRel) return 0;
    // The reference follows the hardest recent hits.
    this.ref = Math.max(this.ref, flux);
    return Math.min(1, flux / this.ref);
  }
}

export interface DrumHits {
  /** Audio time the hits are for (HPSS is a few hops late). */
  t: number;
  /** Strength of each hit this hop (0: none). */
  kick: number;
  snare: number;
  hat: number;
  /** A cymbal that rang on (a hat hit whose top end held for a quarter second), dated to its hit. */
  crash: { t: number; strength: number } | null;
}

/** Rise in amplitude (linear: a big hit stands out from the small ones around it). */
function flux(prev: number, cur: number): number {
  return Math.max(0, Math.sqrt(cur) - Math.sqrt(prev));
}

/**
 * The drum kit, from the percussive part of a short-window HPSS: a kick is a
 * hit low down, a snare a hit with both its body (150–400 Hz) and its rattle
 * (1.5–6 kHz), a hat a hit at the top. Bass notes and strummed chords are
 * tones, so they stay out (the plain onset detectors fire on them too).
 */
export class DrumTracker {
  readonly hpss: Hpss;
  private readonly fft = new FFT(SHORT);
  private readonly input = new Float32Array(SHORT);
  private readonly mag = new Float32Array(SHORT / 2);
  private readonly kick: DrumVoice;
  private readonly snare: DrumVoice;
  private readonly hat: DrumVoice;
  private readonly kickBands: [number, number];
  private readonly lowBands: [number, number];
  private readonly midBands: [number, number];
  private readonly hatBands: [number, number];
  private prev = { kick: 0, low: 0, mid: 0, hat: 0 };
  private readonly prevPerc = new Float32Array(96);
  private cymbals: Array<{ t: number; peak: number; low: number; strength: number }> = [];
  readonly out: DrumHits = { t: 0, kick: 0, snare: 0, hat: 0, crash: null };

  constructor(readonly sampleRate: number) {
    const hopRate = sampleRate / HOP_SIZE;
    this.hpss = new Hpss(sampleRate, SHORT);
    this.kick = new DrumVoice(hopRate, 0.8, 0.12, 0.55, 0.6);
    this.snare = new DrumVoice(hopRate, 0.6, 0.1, 0.5, 0.55);
    this.hat = new DrumVoice(hopRate, 0.4, 0.05, 0.6, 0.25);
    this.kickBands = this.hpss.bandsIn(40, 150);
    this.lowBands = this.hpss.bandsIn(150, 400);
    this.midBands = this.hpss.bandsIn(1200, 5000);
    this.hatBands = this.hpss.bandsIn(6000, 16000);
  }

  step(stream: StereoStream, t: number, silent: boolean): DrumHits {
    const o = this.out;
    o.kick = o.snare = o.hat = 0;
    o.crash = null;
    StereoStream.latest(stream.mid, stream.write, this.input);
    this.fft.magnitudes(this.input, this.mag);
    this.hpss.process(this.mag, t);
    if (!this.hpss.ready) return o;
    const h = this.hpss;
    o.t = h.delayedT;
    const kickE = Hpss.sum(h.perc, this.kickBands);
    const lowE = Hpss.sum(h.perc, this.lowBands);
    const midE = Hpss.sum(h.perc, this.midBands);
    const hatE = Hpss.sum(h.perc, this.hatBands);
    const p = this.prev;
    const fk = flux(p.kick, kickE);
    const fl = flux(p.low, lowE);
    const fm = flux(p.mid, midE);
    // Hats are faint but alone up there: a rise in level, not amplitude.
    const fh = Math.max(0, Math.log1p(hatE * 1e7) - Math.log1p(p.hat * 1e7));
    this.prev = { kick: kickE, low: lowE, mid: midE, hat: hatE };
    // A snare is a rattle: noise, flat across the band; a guitar's attack is a stack of peaks.
    let logSum = 0;
    let linSum = 0;
    const [m0, m1] = this.midBands;
    for (let b = m0; b < m1; b++) {
      const rise = Math.max(0, Math.sqrt(h.perc[b]) - Math.sqrt(this.prevPerc[b])) + 1e-7;
      logSum += Math.log(rise);
      linSum += rise;
    }
    const nb = Math.max(1, m1 - m0);
    const flatness = Math.exp(logSum / nb) / (linSum / nb);
    for (let b = 0; b < h.perc.length; b++) this.prevPerc[b] = h.perc[b];
    const fs = (fm + 0.15 * fl) * Math.min(1, flatness * 2.2);
    o.kick = this.kick.step(fk, silent);
    o.snare = this.snare.step(fs, silent);
    const hat = this.hat.step(fh, silent);
    if (hat && !o.snare) {
      o.hat = hat;
      this.cymbals.push({ t: o.t, peak: Hpss.sum(h.power, this.hatBands), low: Infinity, strength: o.hat });
    }
    // A cymbal: the top end keeps ringing (never dropping under a third of its peak) for a quarter second.
    const top = Hpss.sum(h.power, this.hatBands);
    for (const c of this.cymbals) {
      const age = o.t - c.t;
      if (age < 0.03) c.peak = Math.max(c.peak, top);
      else if (age >= 0.06) c.low = Math.min(c.low, top);
    }
    const due = this.cymbals.filter((c) => o.t - c.t >= 0.25);
    this.cymbals = this.cymbals.filter((c) => o.t - c.t < 0.25 && !(c.low < c.peak * 0.3));
    for (const c of due) if (c.low >= c.peak * 0.3) o.crash = { t: c.t, strength: c.strength };
    return o;
  }
}
