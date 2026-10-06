import type * as THREE from 'three';
import type { AudioFrame } from '@shared/types/audio';
import type { ParamBag, ParamSpec, RenderContext } from '@shared/types/engine';

/** A layer source that draws into the linear-HDR scene target. */
export interface Generator {
  readonly kind: string;
  readonly params: readonly ParamSpec[];
  setParams(params: ParamBag): void;
  setPalette(linear: Float32Array): void;
  update(frame: AudioFrame, ctx: RenderContext): void;
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void;
  dispose(): void;
}
