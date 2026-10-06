import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import { BarAnalyzer } from './barAnalyzer';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const MAX = 256;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uBars;
uniform float uPer;        // bars per symmetry sector
uniform float uSym;
uniform int uStyle;        // 0 bars, 1 bloom
uniform float uRadius;
uniform float uLength;
uniform float uThick;
uniform float uRot;
uniform float uCore;
uniform float uGlow;

float barAt(float i) { return texelFetch(uBars, ivec2(int(mod(i, uPer)), 0), 0).r; }

// Sector coordinate 0..1 with alternate sectors mirrored, so the ring is seamless.
float sectorU(float a) {
  float s = a / 6.28318531 * uSym;
  float u = fract(s);
  return mod(floor(s), 2.0) > 0.5 ? 1.0 - u : u;
}

float smoothBar(float u) {
  float x = u * uPer - 0.5;
  float i = floor(x);
  float f = x - i;
  float a = barAt(clamp(i, 0.0, uPer - 1.0));
  float b = barAt(clamp(i + 1.0, 0.0, uPer - 1.0));
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r = length(p);
  float a = atan(p.y, p.x) + uRot;
  a = mod(a, 6.28318531);
  float R = uRadius * (1.0 + 0.15 * uKick);
  vec3 col = vec3(0.0);
  vec3 glow = vec3(0.0);
  float u = sectorU(a);

  if (uStyle == 0) {
    float x = u * uPer;
    float i = floor(x);
    float h = barAt(i);
    float len = max(h * uLength, 0.004);
    // Polar box: angular half-width (in arc length) and radial span.
    float arc = 6.28318531 * r / (uPer * uSym);
    float dAng = (abs(fract(x) - 0.5) - uThick * 0.5) * arc;
    float dRad = abs(r - (R + len * 0.5)) - len * 0.5;
    float d = length(max(vec2(dAng, dRad), 0.0)) + min(max(dAng, dRad), 0.0);
    float px = 1.0 / uRes.y;
    vec3 base = paletteWrap(u * 0.8 + 0.1);
    col += base * (0.6 + 2.2 * h + 0.8 * uKick) * (1.0 - smoothstep(-px, px, d)) * mix(0.5, 1.3, clamp((r - R) / max(len, 1e-3), 0.0, 1.0));
    glow += base * (0.3 + 1.4 * h) * exp(-max(d, 0.0) * 55.0) * uGlow;
  } else {
    // Bloom: three layered petals of the smoothed spectrum.
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float scale = 1.0 - fk * 0.28;
      float rot = fk * 0.35;
      float uu = sectorU(mod(a + rot, 6.28318531));
      float h = smoothBar(uu);
      float edge = R + h * uLength * scale * 1.3;
      float d = r - edge;
      vec3 base = paletteWrap(0.15 + fk * 0.25 + uu * 0.3);
      float inside = 1.0 - smoothstep(-0.002, 0.002, d);
      float depth = clamp((edge - r) / max(edge, 1e-3), 0.0, 1.0);
      col = mix(col, base * (0.35 + 1.6 * h) * (0.4 + 0.8 * (1.0 - depth)), inside * (0.75 - fk * 0.15));
      glow += base * exp(-abs(d) * 60.0) * (0.4 + 1.5 * h) * uGlow * (1.0 - fk * 0.25);
    }
  }
  // Core: soft disc that breathes with the bass and flashes on kicks.
  float core = exp(-r / max(R * 0.6, 1e-3) * 2.2);
  col += palette(0.95) * core * uCore * (0.15 + 0.6 * uBass + 0.8 * uKick);
  col += palette(0.6) * exp(-abs(r - R) * 90.0) * 0.5 * uGlow * (0.3 + uBass);
  col += glow;
  col = max(col, 0.0);
  fragColor = vec4(col, coverAlpha(col, 0.0));
}
`;

export class RadialSpectrum extends ShaderGenerator {
  readonly kind = 'radialSpectrum';
  private readonly data: Float32Array;
  private readonly tex: THREE.DataTexture;
  private readonly bars = new BarAnalyzer(MAX);

  constructor() {
    const data = new Float32Array(MAX * 4);
    const tex = new THREE.DataTexture(data, MAX, 1, THREE.RGBAFormat, THREE.FloatType);
    super(FRAG, {
      uBars: { value: tex },
      uPer: { value: 48 },
      uSym: { value: 2 },
      uStyle: { value: 0 },
      uRadius: { value: 0.22 },
      uLength: { value: 0.25 },
      uThick: { value: 0.55 },
      uRot: { value: 0 },
      uCore: { value: 0.6 },
      uGlow: { value: 0.8 },
    });
    this.data = data;
    this.tex = tex;
    tex.needsUpdate = true;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const sym = Math.max(1, Math.round(num(p.symmetry, 2)));
    const per = Math.max(4, Math.round(num(p.bars, 96) / sym));
    this.bars.update(ctx.frame.fft, per, ctx.dt, { release: num(p.release, 0.15), reactivity: ctx.globals.reactivity, silence: ctx.frame.silence, punch: num(p.punch, 0.15), kick: ctx.env.kick, fHi: 12000 });
    for (let k = 0; k < per; k++) this.data[k * 4] = this.bars.heights[k];
    this.tex.needsUpdate = true;
    const u = this.u;
    u.uPer.value = per;
    u.uSym.value = sym;
    u.uStyle.value = p.style === 'bloom' ? 1 : 0;
    u.uRadius.value = num(p.radius, 0.22) * (1 + num(p.punch, 0.15) * ctx.env.kick * 0.5);
    u.uLength.value = num(p.length, 0.25);
    u.uThick.value = num(p.thickness, 0.55);
    u.uRot.value = (2 * Math.PI * num(p.spin, 0.1) * ctx.beat) / Math.max(1, ctx.frame.beatsPerPhrase);
    u.uCore.value = num(p.core, 0.6);
    u.uGlow.value = num(p.glow, 0.8);
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
