import type * as THREE from 'three';
import type { AudioFrame } from '@shared/types/audio';
import type { GlobalControls, ParamBag } from '@shared/types/engine';

/** Eased audio envelopes shared by every generator in a frame. */
export interface AudioEnv {
  kick: number;
  snare: number;
  hat: number;
  any: number;
  bass: number;
  mids: number;
  highs: number;
  energy: number;
  /** Long, slow envelope after a detected drop. */
  drop: number;
}

export interface GenContext {
  frame: AudioFrame;
  env: AudioEnv;
  dt: number;
  /** Animation time in seconds (shared audio clock × speed). */
  time: number;
  /** Beat counter × speed, phrase-aligned (see modulation.alignedBeat). */
  beat: number;
  palette: Float32Array;
  params: ParamBag;
  globals: GlobalControls;
  width: number;
  height: number;
}

/** Something three.js can compile ahead of time (see three/warmup.ts). */
export interface CompileTarget {
  scene: THREE.Object3D;
  camera: THREE.Camera;
}

/** A layer source that draws into a linear-HDR target (alpha = coverage). */
export interface Generator {
  readonly kind: string;
  update(ctx: GenContext): void;
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void;
  /** Scenes whose shaders can be compiled in the background before first use. */
  compileTargets?(): CompileTarget[];
  dispose(): void;
}
