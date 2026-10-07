import * as THREE from 'three';
import { GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { fontCss } from './KineticType';
import { num, ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
uniform sampler2D uText;
uniform float uSweep, uNow, uSpb, uBeatNow, uFlatAge, uFlatLen, uAlarm, uGlowAmt;
float PX;

// One heartbeat per beat: P wave, QRS spike, T wave (phase 0..1 through the beat).
float ecg(float ph) {
  float p = 0.12 * exp(-pow((ph - 0.12) / 0.035, 2.0));
  float q = -0.12 * exp(-pow((ph - 0.235) / 0.012, 2.0));
  float r = 1.0 * exp(-pow((ph - 0.26) / 0.013, 2.0));
  float s = -0.25 * exp(-pow((ph - 0.285) / 0.013, 2.0));
  float t = 0.28 * exp(-pow((ph - 0.5) / 0.06, 2.0));
  return p + q + r + s + t;
}
// Pulse oximeter wave, trailing the ECG.
float pleth(float ph) {
  float x = fract(ph - 0.3);
  return smoothstep(0.0, 0.18, x) * (1.0 - smoothstep(0.18, 0.9, x)) + 0.18 * exp(-pow((x - 0.45) / 0.05, 2.0));
}
float resp(float t) { return 0.5 + 0.5 * sin(t * 6.28318 / 4.0); }

// Value of a trace at screen x: the monitor wrote it when the sweep passed, so look up that time.
float traceTime(float x) {
  float ago = x <= uSweep ? (uSweep - x) : (uSweep + 1.0 - x);
  return ago * 4.0;   // seconds across the screen
}

vec3 trace(vec2 uv, float y0, float h, int kind, vec3 col) {
  float x = uv.x;
  float ago = traceTime(x);
  float gap = step(uSweep, x) * step(x, uSweep + 0.03);           // erase bar just ahead of the sweep
  float beat = uBeatNow - ago / uSpb;
  float flatv = step(uFlatAge - uFlatLen, ago) * step(ago, uFlatAge);
  float v;
  if (kind == 0) v = ecg(fract(beat)) * (1.0 - flatv);
  else if (kind == 1) v = pleth(fract(beat)) * (1.0 - flatv * 0.9);
  else v = resp(uNow - ago);
  // Distance to the polyline, from the value at neighbouring columns.
  float dx = 1.5 / uRes.x;
  float va = v, vb;
  float agoB = traceTime(x + dx);
  float beatB = uBeatNow - agoB / uSpb;
  if (kind == 0) vb = ecg(fract(beatB)) * (1.0 - step(uFlatAge - uFlatLen, agoB) * step(agoB, uFlatAge));
  else if (kind == 1) vb = pleth(fract(beatB)) * (1.0 - step(uFlatAge - uFlatLen, agoB) * step(agoB, uFlatAge) * 0.9);
  else vb = resp(uNow - agoB);
  float ya = y0 + va * h, yb = y0 + vb * h;
  float lo = min(ya, yb) - 0.003, hi = max(ya, yb) + 0.003;
  float d = uv.y < lo ? lo - uv.y : uv.y > hi ? uv.y - hi : 0.0;
  d *= uRes.y;
  // Phosphor: fresher trace is brighter.
  float fresh = exp(-ago * 0.35);
  float line = smoothstep(1.8, 0.4, d);
  float glow = exp(-d * 0.18) * 0.35 * uGlowAmt;
  return col * (line * (0.55 + 0.75 * fresh) + glow * fresh) * (1.0 - gap);
}

void main() {
  PX = 1.0 / uRes.y;
  vec2 uv = vUv;
  vec3 c = vec3(0.004, 0.008, 0.01);
  // Graph area (left 70%): faint grid.
  vec2 g = vUv * vec2(uRes.x / uRes.y, 1.0) * 12.0;
  vec2 gd = abs(fract(g) - 0.5);
  c += vec3(0.0, 0.035, 0.03) * step(0.47, max(gd.x, gd.y)) * step(uv.x, 0.7);
  if (uv.x < 0.7) {
    vec2 tv = vec2(uv.x / 0.7, uv.y);
    vec3 ecgCol = mix(vec3(0.15, 1.0, 0.35), vec3(1.0, 0.15, 0.1), uAlarm);
    c += trace(tv, 0.68, 0.2, 0, ecgCol * 1.3);
    c += trace(tv, 0.38, 0.13, 1, vec3(0.2, 0.85, 1.0) * 1.2);
    c += trace(tv, 0.12, 0.1, 2, vec3(1.0, 0.9, 0.2));
  }
  // Numbers and labels from the canvas.
  vec4 t = texture(uText, vec2(uv.x, 1.0 - uv.y));
  c = mix(c, pow(t.rgb, vec3(2.2)) * 1.4, t.a);
  // Monitor glass: slight vignette and scanlines.
  vec2 vp = uv - 0.5;
  c *= 1.0 - 0.5 * dot(vp, vp);
  c *= 0.92 + 0.08 * sin(gl_FragCoord.y * 3.14159);
  fragColor = vec4(c, 1.0);
}
`;

/**
 * A bedside patient monitor: ECG, pleth and respiration traces sweeping left
 * to right with phosphor persistence, one heartbeat per beat, the heart rate
 * reading the live BPM, and a flatline alarm on the drop before it restarts.
 */
export class VitalSigns extends ShaderGenerator {
  readonly kind = 'vitalSigns';
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: THREE.CanvasTexture;
  private lastDraw = -1;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    super(FRAG, {
      uText: { value: tex },
      uSweep: { value: 0 },
      uNow: { value: 0 },
      uSpb: { value: 0.5 },
      uBeatNow: { value: 0 },
      uFlatAge: { value: -10 },
      uFlatLen: { value: 2 },
      uAlarm: { value: 0 },
      uGlowAmt: { value: 1 },
    });
    this.canvas = canvas;
    this.tex = tex;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const bpm = ctx.frame.bpm || 120;
    const spb = 60 / Math.max(30, bpm) / Math.max(0.25, ctx.globals.speed || 1);
    // Time from the beat counter, so preview and output sweep together.
    const now = ctx.beat * spb;
    u.uNow.value = now;
    u.uSpb.value = spb;
    u.uBeatNow.value = ctx.beat;
    u.uSweep.value = (now / 4) % 1;
    // Drop: a two-beat flatline (and alarm), seconds ago derived from the drop envelope.
    const flatOn = num(p.flatline, 1) > 0.5 && ctx.env.drop > 0.02;
    const dropAge = flatOn ? -3 * Math.log(Math.max(1e-4, ctx.env.drop)) : 99;
    u.uFlatAge.value = dropAge;
    u.uFlatLen.value = 2 * spb;
    const alarm = dropAge < 2 * spb + 1.5;
    u.uAlarm.value = alarm ? 0.5 + 0.5 * Math.sign(Math.sin(now * 12)) : 0;
    u.uGlowAmt.value = num(p.glow, 1);
    // Readouts (redrawn a few times a second).
    const step = Math.floor(now * 4);
    if (step !== this.lastDraw) {
      this.lastDraw = step;
      this.drawText(bpm, alarm, now, String(p.patient ?? 'BED 04'));
    }
  }

  private drawText(bpm: number, alarm: boolean, now: number, patient: string): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 960, 540);
    g.textBaseline = 'alphabetic';
    const x = 960 * 0.72;
    const label = (t: string, y: number, col: string): void => {
      g.font = fontCss('mono', 16);
      g.fillStyle = col;
      g.fillText(t, x, y);
    };
    const big = (t: string, y: number, col: string, px: number): void => {
      g.font = fontCss('heavy', px);
      g.fillStyle = col;
      g.fillText(t, x + 10, y);
    };
    const green = alarm ? (Math.floor(now * 4) % 2 ? '#ff3020' : '#ffd0c0') : '#40ff70';
    label('HR  bpm', 60, green);
    big(alarm ? '---' : String(Math.round(bpm)), 140, green, 86);
    label('SpO2 %', 200, '#4fd8ff');
    big(String(97 + (Math.floor(now / 7) % 3)), 262, '#4fd8ff', 56);
    label('NIBP mmHg', 312, '#ff7ad9');
    big('118/76', 360, '#ff7ad9', 38);
    label('RESP', 410, '#ffe14a');
    big(String(15 + (Math.floor(now / 11) % 3)), 458, '#ffe14a', 38);
    g.font = fontCss('mono', 15);
    g.fillStyle = '#9aa';
    g.fillText(patient, 20, 26);
    g.fillText('II', 20, 150);
    g.fillText('PLETH', 20, 312);
    g.fillText('RESP', 20, 450);
    if (alarm) {
      g.fillStyle = Math.floor(now * 4) % 2 ? '#ff2a1a' : '#661010';
      g.fillRect(260, 8, 260, 28);
      g.fillStyle = '#fff';
      g.font = fontCss('heavy', 18);
      g.fillText('*** ALARM ***', 318, 29);
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    super.dispose();
    this.tex.dispose();
  }
}
