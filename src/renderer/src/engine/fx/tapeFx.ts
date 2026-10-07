import * as THREE from 'three';
import type { ParamBag } from '@shared/types/engine';
import { FULLSCREEN_VERT, SDF_GLSL, UTIL_GLSL } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { hash2, tapeEventAt, type TapeEventKind } from '../lostMedia';
import { hdrTarget, type Effect, type FxContext } from './effects';

/**
 * Lost-media effects: a physically-minded tape deck (tapeStack), projected
 * film (filmStock) and early digital video (digitalRot). Damage and events are
 * seeded from the beat and clock, so preview and output show the same tape.
 */

const HEADER = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
uniform vec2 uRes;
in vec2 vUv;
out vec4 fragColor;
${SDF_GLSL}
${UTIL_GLSL}
vec3 gam(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 lin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toYIQ(vec3 c) { return mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c; }
vec3 fromYIQ(vec3 c) { return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * c; }
`;

const COPY = `${HEADER}
void main() { fragColor = texture(uInput, vUv); }`;

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

function mat(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms: { uInput: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, ...uniforms },
    depthTest: false,
    depthWrite: false,
  });
}

/** A frame kept aside (a paused tape, a stepped film frame, an older recording). */
class HeldFrame {
  target: THREE.WebGLRenderTarget | null = null;
  key: number | null = null;

  /** Copy `input` in when `key` changes. */
  update(renderer: THREE.WebGLRenderer, copy: FullscreenPass, input: THREE.WebGLRenderTarget, key: number): THREE.Texture {
    if (!this.target || this.target.width !== input.width || this.target.height !== input.height) {
      this.target?.dispose();
      this.target = hdrTarget(input.width, input.height);
      this.key = null;
    }
    if (key !== this.key) {
      this.key = key;
      copy.material.uniforms.uInput.value = input.texture;
      copy.render(renderer, this.target);
    }
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
  }
}

// ---------------------------------------------------------------------------
// Tape deck

const TAPE = `${HEADER}
uniform sampler2D uHold;
uniform sampler2D uMemory;
uniform float uTime, uGen, uWear, uEvT, uEvAmt, uMood, uOverwrite, uKick, uSeed, uUseHold, uLines, uHasMemory;
uniform int uFormat, uEv;   // format: 0 VHS 1 Betamax 2 Hi8 3 cable 4 broadcast · ev: 0 none 1 rew 2 ff 3 pause 4 signal 5 eat 6 overwrite 7 focus

vec3 src(vec2 p) {
  p = clamp(p, vec2(0.001), vec2(0.999));
  return uUseHold > 0.5 ? texture(uHold, p).rgb : texture(uInput, p).rgb;
}

void main() {
  vec2 uv = vUv;
  float line = floor(uv.y * uLines);
  float fr = floor(uTime * 29.97);
  float g = clamp((uGen - 1.0) / 7.0, 0.0, 1.0);
  float wear = uWear * (0.55 + 0.7 * g);
  bool tape = uFormat <= 2;
  float ev = uEvAmt;

  // --- Transport: line jitter, slow wobble, head switching at the bottom, top-of-frame flagging.
  float jit = (hash21(vec2(line, fr) + uSeed) - 0.5) * 0.0016 * wear;
  float wob = sin(uv.y * 7.0 + uTime * 1.3) * 0.0008 * wear + sin(uTime * 0.37 + uSeed) * 0.0006 * wear;
  float head = tape ? smoothstep(0.04, 0.0, uv.y) * min(1.0, 0.4 + wear) : 0.0;
  uv.x += jit + wob + head * (0.015 + 0.035 * hash21(vec2(line, fr)));
  uv.x -= tape ? smoothstep(0.92, 1.0, uv.y) * wear * 0.006 : 0.0;
  if (mod(gl_FragCoord.y, 2.0) < 1.0) uv.x += uKick * 0.0012 * wear;      // interlace combing on hits

  float bars = 0.0, snow = 0.0, blue = 0.0, blur = 0.0, blank = 0.0, memMix = 0.0, seam = 0.0;
  if (uEv == 1 || uEv == 2) {
    // Shuttle search: the picture rolls (with the black blanking bar) and tears in noise bands.
    float dir = uEv == 1 ? -1.0 : 1.0;
    float y = fract(uv.y + dir * uEvT * (uEv == 1 ? 5.0 : 3.0) * ev);
    blank = smoothstep(0.03, 0.0, y) * ev;
    uv.y = y;
    uv.x += sin(uv.y * 30.0 + uTime * 40.0 * dir) * 0.003 * ev;
    for (int i = 0; i < 3; i++) {
      float by = fract(float(i) * 0.37 + uTime * (0.8 + float(i) * 0.35) * dir);
      float band = smoothstep(0.035, 0.0, abs(uv.y - by));
      bars = max(bars, band * ev);
    }
    uv.x += bars * (hash21(vec2(line, fr + 9.0)) - 0.5) * 0.12;
  } else if (uEv == 3) {
    // Pause: the held field shakes by a line or two, with one noise bar parked low in the frame.
    uv.y += (hash11(fr + uSeed) - 0.5) * 3.0 / uLines * ev;
    float by = 0.22 + 0.015 * sin(uTime * 2.3);
    bars = smoothstep(0.03, 0.0, abs(uv.y - by)) * ev;
    uv.x += bars * (hash21(vec2(line, fr)) - 0.5) * 0.08;
  } else if (uEv == 4) {
    if (tape) blue = smoothstep(0.0, 0.3, ev); else snow = ev;
  } else if (uEv == 5) {
    // Tape eat: the picture stretches and creases, then snaps back.
    uv.x += sin(uv.y * 11.0 + uTime * 9.0) * 0.035 * ev;
    uv.y += sin(uv.x * 3.0 + uTime * 2.0) * 0.025 * ev;
    bars = 0.5 * ev * smoothstep(0.7, 1.0, hash21(vec2(floor(uv.y * 12.0), fr)));
  } else if (uEv == 6) {
    // Recorded over: an older recording shows through below a rolling seam.
    float seamY = 1.1 - uEvT * 1.25;
    memMix = ev * step(uv.y, seamY);
    seam = smoothstep(0.03, 0.0, abs(uv.y - seamY)) * ev;
    uv.x += seam * (hash21(vec2(line, fr)) - 0.5) * 0.1;
  } else if (uEv == 7) {
    // Camcorder focus hunting, with a small zoom breath.
    blur = ev * (0.55 + 0.45 * sin(uEvT * 19.0));
    uv = (uv - 0.5) * (1.0 - 0.025 * ev * sin(uEvT * 6.0)) + 0.5;
  }
  memMix = max(memMix, uOverwrite * (0.22 + 0.12 * sin(uTime * 0.21)) * uHasMemory) * uHasMemory;

  // --- Bandwidth: tape keeps a few hundred lines of luma and far less colour, delayed to the right.
  float bw = uFormat == 2 ? 0.6 : uFormat == 1 ? 0.8 : uFormat == 3 ? 0.55 : uFormat == 4 ? 0.7 : 1.0;
  float lw = bw * (1.0 + g * 1.6 + blur * 6.0) * 1.4 / 640.0;
  float cw = lw * (3.5 + 2.0 * g);
  float cdelay = (tape ? 2.0 + 3.0 * g : 1.0) / 640.0;
  float Y = 0.0, Yw = 0.0, wy = 0.0, wc = 0.0;
  vec2 IQ = vec2(0.0);
  for (int i = -3; i <= 3; i++) {
    float fi = float(i);
    float w = exp(-fi * fi / 4.5);
    Y += toYIQ(gam(src(uv + vec2(fi * lw, 0.0)))).x * w;
    if (blur > 0.001) Y += toYIQ(gam(src(uv + vec2(0.0, fi * lw * 1.7)))).x * w;
    wy += w * (blur > 0.001 ? 2.0 : 1.0);
  }
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float w = exp(-fi * fi / 8.0);
    vec3 a = toYIQ(gam(src(uv + vec2(fi * cw + cdelay, 0.0))));
    IQ += a.yz * w;
    Yw += a.x * w;
    wc += w;
  }
  Y /= wy;
  IQ /= wc;
  Yw /= wc;
  // Player sharpening rings around edges (stronger on worn copies).
  Y += (Y - Yw) * (tape ? 0.35 + 0.3 * g : 0.15);

  if (memMix > 0.001) {
    vec2 mp = vec2(uv.x + 0.004, fract(uv.y + 0.02 * sin(uTime * 0.3)));
    vec3 m = toYIQ(gam(texture(uMemory, mp).rgb));
    m.yz = mat2(0.94, 0.34, -0.34, 0.94) * m.yz * 0.7;    // the old tape's own hue drift
    Y = mix(Y, m.x * 0.92 + 0.04, memMix);
    IQ = mix(IQ, m.yz, memMix);
  }

  // --- Generation loss: milky blacks, lost contrast and saturation, hue drift.
  float gl = (uGen - 1.0);
  Y = Y * (1.0 - 0.035 * gl) + 0.035 * g + 0.01 * gl * wear;
  float sat = max(0.0, 1.0 - 0.075 * gl) * (1.0 - 0.45 * uMood);
  float hue = 0.045 * gl * uWear;
  IQ = mat2(cos(hue), sin(hue), -sin(hue), cos(hue)) * IQ * sat;

  // --- Noise: luma grain, chroma streaks, dropouts.
  float nAmp = 0.02 + 0.03 * g + 0.025 * wear;
  Y += (hash21(gl_FragCoord.xy + fr * 7.13 + uSeed) - 0.5) * nAmp;
  vec2 cs = vec2(hash21(vec2(floor(uv.x * 70.0), line + fr)), hash21(vec2(floor(uv.x * 55.0) + 3.0, line - fr))) - 0.5;
  IQ += cs * 0.045 * (g + 0.4 * wear);
  float dropKey = hash21(vec2(line, fr * 1.31 + uSeed));
  if (tape && dropKey > 0.9988 - 0.0025 * wear * (0.5 + g)) {
    float x0 = hash21(vec2(line * 1.7, fr));
    float len = 0.04 + 0.2 * hash21(vec2(line, fr * 3.1));
    Y = mix(Y, 0.95, step(x0, uv.x) * step(uv.x, x0 + len) * 0.9);
  }
  if (uFormat == 3) Y += sin((gl_FragCoord.x + gl_FragCoord.y * 0.35) * 0.85 + uTime * 25.0) * 0.018 * wear;   // RF interference
  if (uFormat == 4) {
    Y += toYIQ(gam(src(uv - vec2(0.014, 0.0)))).x * 0.12 * wear;                                             // antenna ghost
    snow = max(snow, 0.06 * wear);
  }

  vec3 c = fromYIQ(vec3(Y, IQ));
  float s = hash21(gl_FragCoord.xy * 0.5 + fr * 1.7 + uSeed);
  c = mix(c, vec3(s), clamp(head * 0.55 + bars * 0.65 + seam * 0.8, 0.0, 1.0));
  c = mix(c, vec3(s * 0.9), snow);
  c = mix(c, vec3(0.08, 0.16, 0.95), blue);
  c *= 1.0 - blank;
  c *= 0.93 + 0.07 * sin(vUv.y * uLines * 6.28318);

  // --- Mood: cozy warms and softens; eerie goes cold, dark at the edges, with the odd wrong frame.
  vec2 vp = vUv - 0.5;
  float cozy = clamp(1.0 - uMood * 2.0, 0.0, 1.0);
  float eerie = clamp(uMood * 2.0 - 1.0, 0.0, 1.0);
  c *= mix(vec3(1.0), vec3(1.06, 1.0, 0.9), cozy * 0.7);
  c *= mix(vec3(1.0), vec3(0.86, 0.98, 1.06), eerie);
  c *= 1.0 - (0.25 + 0.6 * eerie) * dot(vp, vp) * 1.8;
  if (eerie > 0.3 && hash11(fr * 0.913 + uSeed * 3.1) > 0.9965) c = vec3(1.0) - c * 1.4;

  fragColor = vec4(lin(max(c, 0.0)), 1.0);
}`;

const FORMAT_INDEX: Record<string, number> = { vhs: 0, betamax: 1, hi8: 2, cable: 3, broadcast: 4 };
const LINES: Record<string, number> = { vhs: 240, betamax: 250, hi8: 300, cable: 330, broadcast: 300 };
const EVENT_INDEX: Record<TapeEventKind, number> = { none: 0, rewind: 1, ffwd: 2, pause: 3, signal: 4, eat: 5, overwrite: 6, focus: 7 };

/** Parse an event list param ("rewind,pause"); empty or "all" means every kind. */
export function eventKinds(v: unknown): TapeEventKind[] | undefined {
  if (typeof v !== 'string' || !v.trim() || v.trim() === 'all') return undefined;
  return v.split(/[\s,]+/).filter(Boolean) as TapeEventKind[];
}

class TapeStack implements Effect {
  readonly kind = 'tapeStack';
  private readonly pass = new FullscreenPass(
    mat(TAPE, {
      uHold: { value: null },
      uMemory: { value: null },
      uTime: { value: 0 },
      uGen: { value: 2 },
      uWear: { value: 1 },
      uEvT: { value: 0 },
      uEvAmt: { value: 0 },
      uMood: { value: 0.3 },
      uOverwrite: { value: 0 },
      uKick: { value: 0 },
      uSeed: { value: 0 },
      uUseHold: { value: 0 },
      uLines: { value: 240 },
      uHasMemory: { value: 0 },
      uFormat: { value: 0 },
      uEv: { value: 0 },
    }),
  );
  private readonly copy = new FullscreenPass(mat(COPY, {}));
  private readonly hold = new HeldFrame();
  private readonly memory = new HeldFrame();

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, p: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget {
    const u = this.pass.material.uniforms;
    const seed = Math.round(n(p.seed, 0));
    const ev = tapeEventAt(ctx.beat, ctx.beatsPerBar, n(p.events, 0.3), seed, eventKinds(p.eventList));
    const format = String(p.format ?? 'vhs');
    // A paused tape holds the frame from the moment it paused; an older recording is refreshed every 8 bars.
    u.uUseHold.value = ev.kind === 'pause' ? 1 : 0;
    u.uHold.value = ev.kind === 'pause' ? this.hold.update(renderer, this.copy, input, ev.start) : input.texture;
    const wantsMemory = ev.kind === 'overwrite' || n(p.overwrite, 0) > 0;
    if (wantsMemory) {
      const bar = Math.floor(ctx.beat / Math.max(1, ctx.beatsPerBar));
      u.uMemory.value = this.memory.update(renderer, this.copy, input, Math.floor((bar - 1) / 8));
    }
    u.uHasMemory.value = wantsMemory && this.memory.target ? 1 : 0;
    if (!wantsMemory) u.uMemory.value = input.texture;
    u.uInput.value = input.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    u.uTime.value = ctx.time;
    u.uGen.value = Math.max(1, Math.min(8, n(p.generation, 2)));
    u.uWear.value = n(p.wear, 1);
    u.uMood.value = n(p.mood, 0.3);
    u.uOverwrite.value = n(p.overwrite, 0);
    u.uKick.value = ctx.kick;
    u.uSeed.value = seed;
    u.uFormat.value = FORMAT_INDEX[format] ?? 0;
    u.uLines.value = LINES[format] ?? 240;
    u.uEv.value = EVENT_INDEX[ev.kind];
    u.uEvT.value = ev.t;
    u.uEvAmt.value = ev.amount;
    this.pass.render(renderer, out);
    return out;
  }

  compileTargets(): FullscreenPass[] {
    return [this.pass, this.copy];
  }

  dispose(): void {
    this.pass.dispose();
    this.copy.dispose();
    this.hold.dispose();
    this.memory.dispose();
  }
}

// ---------------------------------------------------------------------------
// Film

const FILM = `${HEADER}
uniform float uTime, uFrame, uWear, uWeave, uDust, uFlicker, uFade, uLeaks, uGate, uEvT, uEvAmt, uSeed, uKick;
uniform int uStock, uTone;   // stock: 0 Super 8 · 1 16 mm · 2 35 mm · 3 nitrate archive · tone: 0 colour 1 b&w 2 sepia

