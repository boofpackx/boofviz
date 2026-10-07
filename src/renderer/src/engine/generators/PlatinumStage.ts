import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/** 16th-note steps of a bar where the two-step accents land (kick on 1, the skipped "a" of 2, the pushes into 3 and 4). */
export const TWO_STEP = [0, 6, 10, 11, 14];

const MAX_GLINTS = 10;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform vec4 uGlint[${MAX_GLINTS}];   // xy position, z age (beats), w size
uniform float uBeams, uRings, uVelvet;
float PX;

vec3 velvet(vec2 p) {
  // Folded velvet: soft folds with a sheen on the ridges.
  float f = fbm(vec2(p.x * 2.2, p.y * 0.7) + vec2(0.0, uTime * 0.02));
  float folds = sin(p.x * 9.0 + f * 6.0) * 0.5 + 0.5;
  float sheen = pow(folds, 6.0);
  vec3 base = mix(uPal[0] * 0.6 + vec3(0.06, 0.0, 0.08), uPal[1] * 0.9, folds * 0.7);
  return base + uPal[2] * sheen * 0.5;
}

float ring(vec2 p, float r, float tilt, float spin, out float shade) {
  // A chrome ring seen at an angle: an ellipse whose thickness and shading turn with it.
  vec2 q = rot2(spin) * p;
  q.y /= max(0.08, abs(cos(tilt)));
  float d = abs(length(q) - r) - 0.018;
  shade = 0.5 + 0.5 * sin(atan(q.y, q.x) * 2.0 + spin * 3.0);
  return d * max(0.08, abs(cos(tilt)));
}

vec3 chrome(float t) {
  // Platinum: bright sky, dark band, warm floor.
  vec3 sky = vec3(1.25, 1.25, 1.35);
  vec3 band = vec3(0.08, 0.06, 0.1);
  vec3 floor_ = vec3(0.8, 0.7, 0.85);
  return t > 0.55 ? mix(band, sky, smoothstep(0.55, 0.9, t)) : mix(floor_, band, smoothstep(0.2, 0.55, t));
}

void main() {
  PX = 1.2 / uRes.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 c = velvet(p) * uVelvet;
  // Club beams sweeping from the top, swinging on the groove.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 o = vec2((fi - 1.5) * 0.45, 0.62);
    float ang = sin(uBeat * 0.785 + fi * 1.7) * 0.6;
    vec2 d = rot2(ang) * (p - o);
    float cone = smoothstep(0.08 + (-d.y) * 0.18, 0.0, abs(d.x)) * step(d.y, 0.0) * exp(d.y * 1.2);
    c += palette(0.55 + 0.12 * fi) * cone * 0.35 * uBeams * (0.6 + 0.6 * uKick);
  }
  // Spinning chrome rings behind the name.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float sh;
    float d = ring(p, 0.28 + fi * 0.09, uTime * (0.5 + 0.2 * fi) + fi, uTime * 0.3 * (fi - 1.0), sh);
    vec3 rc = chrome(sh) * (0.8 + 0.4 * uKick);
    c = mix(c, rc, clamp(0.5 - d / PX, 0.0, 1.0) * uRings);
  }
  // Diamond glints: four-point stars with a soft core, fired on the two-step accents.
  for (int i = 0; i < ${MAX_GLINTS}; i++) {
    vec4 gl = uGlint[i];
    if (gl.z < 0.0 || gl.z > 1.2) continue;
    vec2 q = p - gl.xy;
    float life = exp(-gl.z * 3.5);
    float s = gl.w * (0.6 + 0.4 * life);
    float star = exp(-abs(q.x) / (0.002 + s * 0.004)) * exp(-abs(q.y) / (s * 0.12)) + exp(-abs(q.y) / (0.002 + s * 0.004)) * exp(-abs(q.x) / (s * 0.12));
    vec2 qr = rot2(0.785) * q;
    star += 0.5 * (exp(-abs(qr.x) / 0.0015) * exp(-abs(qr.y) / (s * 0.05)) + exp(-abs(qr.y) / 0.0015) * exp(-abs(qr.x) / (s * 0.05)));
    star += exp(-length(q) / (s * 0.02)) * 2.0;
    c += vec3(1.3, 1.25, 1.45) * star * life;
  }
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

/**
 * Two-step garage club stage: folded velvet, sweeping beams, spinning chrome
 * rings and diamond glints that fire on the two-step accent pattern (swung),
 * not on every kick. Put a chrome lyric or name layer on top.
 */
export class PlatinumStage extends ShaderGenerator {
  readonly kind = 'platinumStage';

  constructor() {
    super(FRAG, {
      uGlint: { value: Array.from({ length: MAX_GLINTS }, () => new THREE.Vector4(0, 0, -1, 0)) },
      uBeams: { value: 1 },
      uRings: { value: 1 },
      uVelvet: { value: 1 },
    });
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    u.uBeams.value = num(p.beams, 1);
    u.uRings.value = num(p.rings, 1);
    u.uVelvet.value = num(p.velvet, 1);
    // Glints: the last few accent hits, each at a hashed spot, aged in beats.
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    const swing = num(p.swing, 0.6);
    const sixteenth = (step: number): number => (step + (step % 2 ? swing * 0.5 : 0)) / 4;
    const bar = Math.floor(ctx.beat / bpb);
    const hits: Array<{ beat: number; key: number }> = [];
    for (let b = bar - 1; b <= bar; b++) {
      for (const s of TWO_STEP) {
        const at = b * bpb + sixteenth(s);
        if (at <= ctx.beat) hits.push({ beat: at, key: b * 16 + s });
      }
    }
    const recent = hits.slice(-MAX_GLINTS);
    const asp = ctx.width / Math.max(1, ctx.height);
    const arr = u.uGlint.value as THREE.Vector4[];
    for (let i = 0; i < MAX_GLINTS; i++) {
      const h = recent[i];
      if (!h) {
        arr[i].set(0, 0, -1, 0);
        continue;
      }
      const r = (k: number): number => {
        const x = Math.sin(h.key * 12.9898 + k * 78.233) * 43758.5453;
        return x - Math.floor(x);
      };
      arr[i].set((r(1) - 0.5) * asp * 0.9, (r(2) - 0.5) * 0.85, ctx.beat - h.beat, (0.5 + r(3)) * num(p.glints, 1));
    }
  }
}
