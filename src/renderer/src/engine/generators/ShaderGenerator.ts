import * as THREE from 'three';
import { FULLSCREEN_VERT } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import type { CompileTarget, GenContext, Generator } from './Generator';

export type Uniforms = Record<string, THREE.IUniform>;

/** Base for generators that are a single full-screen fragment shader. */
export abstract class ShaderGenerator implements Generator {
  abstract readonly kind: string;
  protected readonly pass: FullscreenPass;
  protected readonly u: Uniforms;

  constructor(fragmentShader: string, extra: Uniforms = {}) {
    this.u = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uBeatPhase: { value: 0 },
      uBarPhase: { value: 0 },
      uKick: { value: 0 },
      uSnare: { value: 0 },
      uHat: { value: 0 },
      uBass: { value: 0 },
      uMids: { value: 0 },
      uHighs: { value: 0 },
      uEnergy: { value: 0 },
      uBeatsPerBar: { value: 4 },
      uPal: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
      ...extra,
    };
    this.pass = new FullscreenPass(
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms: this.u, depthTest: false, depthWrite: false }),
    );
  }

  /** Common uniforms; subclasses call super.update(ctx) then set their own. */
  update(ctx: GenContext): void {
    const u = this.u;
    const { env, frame } = ctx;
    u.uTime.value = ctx.time;
    u.uBeat.value = ctx.beat;
    u.uBeatPhase.value = ctx.beat - Math.floor(ctx.beat);
    u.uBarPhase.value = frame.barPhase;
    u.uKick.value = env.kick;
    u.uSnare.value = env.snare;
    u.uHat.value = env.hat;
    u.uBass.value = env.bass;
    u.uMids.value = env.mids;
    u.uHighs.value = env.highs;
    u.uEnergy.value = env.energy;
    u.uBeatsPerBar.value = frame.beatsPerBar;
    const pal = u.uPal.value as THREE.Vector3[];
    for (let i = 0; i < 5; i++) pal[i].set(ctx.palette[i * 3], ctx.palette[i * 3 + 1], ctx.palette[i * 3 + 2]);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    (this.u.uRes.value as THREE.Vector2).set(target.width, target.height);
    this.pass.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    return [this.pass];
  }

  dispose(): void {
    this.pass.dispose();
  }
}

export function num(v: unknown, d = 0): number {
  return typeof v === 'number' ? v : d;
}
