import { GEN_HEADER } from '../shaders/common';
import { lyricMoment, TextMask } from '../lyricText';
import type { GenContext } from './Generator';
import { num, ShaderGenerator } from './ShaderGenerator';

export const NEO90_SCENES = ['holo', 'stereogram', 'lenticular', 'lava', 'stars'] as const;

const FRAG = /* glsl */ `${GEN_HEADER}
uniform int uScene;
uniform sampler2D uMask, uMask2, uSoft;
uniform float uHasText, uFlip, uReveal, uMelt, uLamp, uReact, uCharge, uLights, uMaskAspect;
float PX;
vec3 S(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 rainbow(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }

// Text mask lookup in frame-centred coordinates (the mask is drawn 2:1 into a box of this height).
float maskAt(sampler2D m, vec2 p, float h) {
  vec2 uv = vec2(p.x / (h * uMaskAspect) + 0.5, 0.5 - p.y / h);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture(m, uv).r;
}

// ---------------------------------------------------------------- holographic foil
vec3 sceneHolo(vec2 p) {
  vec2 tilt = vec2(sin(uTime * 0.37), cos(uTime * 0.29)) * 0.35 + vec2(uKick * 0.15 * uReact, 0.0);
  // Embossed relief: the words (soft mask) or a tiled pattern of stars and rings.
  float th = 0.62;
  float h = 0.0;
  vec2 grad = vec2(0.0);
  if (uHasText > 0.5) {
    float e = 0.004;
    h = smoothstep(0.25, 0.75, maskAt(uMask, p, th));
    grad = vec2(maskAt(uSoft, p + vec2(e, 0.0), th) - maskAt(uSoft, p - vec2(e, 0.0), th), maskAt(uSoft, p + vec2(0.0, e), th) - maskAt(uSoft, p - vec2(0.0, e), th)) / (2.0 * e);
  }
  vec2 cell = fract(p * 5.0) - 0.5;
  float star = sdPolygon(rot2(0.3) * cell, 0.18, 4.0);
  float stars = smoothstep(0.02, -0.02, star) * (1.0 - h);
  vec3 n = normalize(vec3(-grad * 0.05 - (uHasText > 0.5 ? vec2(0.0) : cell * stars * 0.6), 1.0));
  // Diffraction: colour from the angle between the surface and the light, plus fine grating rings.
  float r = length(p);
  float t = dot(n.xy + tilt, vec2(0.8, 0.6)) * 1.2 + p.x * 0.5 + p.y * 0.3 + uTime * 0.05;
  vec3 foil = mix(vec3(0.7, 0.73, 0.78), rainbow(t), 0.6) * (0.86 + 0.14 * sin(r * 260.0)) * 0.72;
  // Raised letters: bright silver catching a little colour, lit from the top left with a shadowed lower edge.
  vec3 raised = mix(vec3(1.08), rainbow(t + 0.5), 0.3);
  float bevel = clamp(dot(grad, normalize(vec2(-0.6, 0.8))) * 0.025, -1.0, 1.0);
  vec3 c = mix(foil, raised, h);
  c += vec3(1.0) * max(bevel, 0.0) * 0.9 + rainbow(t + 0.25) * abs(bevel) * 0.4;
  c *= 1.0 - max(-bevel, 0.0) * 0.75;
  // Glitter grain on the raised parts, a light sweep every bar.
  float grain = step(0.96, hash21(floor(gl_FragCoord.xy / 2.0)));
  c += vec3(1.2) * grain * (0.25 + 0.5 * h) * (0.5 + 0.5 * sin(uTime * 3.0 + hash21(floor(gl_FragCoord.xy / 2.0)) * 30.0));
  float sweep = smoothstep(0.12, 0.0, abs(p.x + p.y * 0.4 - (fract(uBeat / uBeatsPerBar) * 3.0 - 1.5)));
  c += vec3(0.8) * sweep * (0.4 + 0.6 * h);
  float spec = pow(max(dot(n, normalize(vec3(tilt * 1.5, 1.0))), 0.0), 40.0);
  c += vec3(1.0) * spec * 0.3 * (1.0 - h);
  return S(c);
}

// ---------------------------------------------------------------- hidden-picture stereogram
float stereoDepth(vec2 p) {
  if (uHasText > 0.5) return maskAt(uSoft, p, 0.6);
  // Default hidden shapes: a sphere and a ring.
  float s = 1.0 - smoothstep(0.0, 0.22, length(p - vec2(-0.35, 0.0)));
  float ring = 1.0 - smoothstep(0.0, 0.05, abs(length(p - vec2(0.4, 0.0)) - 0.18));
  return max(s, ring);
}
vec3 stereoPattern(vec2 q) {
  float n = fbm(q * 9.0) * 0.6 + hash21(floor(q * 220.0)) * 0.4;
  return palette(fract(n * 1.6 + uBeat * 0.01));
}
vec3 sceneStereogram(vec2 p) {
  float P = 0.16;         // pattern period (in frame heights)
  float D = P * 0.22;     // maximum depth shift
  float x = p.x + uRes.x / uRes.y * 0.5;
  float y = p.y;
  // Follow the chain of linked pixels to the left until it leaves the first strip.
  float xx = x;
  for (int i = 0; i < 48; i++) {
    if (xx < P) break;
    float d = stereoDepth(vec2(xx - uRes.x / uRes.y * 0.5, y));
    xx -= P - d * D;
  }
  vec3 c = stereoPattern(vec2(mod(xx, P) / P * 0.6, y * 0.6));
  // The two guide dots that help the eyes lock on.
  for (int k = 0; k < 2; k++) {
    vec2 g = vec2(-P * 0.5 + float(k) * P, 0.44);
    c = mix(c, vec3(0.0), smoothstep(0.012, 0.009, length(p - g)));
  }
  // For anyone who can't see it: the word shows through on the drop (and with Reveal).
  float show = clamp(uReveal + uKick * 0.0, 0.0, 1.0);
  c = mix(c, c * 0.35, show * stereoDepth(p));
  return c;
}

// ---------------------------------------------------------------- lenticular card
vec3 lentDesign(vec2 q, int which) {
  vec3 bg;
  if (which == 0) {
    float burst = step(0.5, fract(atan(q.y, q.x) / 6.28318 * 16.0 + uTime * 0.02));
    bg = mix(palette(0.25), palette(0.55), burst);
  } else {
    float chk = mod(floor(q.x * 10.0) + floor(q.y * 10.0), 2.0);
    bg = mix(palette(0.7), palette(0.95) * 0.8, chk);
  }
  float m = which == 0 ? maskAt(uMask, q, 0.5) : maskAt(uMask2, q, 0.5);
  float shadow = which == 0 ? maskAt(uMask, q + vec2(-0.01, 0.01), 0.5) : maskAt(uMask2, q + vec2(-0.01, 0.01), 0.5);
  vec3 c = mix(bg, vec3(0.02), shadow * 0.8);
  return mix(c, which == 0 ? vec3(1.0) : vec3(1.0, 0.95, 0.4), m);
}
vec3 sceneLenticular(vec2 p) {
  vec3 room = mix(S(vec3(0.08, 0.07, 0.1)), S(vec3(0.02)), length(p));
  // The card tilts back and forth; the flip happens through the middle of the tilt.
  float tilt = (uFlip - 0.5) * 0.5;
  vec2 q = p;
  q.x *= 1.0 + tilt * q.y * 0.6;
  vec2 b = vec2(0.62, 0.4);
  float card = sdRoundBox(q, b, 0.04);
  if (card > 0.0) return room * (1.0 + 0.5 * exp(-card * 20.0));
  // Interlaced strips under ridged lenses: which image a strip shows depends on the angle.
  float pitch = 7.0 / uRes.y;
  float strip = fract(q.x / pitch);
  float side = smoothstep(0.35, 0.65, uFlip + (strip - 0.5) * 0.35);
  vec3 a = S(lentDesign(q, 0));
  vec3 bb = S(lentDesign(q, 1));
  vec3 c = mix(a, bb, side);
  // Lens ridges: a highlight along each ridge, and a little banding.
  c *= 0.86 + 0.14 * sin(strip * 6.28318);
  c += vec3(0.25) * pow(max(0.0, sin(strip * 3.14159)), 24.0) * (0.4 + abs(tilt) * 2.0);
  return c;
}

// ---------------------------------------------------------------- lava lamp
float blobs(vec2 p, float heat) {
  float f = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float sp = (0.06 + 0.05 * hash11(fi * 1.7)) * heat;
    float y = sin(uTime * sp + fi * 2.1) * 0.38;
    float x = sin(uTime * sp * 0.7 + fi * 1.3) * 0.08 * (uLamp > 0.5 ? 1.0 : 5.0);
    float r = 0.05 + 0.06 * hash11(fi * 3.3);
    f += r * r / max(dot(p - vec2(x, y), p - vec2(x, y)), 1e-4);
  }
  return f;
}
vec3 sceneLava(vec2 p) {
  vec3 wax = palette(0.85) * 1.3;
  vec3 liquid = palette(0.4) * 0.5 + vec3(0.03);
  float heat = 0.7 + 0.8 * uEnergy * uReact;
  if (uLamp > 0.5) {
    vec3 c = S(vec3(0.03, 0.02, 0.03)) + palette(0.6) * 0.12 * exp(-length(p) * 2.5);
    // The vessel: a tapered glass with a metal cap and base.
    float w = mix(0.12, 0.2, smoothstep(0.42, -0.3, p.y));
    float glass = max(abs(p.x) - w, abs(p.y) - 0.38);
    float cap = sdBox(p - vec2(0.0, 0.43), vec2(mix(0.09, 0.12, smoothstep(0.48, 0.38, p.y)), 0.05));
    float base = sdBox(p - vec2(0.0, -0.44), vec2(mix(0.21, 0.15, smoothstep(-0.38, -0.5, p.y)), 0.07));
    vec3 metal = S(vec3(0.75, 0.72, 0.68)) * (0.5 + 0.5 * sin(p.x * 40.0));
    if (glass < 0.0) {
      vec2 q = vec2(p.x / w * 0.13, p.y);
      float f = blobs(q, heat);
      vec3 inside = mix(liquid, wax, smoothstep(0.9, 1.1, f));
      inside += wax * 0.4 * smoothstep(0.6, 1.0, f) * (1.0 - smoothstep(1.0, 1.4, f));
      inside *= 0.8 + 0.4 * smoothstep(-0.38, 0.38, -p.y);
      c = inside + vec3(0.12) * smoothstep(-w, -w + 0.02, p.x) * smoothstep(-w + 0.06, -w + 0.02, p.x);
    }
    c = mix(c, metal, clamp(0.5 - cap / PX, 0.0, 1.0));
    c = mix(c, metal * 0.8, clamp(0.5 - base / PX, 0.0, 1.0));
    return c;
  }
  // Full screen: a wall of wax, with the words (when given) melting into it.
  float f = blobs(p * vec2(0.6, 1.0), heat);
  if (uHasText > 0.5) {
    float drip = uMelt * (0.04 + 0.12 * vnoise(vec2(p.x * 22.0, 3.0)));
    float m = maskAt(uMask, p + vec2(0.0, drip), 0.55);
    f = max(f, m * 1.6);
  }
  vec3 c = mix(liquid, wax, smoothstep(0.9, 1.1, f));
  c += wax * 0.35 * smoothstep(0.55, 1.0, f) * (1.0 - smoothstep(1.0, 1.5, f));
  return c * (0.8 + 0.3 * smoothstep(-0.5, 0.5, -p.y));
}

// ---------------------------------------------------------------- glow-in-the-dark star ceiling
float starShape(vec2 q, float r) { return sdPolygon(rot2(0.0) * q, r, 5.0) * 0.6 + (length(q) - r * 0.75) * 0.4; }
vec3 sceneStars(vec2 p) {
  vec3 ceiling = S(vec3(0.06, 0.07, 0.11)) * (0.9 + 0.1 * vnoise(p * 60.0));
  vec3 lit = S(vec3(0.85, 0.84, 0.8));
  vec3 glow = S(vec3(0.6, 1.0, 0.45));
  vec3 c = mix(ceiling, lit, uLights);
  float charge = uCharge;
  // Scattered stickers.
  vec2 cell = floor(p * 7.0);
  vec2 lp = fract(p * 7.0) - 0.5 - (hash22(cell) - 0.5) * 0.5;
  float clear = uHasText > 0.5 ? maskAt(uSoft, p, 0.8) : 0.0;
  if (hash21(cell + 3.0) > 0.55 && clear < 0.04) {
    float d = starShape(rot2(hash21(cell) * 6.0) * lp, 0.12 + 0.06 * hash21(cell + 9.0));
    float m = smoothstep(0.01, -0.01, d);
    c = mix(c, mix(glow * (0.25 + 1.2 * charge), S(vec3(0.85, 0.9, 0.7)), uLights), m);
    c += glow * exp(-max(d, 0.0) * 40.0) * 0.25 * charge * (1.0 - uLights);
  }
  // The words, spelled out in small stars on a fine grid.
  if (uHasText > 0.5) {
    vec2 fc = floor(p * 64.0);
    vec2 fp = fract(p * 64.0) - 0.5;
    float m = maskAt(uMask, (fc + 0.5) / 64.0, 0.8);
    if (m > 0.5) {
      float d = starShape(rot2(hash21(fc) * 6.0) * fp, 0.38);
      float tw = 0.8 + 0.2 * sin(uTime * 3.0 + hash21(fc) * 20.0);
      c = mix(c, mix(glow * (0.4 + 1.6 * charge) * tw, S(vec3(0.9, 0.92, 0.75)), uLights), smoothstep(0.03, -0.03, d));
      c += glow * exp(-max(d, 0.0) * 18.0) * 0.18 * charge * (1.0 - uLights);
    }
  }
  // A crescent moon sticker.
  vec2 mp = p - vec2(uRes.x / uRes.y * 0.36, 0.3);
  float moon = max(length(mp) - 0.07, -(length(mp - vec2(0.03, 0.02)) - 0.06));
  c = mix(c, mix(glow * (0.3 + 1.3 * charge), S(vec3(0.9, 0.92, 0.7)), uLights), smoothstep(0.004, -0.004, moon));
  return c;
}

void main() {
  PX = 1.2 / uRes.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 c;
  if (uScene == 0) c = sceneHolo(p);
  else if (uScene == 1) c = sceneStereogram(p);
  else if (uScene == 2) c = sceneLenticular(p);
  else if (uScene == 3) c = sceneLava(p);
  else c = sceneStars(p);
  fragColor = vec4(max(c, 0.0), 1.0);
}
`;