void main() {
  float fr = uFrame;
  float aspect = uRes.x / uRes.y;
  vec2 p = vUv - 0.5;
  // Gate weave: a per-frame jolt plus a slow drift; splices jump the frame line through.
  vec2 weave = (vec2(hash11(fr * 1.31 + uSeed), hash11(fr * 2.17 + uSeed + 5.0)) - 0.5) * vec2(0.0016, 0.0032) * uWeave;
  weave += vec2(sin(uTime * 0.7 + uSeed), sin(uTime * 0.53)) * 0.0014 * uWeave;
  float zoom = 1.0 + 0.2 * uGate;
  p = p * zoom + weave;
  p.y += uEvAmt * pow(1.0 - uEvT, 2.0) * 0.7;
  float fy = p.y + 0.5;
  vec2 q = vec2(p.x + 0.5, fract(fy));
  float r = uStock == 0 ? 0.07 : uStock == 1 ? 0.04 : 0.02;
  vec2 bq = (q - 0.5) * vec2(aspect, 1.0);
  float gate = sdRoundBox(bq, vec2(0.5 * aspect, 0.5) - r - 0.02, r);
  float inPic = smoothstep(0.004, -0.004, gate);

  vec3 c = gam(texture(uInput, clamp(q, 0.001, 0.999)).rgb);
  float l = dot(c, uStock == 3 ? vec3(0.15, 0.45, 0.4) : vec3(0.2126, 0.7152, 0.0722));
  if (uTone == 1) c = vec3(l);
  else if (uTone == 2) c = l * vec3(1.08, 0.9, 0.68) + vec3(0.03, 0.015, 0.0);

  // Colour fade: dyes fade unevenly (toward magenta), blacks lift, contrast drops.
  c = mix(c, vec3(c.r * 1.12 + 0.05, c.g * 0.86 + 0.02, c.b * 0.8 + 0.05), uFade);
  c = mix(vec3(0.5), c, 1.0 - 0.25 * uFade);
  // Flicker (projector lamp and uneven density), hot spot and vignette.
  c *= 1.0 + (hash11(fr * 7.7 + uSeed) - 0.5) * 0.13 * uFlicker;
  c *= 1.0 + (fbm(q * 2.5 + fr * 0.13) - 0.5) * 0.12 * uFlicker;
  c *= 1.07 - (uStock == 0 ? 0.75 : 0.45) * dot(p, p);

  // Grain: coarse for Super 8, fine for 35 mm, strongest in the mid-tones.
  float gs = (uStock == 0 ? 2.4 : uStock == 1 ? 1.7 : uStock == 3 ? 1.4 : 1.0) * uRes.y / 1080.0;
  float grain = vnoise(gl_FragCoord.xy / gs + vec2(fr * 37.1, fr * 11.3)) - 0.5;
  c += grain * (0.07 + 0.05 * uWear) * (0.45 + 0.55 * (1.0 - abs(l - 0.5) * 2.0));

  // Light leaks: warm glows bleeding in from the edges.
  float lx = 0.5 + 0.55 * sin(uTime * 0.11 + uSeed);
  float leak = smoothstep(0.55, 0.0, abs(q.x - lx)) * smoothstep(0.35, 0.75, vnoise(vec2(uTime * 0.25, q.y * 2.0 + uSeed)));
  c += vec3(1.0, 0.42, 0.12) * leak * uLeaks * (0.5 + 0.3 * uKick);

  // Dust (black specks and white flecks) for one frame each, and the odd hair in the gate.
  for (int i = 0; i < 6; i++) {
    vec2 h = hash22(vec2(fr + uSeed, float(i) * 3.3));
    if (hash11(fr * 0.37 + float(i) * 1.9) > 0.35 + 0.5 * (1.0 - min(uDust, 1.0))) continue;
    vec2 d = (q - h) * vec2(aspect, 1.0);
    float rad = (0.002 + 0.006 * hash11(fr + float(i))) * (1.0 + vnoise(d * 900.0) * 0.8);
    float speck = smoothstep(rad, rad * 0.4, length(d));
    c = mix(c, i < 4 ? vec3(0.02) : vec3(0.95), speck * 0.85);
  }
  float hairOn = step(0.9 - 0.1 * uDust, hash11(floor(fr / 9.0) + uSeed));
  if (hairOn > 0.0) {
    vec2 hc = hash22(vec2(floor(fr / 9.0), 7.0));
    float hx = hc.x + 0.03 * sin(q.y * 18.0 + hc.y * 6.0) + 0.01 * sin(q.y * 47.0);
    float hd = abs(q.x - hx) * aspect;
    float span = step(abs(q.y - hc.y), 0.18);
    c = mix(c, vec3(0.03), smoothstep(0.0016, 0.0005, hd) * span * 0.9);
  }
  // Scratches: thin vertical lines that live a few seconds and flicker.
  for (int i = 0; i < 3; i++) {
    float era = floor(uTime * 0.35 + float(i) * 0.31);
    if (hash11(era * 1.7 + float(i) + uSeed) > uWear * 0.55) continue;
    float sx = hash11(era + float(i) * 13.0) + (hash11(fr + float(i)) - 0.5) * 0.002;
    float sd = abs(q.x - sx) * uRes.x;
    float on = step(0.25, hash11(fr * 1.3 + float(i)));
    c = mix(c, vec3(0.9, 0.95, 0.85), smoothstep(1.4, 0.3, sd) * on * 0.6);
  }
  // Nitrate decay: blooms of mottled, bubbling emulsion eating in from the edges.
  if (uStock == 3) {
    float edge = max(abs(q.x - 0.5), abs(q.y - 0.5)) * 2.0;
    float rot = fbm(q * vec2(5.0, 3.5) + vec2(uSeed, uTime * 0.03)) + pow(edge, 3.0) * 0.3 * uWear;
    float m = smoothstep(0.8, 0.88, rot);
    vec3 bubbles = vec3(0.75, 0.66, 0.5) * (0.6 + 0.6 * vnoise(q * 180.0 + fr * 0.05));
    c = mix(c, bubbles, m);
    c = mix(c, vec3(0.35, 0.2, 0.08), smoothstep(0.77, 0.8, rot) * (1.0 - m) * 0.8);
  }
  // Splice: a flash of leader, then the frame settles; worn prints can burn through.
  c = mix(c, vec3(1.0, 0.95, 0.82), uEvAmt * smoothstep(0.15, 0.0, uEvT));
  if (uEvAmt > 0.0 && uWear > 1.1) {
    vec2 bc = hash22(vec2(uSeed, floor(uTime)));
    float br = smoothstep(0.35, 1.0, uEvT) * 0.5;
    float bd = length((q - bc) * vec2(aspect, 1.0)) - br + vnoise(q * 30.0) * 0.06;
    c = mix(c, vec3(1.0, 0.98, 0.9), smoothstep(0.01, -0.01, bd));
    c = mix(c, vec3(1.0, 0.45, 0.05), smoothstep(0.04, 0.0, abs(bd)) * step(0.0, br - 0.01));
  }
  c *= inPic;

  // Outside the picture (scan overscan): film base, frame lines and sprocket holes.
  if (uGate > 0.0 && inPic < 1.0) {
    vec3 base = uTone == 0 ? vec3(0.09, 0.05, 0.03) : vec3(0.05);
    float lineY = fract(fy);
    bool side = q.x < 0.0 || q.x > 1.0;
    vec3 film = base;
    float holeX = q.x < 0.0 ? -0.055 : 1.055;
    float perfs = uStock == 2 ? 4.0 : 1.0;
    if ((q.x < 0.0 || (uStock == 2 && q.x > 1.0)) && abs(q.x - holeX) < 0.06) {
      float hy = fract(lineY * perfs) - 0.5;
      float hole = sdRoundBox(vec2((q.x - holeX) * aspect, hy / perfs), vec2(0.022 * aspect / 1.7, 0.09 / perfs), 0.01);
      film = mix(film, vec3(1.0, 0.96, 0.88), smoothstep(0.003, -0.003, hole));
    }
    c += film * (1.0 - inPic) * (side ? 1.0 : 0.7);
  }
  fragColor = vec4(lin(max(c, 0.0)), 1.0);
}`;

const STOCK_INDEX: Record<string, number> = { super8: 0, '16mm': 1, '35mm': 2, nitrate: 3 };

class FilmStock implements Effect {
  readonly kind = 'filmStock';
  private readonly pass = new FullscreenPass(
    mat(FILM, {
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uWear: { value: 1 },
      uWeave: { value: 1 },
      uDust: { value: 1 },
      uFlicker: { value: 1 },
      uFade: { value: 0.3 },
      uLeaks: { value: 0.3 },
      uGate: { value: 0 },
      uEvT: { value: 0 },
      uEvAmt: { value: 0 },
      uSeed: { value: 0 },
      uKick: { value: 0 },
      uStock: { value: 0 },
      uTone: { value: 0 },
    }),
  );
  private readonly copy = new FullscreenPass(mat(COPY, {}));
  private readonly hold = new HeldFrame();

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, p: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget {
    const u = this.pass.material.uniforms;
    const fps = n(p.fps, 18);
    const seed = Math.round(n(p.seed, 0));
    // Stepped motion: the picture only changes on each film frame (18 fps home movies).
    const frame = Math.floor(ctx.time * (fps > 0 ? fps : 24));
    u.uInput.value = fps > 0 ? this.hold.update(renderer, this.copy, input, frame) : input.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    const ev = tapeEventAt(ctx.beat, ctx.beatsPerBar, n(p.splices, 0.2), seed + 31, ['pause']);
    u.uTime.value = ctx.time;
    u.uFrame.value = frame % 100000;
    u.uWear.value = n(p.wear, 1);
    u.uWeave.value = n(p.weave, 1);
    u.uDust.value = n(p.dust, 1);
    u.uFlicker.value = n(p.flicker, 1);
    u.uFade.value = n(p.fade, 0.3);
    u.uLeaks.value = n(p.leaks, 0.3);
    u.uGate.value = p.gate === true ? 1 : 0;
    u.uEvT.value = ev.t;
    u.uEvAmt.value = ev.kind === 'none' ? 0 : 1;
    u.uSeed.value = seed;
    u.uKick.value = ctx.kick;
    u.uStock.value = STOCK_INDEX[String(p.stock ?? 'super8')] ?? 0;
    u.uTone.value = p.tone === 'bw' ? 1 : p.tone === 'sepia' ? 2 : 0;
    this.pass.render(renderer, out);
    return out;
  }

  compileTargets(): FullscreenPass[] {
    return [this.pass, this.copy];
  }

  dispose(): void {
    this.pass.dispose();
    this.copy.dispose();
    this.hold.dispose();
  }
}

// ---------------------------------------------------------------------------
// Early digital

const DIGITAL = `${HEADER}
uniform sampler2D uPrev;
uniform sampler2D uHold;
uniform float uTime, uBlocks, uBitrate, uMosh, uMoshT, uMoshKey, uLowres, uUseHold, uSeed, uKey;

