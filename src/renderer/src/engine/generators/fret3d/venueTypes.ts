import type * as THREE from 'three';

/** What a venue animates from, each frame. */
export interface VenueFrame {
  t: number;
  dt: number;
  beat: number;
  /** Beat of the bar start and beats per bar (camera cuts land on bars). */
  barStart: number;
  beatsPerBar: number;
  beatsPerPhrase: number;
  kick: number;
  snare: number;
  bass: number;
  mids: number;
  highs: number;
  energy: number;
  drop: number;
  /** Star power glow 0..1. */
  power: number;
  /** Stage lights 0..1.5. */
  stage: number;
  /** 32-band EQ, 0..1. */
  bands: Float32Array;
  /** The rock meter, 0..1 (how the crowd feels). */
  rock: number;
  /** Each part's latest note (clock time it was played; −1e9 none) and pitch, for the band to play along. */
  notes: { guitar: number; bass: number; drums: number; snare: number; kick: number; hat: number; crash: number; vocals: number };
  /** The singer's pitch now (MIDI, 0 = not singing). */
  singing: number;
  /** The guitar's and bass's pitches now (MIDI, 0 = unknown) for the fretting hands. */
  guitarPitch: number;
  bassPitch: number;
  aspect: number;
}

export interface Venue {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  update(f: VenueFrame): void;
  dispose(): void;
}