/**
 * Neo-90s surfaces that use words as a shape: holographic foil with the lyrics
 * embossed, a hidden-picture stereogram with the lyric inside, a lenticular
 * card flipping between words on the beat, a lava lamp (or a wall of wax the
 * words melt into), and a ceiling of glow-in-the-dark stars spelling the line.
 */
export class Neo90 extends ShaderGenerator {
  readonly kind = 'neo90';
  private readonly mask = new TextMask(1024, 512);
  private readonly mask2 = new TextMask(1024, 512);
  private readonly soft = new TextMask(512, 256);

  constructor() {
    super(FRAG, {
      uScene: { value: 0 },
      uMask: { value: null },
      uMask2: { value: null },
      uSoft: { value: null },
      uHasText: { value: 0 },
      uFlip: { value: 0 },
      uReveal: { value: 0 },
      uMelt: { value: 0 },
      uLamp: { value: 1 },
      uReact: { value: 1 },
      uCharge: { value: 1 },
      uLights: { value: 0 },
      uMaskAspect: { value: 2 },
    });
    this.u.uMask.value = this.mask.texture;
    this.u.uMask2.value = this.mask2.texture;
    this.u.uSoft.value = this.soft.texture;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const p = ctx.params;
    const u = this.u;
    const scene = Math.max(0, NEO90_SCENES.indexOf(String(p.scene ?? 'holo') as (typeof NEO90_SCENES)[number]));
    u.uScene.value = scene;
    u.uReact.value = num(p.react, 1);
    u.uLamp.value = p.lamp === false ? 0 : 1;
    const words = String(p.words ?? 'line');
    const hasText = words !== 'off';
    u.uHasText.value = hasText ? 1 : 0;
    const bpb = Math.max(1, ctx.frame.beatsPerBar);
    if (hasText) {
      const m = lyricMoment(ctx);
      const heroText = m.hero >= 0 ? m.current.words[m.hero]?.text ?? m.current.text : m.current.text;
      const text = words === 'hero' ? heroText : m.current.text;
      const font = String(p.font ?? 'heavy');
      // Lenticular: this word and the next, flipping on the beat.
      if (scene === 2) {
        const ws = m.current.words.map((w) => w.text);
        const k = Math.floor(ctx.beat);
        const a = ws.length ? ws[Math.floor(k / 2) % ws.length] : text;
        const b = ws.length ? ws[(Math.floor(k / 2) + 1) % ws.length] : m.next;
        this.mask.draw(a, font, 1);
        this.mask2.draw(b, font, 1);
      } else {
        this.mask.draw(text, font, scene === 4 ? 2 : 3);
        this.soft.draw(text, font, scene === 4 ? 2 : 3, scene === 1 ? 3 : 6);
      }
      const len = Math.max(0.5, m.current.end - m.current.start);
      u.uMelt.value = Math.min(1, Math.max(0, (m.now - m.current.start) / len)) * num(p.melt, 1);
    }
    // Lenticular tilt: a snap at every other beat.
    const ph = (ctx.beat / 2) % 2;
    const snap = (x: number): number => Math.min(1, Math.max(0, (x - 0.85) / 0.15));
    u.uFlip.value = ph < 1 ? snap(ph) : 1 - snap(ph - 1);
    // Stereogram: show the hidden word on the drop (and with Reveal).
    u.uReveal.value = Math.min(1, num(p.reveal, 0) + ctx.env.drop * 0.9);
    // Star ceiling: the light goes on at the start of each phrase and on the drop; the stars charge, then glow down.
    const phrase = ctx.beat % (bpb * 8);
    const lightsOn = phrase < 0.5 || ctx.env.drop > 0.8 ? 1 : 0;
    u.uLights.value = lightsOn * 0.85;
    u.uCharge.value = Math.max(0.15, Math.exp(-phrase / (bpb * 6))) * (0.85 + 0.3 * ctx.env.kick * num(p.react, 1));
  }

  dispose(): void {
    this.mask.dispose();
    this.mask2.dispose();
    this.soft.dispose();
    super.dispose();
  }
}
