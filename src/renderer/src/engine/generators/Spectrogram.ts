import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

const BINS = 256;
const ROWS = 256;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uHist;     // x = frequency, y = row (ring buffer)
uniform float uHead;         // newest row (fractional for smooth scroll)
uniform int uDir;            // 0 down, 1 up, 2 left, 3 right
uniform float uContrast;
uniform float uFloor;
uniform float uGlow;
uniform float uPersp;

void main() {
  vec2 uv = vUv;
  float freq, age;
  if (uDir == 0) { freq = uv.x; age = 1.0 - uv.y; }
  else if (uDir == 1) { freq = uv.x; age = uv.y; }
  else if (uDir == 2) { freq = uv.y; age = uv.x; }
  else { freq = uv.y; age = 1.0 - uv.x; }
  float fade = 1.0;
  if (uPersp > 0.0 && uDir < 2) {
    // A floor receding to a horizon: newest rows near the viewer (bottom), history
    // compressing toward the horizon, far rows narrower.
    float horizon = mix(1.0, 0.72, uPersp);
    float t = uv.y / horizon;
    if (t >= 1.0) { fragColor = vec4(palette(0.15) * 0.15 * exp(-(uv.y - horizon) * 20.0), 1.0); return; }
    float k = uPersp * 5.0;
    age = t / (1.0 + k * (1.0 - t));
    freq = 0.5 + (uv.x - 0.5) * (1.0 + uPersp * 2.2 * age);
    fade = smoothstep(1.0, 0.85, t);
    if (freq < 0.0 || freq > 1.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  float row = uHead - age * (${ROWS}.0 - 2.0);
  float v = texture(uHist, vec2(freq, (row + 0.5) / ${ROWS}.0)).r;
  v = clamp((v - uFloor) / (1.0 - uFloor), 0.0, 1.0);
  v = pow(v, uContrast);
  vec3 col = palette(0.12 + 0.88 * v) * (0.08 + 1.5 * v);
  col += palette(1.0) * pow(v, 5.0) * uGlow * 2.0;
  col *= (1.0 - 0.5 * age * age) * fade;
  fragColor = vec4(col, coverAlpha(col, 1.0));
}
`;

/** Scrolling spectrogram. Rows are pushed on the shared audio clock, so windows agree. */
export class Spectrogram extends ShaderGenerator {
  readonly kind = 'spectrogram';
  private readonly hist: Uint8Array;
  private readonly tex: THREE.DataTexture;
  private head = 0;
  private nextPush = 0;

  constructor() {
    const hist = new Uint8Array(BINS * ROWS);
    const tex = new THREE.DataTexture(hist, BINS, ROWS, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapT = THREE.RepeatWrapping;
    super(FRAG, { uHist: { value: tex }, uHead: { value: 0 }, uDir: { value: 0 }, uContrast: { value: 1.4 }, uFloor: { value: 0.25 }, uGlow: { value: 0.4 }, uPersp: { value: 0 } });
    this.hist = hist;
    this.tex = tex;
    tex.needsUpdate = true;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const rate = 60 * num(p.speed, 1); // rows per second
    const t = ctx.frame.time;
    if (Math.abs(t - this.nextPush) > 2) this.nextPush = t;
    let pushed = 0;
    while (t >= this.nextPush && pushed < 8) {
      this.pushRow(ctx.frame.fft);
      this.nextPush += 1 / rate;
      pushed++;
    }
    if (pushed) this.tex.needsUpdate = true;
    const frac = Math.min(1, Math.max(0, 1 - (this.nextPush - t) * rate));
    const u = this.u;
    u.uHead.value = this.head - 1 + frac;
    u.uDir.value = ['down', 'up', 'left', 'right'].indexOf(String(p.direction ?? 'down'));
    u.uContrast.value = num(p.contrast, 1.4);
    u.uFloor.value = num(p.floor, 0.25);
    u.uGlow.value = num(p.glow, 0.4);
    u.uPersp.value = num(p.perspective, 0);
  }

  private pushRow(fft: Float32Array): void {
    const row = this.head % ROWS;
    // fft spans 20 Hz–20 kHz on a log axis; show 30 Hz–16 kHz.
    const n = fft.length;
    const lo = Math.log(30 / 20) / Math.log(1000);
    const hi = Math.log(16000 / 20) / Math.log(1000);
    for (let b = 0; b < BINS; b++) {
      const i0 = Math.floor((lo + ((hi - lo) * b) / BINS) * n);
      const i1 = Math.max(i0, Math.floor((lo + ((hi - lo) * (b + 1)) / BINS) * n) - 1);
      let m = 0;
      for (let i = i0; i <= i1; i++) if (fft[i] > m) m = fft[i];
      this.hist[row * BINS + b] = Math.round(Math.min(1, m) * 255);
    }
    this.head++;
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
