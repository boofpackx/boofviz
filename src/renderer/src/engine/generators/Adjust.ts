import type * as THREE from 'three';
import type { Generator } from './Generator';

/**
 * "Everything below": an adjustment layer. The compositor feeds it the layers
 * underneath, so its FX (a tape deck, old film...) treat the whole picture,
 * including text printed on it.
 */
export class Adjust implements Generator {
  readonly kind = 'adjust';
  update(): void {}
  render(_renderer: THREE.WebGLRenderer, _target: THREE.WebGLRenderTarget): void {}
  dispose(): void {}
}
