/**
 * Finds the downbeat (beat 1 of the bar) and the phrase start from audio,
 * given a running beat clock.
 *
 * Per beat it measures an accent (bass energy and onset strength right on the
 * beat) and a novelty (how different this beat's spectrum is from the last).
 * Downbeats in dance music carry crashes, bass-note changes and chord changes,
 * so the beat position with the highest accumulated score is beat 1. The same
 * idea one level up (novelty between bars) finds where phrases start.
 */
export interface MeterResult {
  downbeatOffset: number;
  phraseOffset: number;
  /** 0..1 how decisively the downbeat stands out. */
  downbeatConfidence: number;
}

const BANDS = 32;

export class MeterTracker {
  private beatIndex = Number.NaN;
  // Per-beat accumulators.
  private bassEarly = 0;
  private hops = 0;
  private readonly beatSpec = new Float32Array(BANDS);
  /** The previous two beats' spectra: novelty compares beat k with beat k−2. */
  private readonly hist = [new Float32Array(BANDS), new Float32Array(BANDS)];
  private histCount = 0;
  // Per-bar accumulators.
  private readonly barSpec = new Float32Array(BANDS);
  private readonly prevBarSpec = new Float32Array(BANDS);
  private barBeats = 0;
  private hasPrevBar = false;
  private barEnergy = 0;
  private prevBarEnergy = 0;

  private readonly downScore = new Float64Array(4);
  private phraseScore = new Float64Array(8);
  private accentMax = 1e-3;
  private noveltyMax = 1e-3;
  private barNoveltyMax = 1e-3;
  private evidenceBeats = 0;
  private evidenceBars = 0;

  result: MeterResult = { downbeatOffset: 0, phraseOffset: 0, downbeatConfidence: 0 };

  reset(): void {
    this.beatIndex = Number.NaN;
    this.downScore.fill(0);
    this.phraseScore.fill(0);
    this.histCount = 0;
    this.hasPrevBar = false;
    this.evidenceBeats = this.evidenceBars = 0;
    this.barBeats = 0;
    this.barSpec.fill(0);
  }

  /**
   * Feed one analysis hop. `beat` is the clock's continuous beat at this hop;
   * `lockDownbeat` keeps the current downbeat (manual resync or Link) while
   * phrase detection carries on.
   */
  update(beat: number, bass: number, _odf: number, bands32: Float32Array, beatsPerPhrase: number, lockDownbeat: boolean, silent: boolean): MeterResult {
    // Frames just before the count belong to the coming beat (detection lags a hop).
    const idx = Math.floor(beat + 0.08);
    const frac = beat + 0.08 - idx;
    if (Number.isNaN(this.beatIndex)) this.beatIndex = idx;
    if (idx !== this.beatIndex) {
      if (idx === this.beatIndex + 1 && this.hops > 0 && !silent) this.finishBeat(this.beatIndex, beatsPerPhrase, lockDownbeat);
      this.beatIndex = idx;
      this.bassEarly = 0;
      this.hops = 0;
      this.beatSpec.fill(0);
    }
    // Accent: what happens right on the beat.
    if (frac < 0.25) {
      this.bassEarly = Math.max(this.bassEarly, bass);
    }
    for (let i = 0; i < BANDS; i++) this.beatSpec[i] += bands32[i];
    this.hops++;
    return this.result;
  }

