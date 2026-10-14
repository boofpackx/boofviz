import type { RawHop } from '@shared/types/audio';
import type { HopFeatures } from '../dsp/analysisCore';
import { BassTracker } from './bass';
import { DrumTracker, type DrumHits } from './drums';
import { LeadTracker, type LeadOnset } from './lead';
import { MelodyTracker } from './melody';
import type { NoteOnset } from './segmenter';
import { StereoStream } from './stream';

/** What the band did on one hop (onsets are dated: each tracker is a little late). */
export interface BandHop {
  t: number;
  drums: DrumHits;
  bass: { onset: NoteOnset | null; end: number | null };
  guitar: { onset: LeadOnset | null; end: number | null };
  vocals: { onset: NoteOnset | null; end: number | null };
  /** Sung pitch now (MIDI, 0: not singing), dated like the vocal onsets. */
  vocalMidi: number;
  vocalT: number;
  /** Bass pitch now (MIDI, 0: none). */
  bassMidi: number;
}

/**
 * The band, part by part, from the mixed audio: drums from a percussive
 * separation, the bass line by pitch below 300 Hz, the lead vocal from the
 * centre of the stereo image, and the guitar (and keys) from the tones left
 * over. Runs in the analysis worker on every hop, beside the analysis core.
 */
export class BandAnalyzer {
  readonly stream: StereoStream;
  readonly drums: DrumTracker;
  readonly bass: BassTracker;
  readonly melody: MelodyTracker;
  readonly guitar: LeadTracker;
  private readonly out: BandHop;

  constructor(readonly sampleRate: number) {
    this.stream = new StereoStream(sampleRate);
    this.drums = new DrumTracker(sampleRate);
    this.bass = new BassTracker(this.stream);
    this.melody = new MelodyTracker(sampleRate);
    this.guitar = new LeadTracker(sampleRate);
    this.out = { t: 0, drums: this.drums.out, bass: { onset: null, end: null }, guitar: { onset: null, end: null }, vocals: { onset: null, end: null }, vocalMidi: 0, vocalT: 0, bassMidi: 0 };
  }

  reset(): void {
    this.bass.reset();
    this.melody.reset();
    this.guitar.reset();
  }

  /**
   * One hop. `singing`: whether the synced lyrics say a line is being sung
   * (null: no lyrics to go by), which settles a centred lead instrument versus
   * a voice.
   */
  process(f: HopFeatures, hop: RawHop, singing: boolean | null = null): BandHop {
    const o = this.out;
    o.t = f.t;
    this.stream.push(hop);
    this.drums.step(this.stream, f.t, f.silence);
    o.bass = this.bass.step(f.t, f.kick, f.silence);
    o.bassMidi = this.bass.voiced ? this.bass.midi : 0;
    const v = this.melody.step(hop.mag, this.stream, f.t, f.silence || singing === false);
    o.vocals = v;
    o.vocalMidi = this.melody.voiced ? this.melody.midi : 0;
    o.vocalT = f.t - 0.045;
    o.guitar = this.guitar.step(hop.mag, f.t, f.silence, this.melody);
    return o;
  }
}
