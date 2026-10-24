import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { hash01 } from '../modulation';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

/**
 * Console Boot Fog: the mood of the 2000 console start-up. A deep blue void
 * thick with fog, translucent towers rising out of the murk at different
 * heights with brighter edges, light motes drifting, a slow camera glide.
 * Each tower's height follows a band of the spectrum, rising slowly; the fog
 * glow breathes with the bass; each phrase ends in a soft swell of light and
 * turns the glide; the drop surges every tower up.
 *
 * Rendered as a volume: the ray gathers glow from every tower it passes near,
 * so the towers are see-through and soft. Colours: stop 1 the void, 2 the
 * fog, 3 the towers, 4 the edges and motes.
 */

const FRAG = /* glsl */ `${GEN_HEADER}
uniform vec3 uCam, uDir;
uniform float uBands[16];
uniform float uSurge, uSwell, uFog, uMotes, uGlow;

float sdBox3(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Distance to the tower field and the tower's edge-ness at p.
vec2 towers(vec3 p) {
  vec2 cell = floor(p.xz / 3.0);
  vec3 q = vec3(mod(p.x, 3.0) - 1.5, p.y, mod(p.z, 3.0) - 1.5);
  float h = hash21(cell);
  if (h < 0.35) return vec2(1.2, 0.0);
  int band = int(hash21(cell + 7.0) * 15.99);
  float height = 0.6 + h * 1.6 + uBands[band] * 3.0 + uSurge * 2.5;
  float w = 0.35 + hash21(cell + 3.0) * 0.25;
  vec3 c = vec3(0.0, height * 0.5 - 2.0, 0.0);
  float d = sdBox3(q - c, vec3(w, height * 0.5, w));
  // Edges: near two faces at once.
  vec3 e = abs(q - c) - vec3(w, height * 0.5, w);
  float edge = smoothstep(0.08, 0.0, abs(e.x) + abs(e.z)) + smoothstep(0.06, 0.0, abs(e.y) + min(abs(e.x), abs(e.z)));
  return vec2(d, edge);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 fw = normalize(uDir);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.3 + uv.x * rt + uv.y * up);
  vec3 ro = uCam;
  vec3 acc = vec3(0.0);
  float t = 0.2;
  for (int i = 0; i < 56; i++) {
    vec3 p = ro + rd * t;
    vec2 d = towers(p);
    float fogFade = exp(-t * 0.07 * uFog);
    // Glow from being near a tower: soft faces, brighter edges.
    // (Weighted for the 0.1 minimum step; fewer, longer steps keep it fast.)
    float g = (exp(-max(d.x, 0.0) * 6.0) * 0.045 + (d.x < 0.02 ? 0.02 : 0.0)) * 1.25;
    acc += (uPal[3] * g + uPal[4] * d.y * g * 3.0) * fogFade * uGlow;
    t += clamp(d.x * 0.7, 0.1, 0.6);
    if (t > 34.0) break;
  }
  // The void and its fog: darker above, glowing low towards the horizon.
  float hz = exp(-abs(rd.y + 0.05) * 6.0);
  vec3 bg = mix(uPal[0], uPal[1], 0.6 + 0.4 * uv.y) * 0.6 + uPal[2] * hz * 0.35 * uFog;
  vec3 col = bg + acc;
  // Light motes: three layers of drifting points.
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    vec2 q = uv * (6.0 + fl * 5.0) + vec2(uTime * (0.05 + fl * 0.03), uTime * 0.02 * (fl + 1.0));
    vec2 id = floor(q), f = fract(q) - 0.5;
    vec2 o = hash22(id + fl * 13.0) - 0.5;
    float m = smoothstep(0.06 / (1.0 + fl), 0.0, length(f - o * 0.8));
    col += uPal[4] * m * uMotes * (0.4 + 0.6 * hash21(id)) * (0.6 + uKick * 0.6) / (1.0 + fl * 0.6);
  }
  col += mix(uPal[4], vec3(1.0), 0.6) * uSwell * 0.5;
  fragColor = vec4(col, 1.0);
}
`;

export class BootFog extends ShaderGenerator {
  readonly kind = 'bootFog';
  private readonly bands = new Float32Array(16);
  private z = 0;
  private dropAt = -99;

  constructor() {
    super(FRAG, {
      uCam: { value: new THREE.Vector3() },
      uDir: { value: new THREE.Vector3(0, -0.1, 1) },
      uBands: { value: new Float32Array(16) },
      uSurge: { value: 0 },
      uSwell: { value: 0 },
      uFog: { value: 1 },
      uMotes: { value: 1 },
      uGlow: { value: 1 },
    });
    this.u.uBands.value = this.bands;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const f = ctx.frame;
    const u = this.u;
    // Towers rise and sink slowly with their bands.
    const k = 1 - Math.exp(-ctx.dt / 0.6);
    for (let i = 0; i < 16; i++) this.bands[i] += ((f.bands32[i * 2] ?? 0) * num(p.react, 1) - this.bands[i]) * k;
    const bpp = Math.max(4, f.beatsPerPhrase || 16);
    const phrase = Math.floor(ctx.beat / bpp);
    const into = (ctx.beat - phrase * bpp) / bpp;
    this.z += ctx.dt * 0.9 * num(p.speed, 1) * (ctx.env.energy < 0.18 ? 0.5 : 1);
    // The glide: a gentle curve whose direction turns every phrase.
    const turn = (hash01(phrase, 3) - 0.5) * 0.8;
    const yaw = turn * into + (hash01(phrase - 1, 3) - 0.5) * 0.8 * (1 - into) * 0.3;
    const height = 1.6 + Math.sin(ctx.time * 0.13) * 0.6 + hash01(phrase, 4) * 1.2;
    (u.uCam.value as THREE.Vector3).set(Math.sin(this.z * 0.07) * 6 + yaw * 4, height, this.z * 3);
    (u.uDir.value as THREE.Vector3).set(Math.sin(yaw), -0.18 - hash01(phrase, 5) * 0.12, Math.cos(yaw));
    if (f.drop) this.dropAt = ctx.beat;
    const dd = (ctx.beat - this.dropAt) / ((f.beatsPerBar || 4) * 2);
    u.uSurge.value = dd >= 0 && dd < 1 ? Math.sin(Math.PI * dd) : 0;
    // A soft swell of light over the last beat of the phrase.
    const left = bpp - (ctx.beat - phrase * bpp);
    u.uSwell.value = left < 1 ? (1 - left) ** 2 * num(p.swell, 1) : 0;
    u.uFog.value = num(p.fog, 1) * (1 + ctx.env.bass * 0.4) * (ctx.env.energy < 0.18 ? 1.4 : 1);
    u.uMotes.value = num(p.motes, 1);
    u.uGlow.value = num(p.glow, 1);
  }
}