vec3 srcAt(vec2 p) {
  p = clamp(p, vec2(0.001), vec2(0.999));
  return uUseHold > 0.5 ? texture(uHold, p).rgb : texture(uInput, p).rgb;
}
// The source as a small, upscaled video (240 lines, bilinear).
vec3 small(vec2 p) {
  if (uLowres < 0.01) return srcAt(p);
  vec2 res = mix(uRes, vec2(240.0 * uRes.x / uRes.y, 240.0), uLowres);
  vec2 t = p * res - 0.5;
  vec2 f = fract(t);
  vec2 b = floor(t);
  vec3 a = srcAt((b + vec2(0.5, 0.5)) / res), c = srcAt((b + vec2(1.5, 0.5)) / res);
  vec3 d = srcAt((b + vec2(0.5, 1.5)) / res), e = srcAt((b + vec2(1.5, 1.5)) / res);
  return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
}

void main() {
  float bs = max(8.0, 16.0 * uRes.y / 720.0);
  vec2 block = floor(gl_FragCoord.xy / bs);
  vec2 centre = (block + 0.5) * bs / uRes;
  vec3 c = gam(small(vUv));
  vec3 avg = gam(small(centre));
  // Macroblocks: each block keeps its average and a coarsely quantised remainder.
  float q = hash21(block + uKey * 13.7 + uSeed);
  float loss = uBlocks * smoothstep(0.2, 1.0, q * 0.6 + uBlocks * 0.6);
  float levels = mix(24.0, 2.0, loss);
  c = avg + floor((c - avg) * levels + 0.5) / levels * (1.0 - 0.6 * loss);
  // 4:2:0 colour: chroma from a coarser grid.
  vec2 cuv = (floor(gl_FragCoord.xy / (bs * 0.5)) + 0.5) * bs * 0.5 / uRes;
  vec3 cy = toYIQ(c);
  vec3 cc = toYIQ(gam(small(cuv)));
  c = fromYIQ(vec3(cy.x, mix(cy.yz, cc.yz, min(1.0, uBlocks * 1.5))));
  // Low bitrate: banding.
  float bl = mix(255.0, 10.0, uBitrate);
  c = floor(c * bl + 0.5) / bl;
  // Datamosh: blocks keep dragging the previous frame along their motion until refreshed.
  if (uMosh > 0.0) {
    vec2 mv = (hash22(block + uMoshKey * 7.1 + uSeed) - 0.5) * 2.5 / uRes * bs * 0.25;
    float keep = step(hash21(block * 1.3 + uMoshKey + 4.0), uMosh * (1.0 - uMoshT));
    vec3 prev = gam(texture(uPrev, vUv - mv).rgb);
    c = mix(c, prev, keep);
  }
  if (uUseHold > 0.5) c *= 0.8;
  fragColor = vec4(lin(c), 1.0);
}`;

class DigitalRot implements Effect {
  readonly kind = 'digitalRot';
  private readonly pass = new FullscreenPass(
    mat(DIGITAL, {
      uPrev: { value: null },
      uHold: { value: null },
      uTime: { value: 0 },
      uBlocks: { value: 0.5 },
      uBitrate: { value: 0.4 },
      uMosh: { value: 0 },
      uMoshT: { value: 0 },
      uMoshKey: { value: 0 },
      uLowres: { value: 0.5 },
      uUseHold: { value: 0 },
      uSeed: { value: 0 },
      uKey: { value: 0 },
    }),
  );
  private readonly copy = new FullscreenPass(mat(COPY, {}));
  private readonly hold = new HeldFrame();
  private a: THREE.WebGLRenderTarget | null = null;
  private b: THREE.WebGLRenderTarget | null = null;

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, p: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget {
    if (!this.a || this.a.width !== out.width || this.a.height !== out.height) {
      this.a?.dispose();
      this.b?.dispose();
      this.a = hdrTarget(out.width, out.height);
      this.b = hdrTarget(out.width, out.height);
    }
    const u = this.pass.material.uniforms;
    const seed = Math.round(n(p.seed, 0));
    // Buffering stalls share the tape-event clock (the web kit's "Buffering…" agrees).
    const stall = tapeEventAt(ctx.beat, ctx.beatsPerBar, n(p.buffering, 0.2), seed + 101, ['pause']);
    u.uUseHold.value = stall.kind === 'pause' ? 1 : 0;
    u.uHold.value = stall.kind === 'pause' ? this.hold.update(renderer, this.copy, input, stall.start) : input.texture;
    // Mosh windows: two bars from every 4th bar line, decaying as blocks refresh.
    const bpb = Math.max(1, ctx.beatsPerBar);
    const win = ctx.beat / (bpb * 4);
    u.uMoshKey.value = Math.floor(win);
    u.uMoshT.value = Math.min(1, (win - Math.floor(win)) * 2);
    u.uMosh.value = n(p.mosh, 0) * (hash2(Math.floor(win), seed) < 0.6 ? 1 : 0);
    u.uInput.value = input.texture;
    u.uPrev.value = this.a.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    u.uTime.value = ctx.time;
    u.uBlocks.value = n(p.blocks, 0.5);
    u.uBitrate.value = n(p.bitrate, 0.4);
    u.uLowres.value = n(p.lowres, 0.5);
    u.uSeed.value = seed;
    u.uKey.value = Math.floor(ctx.beat / 2);
    this.pass.render(renderer, this.b!);
    const result = this.b!;
    this.b = this.a;
    this.a = result;
    return result;
  }

  compileTargets(): FullscreenPass[] {
    return [this.pass, this.copy];
  }

  dispose(): void {
    this.pass.dispose();
    this.copy.dispose();
    this.hold.dispose();
    this.a?.dispose();
    this.b?.dispose();
  }
}


// ---------------------------------------------------------------------------
// TV set

const TV = `${HEADER}
uniform float uTime, uZoom, uCurve, uPower, uOn, uGlow, uRoom;
uniform int uSet, uFit;   // set: 0-3 cabinets, 4 screen only · fit: 0 crop · 1 letterbox · 2 squash   // 0 60s console · 1 70s portable · 2 80s woodgrain · 3 90s black
float PX;
float fillD(float d) { return clamp(0.5 - d / PX, 0.0, 1.0); }
float strokeD(float d, float w) { return clamp(0.5 - (abs(d) - w) / PX, 0.0, 1.0); }
vec3 S(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

vec3 wood(vec2 p, vec3 a, vec3 b) {
  float g = fbm(vec2(p.x * 3.0, p.y * 40.0)) + 0.3 * sin(p.y * 90.0 + fbm(p * 6.0) * 8.0);
  return mix(a, b, smoothstep(0.2, 0.9, g));
}
float knob(vec2 p, vec2 c, float r) { return length(p - c) - r; }

void main() {
  PX = 1.5 / uRes.y;
  float asp = uRes.x / uRes.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  // Per set: cabinet half size, corner, screen centre, screen half height, screen corner.
  vec2 cab = uSet == 0 ? vec2(0.78, 0.4) : uSet == 1 ? vec2(0.56, 0.38) : uSet == 2 ? vec2(0.7, 0.41) : vec2(0.62, 0.43);
  float cabR = uSet == 1 ? 0.12 : uSet == 3 ? 0.04 : 0.025;
  vec2 sc = uSet == 0 ? vec2(-0.2, 0.0) : uSet == 1 ? vec2(-0.1, 0.0) : uSet == 2 ? vec2(-0.13, 0.0) : vec2(0.0, 0.045);
  float sh = uSet == 3 ? 0.34 : uSet == 1 ? 0.27 : 0.31;
  vec2 shalf = vec2(sh * 4.0 / 3.0, sh);
  float sR = uSet == 0 ? 0.09 : uSet == 1 ? 0.07 : uSet == 2 ? 0.05 : 0.025;
  vec2 s = mix(p, sc + p * 2.0 * shalf.y * 1.03, uZoom);
  bool full = uSet == 4;
  if (full) {
    // Just the tube: the picture fills the frame behind curved glass.
    shalf = vec2(asp * 0.5, 0.5) - 0.003;
    sc = vec2(0.0);
    sR = 0.03;
    s = p;
  }

  // Room behind the set.
  vec3 c = mix(S(vec3(0.07, 0.05, 0.04)), S(vec3(0.02, 0.015, 0.02)), smoothstep(-0.5, 0.5, s.y)) * uRoom;
  c += S(vec3(0.5, 0.35, 0.2)) * exp(-length(s - vec2(-0.9, 0.35)) * 3.0) * 0.15 * uRoom;
  if (s.y < -cab.y - 0.02) c = S(vec3(0.09, 0.06, 0.04)) * uRoom * (0.8 + 0.2 * fbm(s * vec2(2.0, 30.0)));

  // Average picture colour: light spilling from the screen onto the set.
  vec3 spill = (texture(uInput, vec2(0.3, 0.3)).rgb + texture(uInput, vec2(0.7, 0.3)).rgb + texture(uInput, vec2(0.5, 0.5)).rgb + texture(uInput, vec2(0.3, 0.7)).rgb + texture(uInput, vec2(0.7, 0.7)).rgb) * 0.2;
  spill *= uOn;

  if (full) c = vec3(0.0);
  // Cabinet.
  float body = full ? 1.0 : sdRoundBox(s, cab, cabR);
  vec3 cabC;
  if (uSet == 0) cabC = wood(s, S(vec3(0.25, 0.13, 0.06)), S(vec3(0.45, 0.25, 0.12)));
  else if (uSet == 1) cabC = mix(S(vec3(0.85, 0.45, 0.12)), S(vec3(0.95, 0.6, 0.25)), smoothstep(-0.4, 0.4, s.y));
  else if (uSet == 2) cabC = wood(s * 1.3, S(vec3(0.3, 0.17, 0.08)), S(vec3(0.5, 0.3, 0.14)));
  else cabC = S(vec3(0.035)) + S(vec3(0.12)) * smoothstep(0.3, 0.45, s.y) * 0.5;
  cabC *= 0.75 + 0.35 * smoothstep(-cab.y, cab.y, s.y);
  cabC += spill * 0.25 * exp(-max(sdRoundBox(s - sc, shalf, sR), 0.0) * 14.0);
  if (uSet == 1 && !full) {
    // Carry handle.
    float h = abs(length((s - vec2(0.0, cab.y - 0.05)) * vec2(1.0, 1.6)) - 0.26) - 0.012;
    c = mix(c, S(vec3(0.6)), fillD(h) * step(cab.y, s.y));
  }
  c = mix(c, cabC, fillD(body));
  if (!full) c = mix(c, cabC * 1.6 + 0.02, strokeD(body, 0.002) * 0.6);

  // Controls.
  if (uSet == 0) {
    vec2 g = s - vec2(0.48, -0.08);
    if (abs(g.x) < 0.2 && abs(g.y) < 0.26) c = mix(c, S(vec3(0.18, 0.15, 0.1)) * (0.6 + 0.4 * step(0.5, fract(g.x * 55.0))), 0.9);
    for (int i = 0; i < 2; i++) {
      vec2 kc = vec2(0.48, 0.3 - float(i) * 0.12);
      float k = knob(s, kc, 0.04);
      c = mix(c, S(vec3(0.8, 0.7, 0.45)) * (0.6 + 0.5 * smoothstep(0.04, -0.04, s.y - kc.y)), fillD(k));
      c = mix(c, S(vec3(0.15)), strokeD(abs(s.x - kc.x), 0.003) * step(k, 0.0) * step(kc.y, s.y));
    }
    c = mix(c, S(vec3(0.85, 0.7, 0.35)), strokeD(sdRoundBox(s - sc, shalf + 0.03, sR + 0.03), 0.004));
  } else if (uSet == 1) {
    vec2 dc = vec2(0.37, 0.12);
    float d = knob(s, dc, 0.075);
    c = mix(c, S(vec3(0.92, 0.9, 0.85)), fillD(d));
    float tick = abs(fract(atan(s.y - dc.y, s.x - dc.x) / 6.28318 * 12.0 + 0.5) - 0.5);
    c = mix(c, S(vec3(0.2)), step(tick, 0.06) * step(0.055, length(s - dc)) * step(d, 0.0));
    c = mix(c, S(vec3(0.3)), fillD(knob(s, dc, 0.03)));
    vec2 gp = (s - vec2(0.37, -0.15)) * 55.0;
    if (length(s - vec2(0.37, -0.15)) < 0.1) c = mix(c, S(vec3(0.25, 0.12, 0.04)), fillD((length(fract(gp) - 0.5) - 0.22) / 55.0));
    c = mix(c, S(vec3(0.8)), strokeD(sdRoundBox(s - sc, shalf + 0.025, sR + 0.025), 0.006));
  } else if (uSet == 2) {
    vec2 pc = s - vec2(0.48, 0.0);
    float panel = sdRoundBox(pc, vec2(0.13, 0.36), 0.01);
    c = mix(c, S(vec3(0.62, 0.62, 0.64)) * (0.85 + 0.15 * sin(s.y * 400.0)), fillD(panel));
    for (int i = 0; i < 6; i++) {
      float bt = sdRoundBox(pc - vec2(-0.05 + float(i % 2) * 0.1, 0.18 - float(i / 2) * 0.09), vec2(0.035, 0.025), 0.004);
      c = mix(c, S(vec3(0.15)), fillD(bt));
    }
    c = mix(c, S(vec3(1.0, 0.1, 0.05)) * (1.0 + 2.0 * uOn), fillD(length(pc - vec2(0.0, -0.25)) - 0.008));
    c = mix(c, S(vec3(0.08)), fillD(sdRoundBox(s - sc, shalf + 0.035, sR + 0.03)) * (1.0 - fillD(sdRoundBox(s - sc, shalf, sR))));
  } else if (uSet == 3) {
    float strip = step(abs(s.y + cab.y - 0.06), 0.035);
    for (int side = 0; side < 2; side++) {
      vec2 gp = s - vec2(side == 0 ? -0.45 : 0.45, -cab.y + 0.06);
      if (abs(gp.x) < 0.12 && abs(gp.y) < 0.025) c = mix(c, S(vec3(0.01)), step(0.5, fract(gp.x * 70.0)));
    }
    c = mix(c, S(vec3(0.6, 0.6, 0.62)), fillD(sdRoundBox(s - vec2(0.0, -cab.y + 0.06), vec2(0.05, 0.008), 0.003)) * strip);
    c = mix(c, S(vec3(0.1, 1.0, 0.3)) * (0.3 + 1.5 * uOn), fillD(length(s - vec2(0.2, -cab.y + 0.06)) - 0.005));
  }

  // The screen: curved glass, the picture, scanlines, mask, reflections.
  vec2 q = (s - sc) / shalf;
  float scr = sdRoundBox(s - sc, shalf, sR);
  if (scr < PX * 2.0) {
    q *= 1.0 + uCurve * 0.09 * dot(q.yx, q.yx);
    // Power: the picture collapses to a bright line, then a dot.
    float pw = uPower * uOn;
    float sy = clamp(pw / 0.6, 0.004, 1.0);
    float sx = clamp((pw - 0.0) / 0.12, 0.01, 1.0);
    vec2 qq = vec2(q.x / max(sx, 0.01), q.y / sy);
    float inside = step(abs(qq.x), 1.0) * step(abs(qq.y), 1.0);
    // Fit the picture (cover): crop the frame's sides to the 4:3 tube.
    vec2 uv = vec2(0.5 + qq.x * 0.5 * (4.0 / 3.0) / asp, 0.5 + qq.y * 0.5);
    if (full) uv = qq * 0.5 + 0.5;
    else if (uFit == 1) {
      uv = vec2(0.5 + qq.x * 0.5, 0.5 + qq.y * 0.5 * asp / (4.0 / 3.0));
      inside *= step(abs(uv.y - 0.5), 0.5);
    } else if (uFit == 2) uv = qq * 0.5 + 0.5;
    vec3 pic = texture(uInput, clamp(uv, 0.0, 1.0)).rgb * inside;
    pic *= 1.0 + (1.0 - sy) * 3.0 + (1.0 - sx) * 4.0;
    float line = 0.55 + 0.45 * sin((q.y * 0.5 + 0.5) * 300.0 * 3.14159);
    pic *= mix(1.0, line, 0.5);
    int m = int(mod(gl_FragCoord.x, 3.0));
    pic *= m == 0 ? vec3(1.08, 0.94, 0.94) : m == 1 ? vec3(0.94, 1.08, 0.94) : vec3(0.94, 0.94, 1.08);
    vec3 glass = S(vec3(0.03, 0.035, 0.035)) + pic;
    glass *= 1.0 - 0.35 * dot(q, q) * 0.5;
    float refl = smoothstep(0.5, 0.0, abs(q.x * 0.6 + q.y - 0.8)) * 0.05 + smoothstep(0.15, 0.0, length((q - vec2(-0.55, 0.55)) * vec2(1.0, 2.0))) * 0.06;
    glass += vec3(refl) * uGlow;
    c = mix(c, glass, fillD(scr));
  }
  fragColor = vec4(max(c, 0.0), 1.0);
}`;

const SET_INDEX: Record<string, number> = { console60: 0, portable70: 1, woodgrain80: 2, black90: 3, screen: 4 };

class TvSet implements Effect {
  readonly kind = 'tvSet';
  private readonly pass = new FullscreenPass(
    mat(TV, { uTime: { value: 0 }, uZoom: { value: 0 }, uCurve: { value: 1 }, uPower: { value: 1 }, uOn: { value: 1 }, uGlow: { value: 1 }, uRoom: { value: 1 }, uSet: { value: 2 }, uFit: { value: 0 } }),
  );
  private started = -1;

  render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, p: ParamBag, ctx: FxContext): THREE.WebGLRenderTarget {
    const u = this.pass.material.uniforms;
    if (this.started < 0 || ctx.time < this.started) this.started = ctx.time;
    // Switching on: the line opens out over half a second when the set first appears.
    const on = p.powerOn === false ? 1 : Math.min(1, (ctx.time - this.started) / 0.5);
    u.uInput.value = input.texture;
    (u.uRes.value as THREE.Vector2).set(out.width, out.height);
    u.uTime.value = ctx.time;
    u.uZoom.value = n(p.zoom, 0.1);
    u.uCurve.value = n(p.curve, 1);
    u.uPower.value = Math.min(on, ctx.power ?? 1);
    u.uOn.value = 1;
    u.uGlow.value = n(p.glare, 1);
    u.uRoom.value = n(p.room, 1);
    u.uSet.value = SET_INDEX[String(p.set ?? 'screen')] ?? 4;
    u.uFit.value = p.fit === 'letterbox' ? 1 : p.fit === 'squash' ? 2 : 0;
    this.pass.render(renderer, out);
    return out;
  }

  compileTargets(): FullscreenPass[] {
    return [this.pass];
  }

  dispose(): void {
    this.pass.dispose();
  }
}

export function createTapeEffect(kind: string): Effect | null {
  if (kind === 'tvSet') return new TvSet();
  if (kind === 'tapeStack') return new TapeStack();
  if (kind === 'filmStock') return new FilmStock();
  if (kind === 'digitalRot') return new DigitalRot();
  return null;
}