  private finishBeat(index: number, beatsPerPhrase: number, lockDownbeat: boolean): void {
    for (let i = 0; i < BANDS; i++) this.beatSpec[i] /= this.hops;
    // Compare with two beats ago: snare beats against snare beats, kick against kick,
    // so only bar-level changes (bass note, chord, crash) stand out.
    let novelty = 0;
    if (this.histCount >= 2) {
      const old = this.hist[index % 2 === 0 ? 0 : 1];
      for (let i = 0; i < BANDS; i++) novelty += Math.abs(this.beatSpec[i] - old[i]) * (i < 10 ? 2 : 1);
    }
    this.hist[index % 2 === 0 ? 0 : 1].set(this.beatSpec);
    this.histCount++;

    const accent = this.bassEarly;
    this.accentMax = Math.max(accent, this.accentMax * 0.995);
    this.noveltyMax = Math.max(novelty, this.noveltyMax * 0.995);
    const strength = 0.25 * (accent / this.accentMax) + 0.75 * (novelty / this.noveltyMax);

    const pos = ((index % 4) + 4) % 4;
    for (let i = 0; i < 4; i++) this.downScore[i] *= 0.97;
    this.downScore[pos] += strength;
    this.evidenceBeats++;

    let best = 0;
    let second = -1;
    for (let i = 1; i < 4; i++) if (this.downScore[i] > this.downScore[best]) best = i;
    for (let i = 0; i < 4; i++) if (i !== best && (second < 0 || this.downScore[i] > this.downScore[second])) second = i;
    const margin = this.downScore[second] > 0 ? this.downScore[best] / this.downScore[second] : 2;
    this.result.downbeatConfidence = Math.min(1, Math.max(0, (margin - 1) / 0.5));
    if (!lockDownbeat && this.evidenceBeats >= 16 && best !== this.result.downbeatOffset && margin > 1.15) {
      this.result = { ...this.result, downbeatOffset: best };
      this.phraseScore.fill(0);
      this.evidenceBars = 0;
      this.hasPrevBar = false;
      this.barBeats = 0;
      this.barSpec.fill(0);
    }

    // Bar bookkeeping (bars start at the downbeat).
    const down = this.result.downbeatOffset;
    if (((index - down) % 4 + 4) % 4 === 0 && this.barBeats > 0) this.finishBar(index, beatsPerPhrase);
    for (let i = 0; i < BANDS; i++) this.barSpec[i] += this.beatSpec[i];
    this.barEnergy += this.bassEarly;
    this.barBeats++;
  }

  private finishBar(nextBarFirstBeat: number, beatsPerPhrase: number): void {
    for (let i = 0; i < BANDS; i++) this.barSpec[i] /= this.barBeats;
    const energy = this.barEnergy / this.barBeats;
    let novelty = 0;
    if (this.hasPrevBar) {
      for (let i = 0; i < BANDS; i++) novelty += Math.abs(this.barSpec[i] - this.prevBarSpec[i]);
      novelty += 2 * Math.abs(energy - this.prevBarEnergy);
    }
    this.prevBarSpec.set(this.barSpec);
    this.prevBarEnergy = energy;
    this.hasPrevBar = true;
    this.barSpec.fill(0);
    this.barBeats = 0;
    this.barEnergy = 0;

    const barsPerPhrase = Math.max(1, Math.round(beatsPerPhrase / 4));
    if (this.phraseScore.length !== barsPerPhrase) {
      this.phraseScore = new Float64Array(barsPerPhrase);
      this.evidenceBars = 0;
    }
    this.barNoveltyMax = Math.max(novelty, this.barNoveltyMax * 0.98);
    // The novelty belongs to the bar that just finished (it differs from the bar before it).
    const down = this.result.downbeatOffset;
    const barIdx = Math.round((nextBarFirstBeat - 4 - down) / 4);
    const pos = ((barIdx % barsPerPhrase) + barsPerPhrase) % barsPerPhrase;
    for (let i = 0; i < barsPerPhrase; i++) this.phraseScore[i] *= 0.92;
    this.phraseScore[pos] += novelty / this.barNoveltyMax;
    this.evidenceBars++;

    let best = 0;
    let second = -1;
    for (let i = 1; i < barsPerPhrase; i++) if (this.phraseScore[i] > this.phraseScore[best]) best = i;
    for (let i = 0; i < barsPerPhrase; i++) if (i !== best && (second < 0 || this.phraseScore[i] > this.phraseScore[second])) second = i;
    const margin = second < 0 || this.phraseScore[second] <= 0 ? 2 : this.phraseScore[best] / this.phraseScore[second];
    if (this.evidenceBars >= barsPerPhrase * 2 && margin > 1.3) {
      const offset = (((down + 4 * best) % beatsPerPhrase) + beatsPerPhrase) % beatsPerPhrase;
      if (offset !== this.result.phraseOffset) this.result = { ...this.result, phraseOffset: offset };
    } else if (((this.result.phraseOffset - down) % 4 + 4) % 4 !== 0) {
      // Keep phrases bar-aligned whenever the downbeat moves.
      this.result = { ...this.result, phraseOffset: ((down % beatsPerPhrase) + beatsPerPhrase) % beatsPerPhrase };
    }
  }
}
