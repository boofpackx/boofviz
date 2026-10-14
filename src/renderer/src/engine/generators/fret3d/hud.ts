import * as THREE from 'three';
import { DISPLAY_GLSL } from '../../shaders/common';
import type { Popup } from '../FretHighway';

export const FONT_SECTION = '"Rock Salt", "Permanent Marker", cursive';
export const FONT_TITLE = '"New Rocker", "Russo One", serif';
export const FONT_HUD = 'Bungee, "Russo One", Impact, sans-serif';

/** A chrome-framed panel with a dark inset (the console HUD look). */
export function chromePanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, inset = '#120c22'): void {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.roundRect(x + r * 0.3, y + r * 0.45, w, h, r);
  g.fill();
  const frame = g.createLinearGradient(x, y, x, y + h);
  frame.addColorStop(0, '#fbfbff');
  frame.addColorStop(0.45, '#8c8c9c');
  frame.addColorStop(0.55, '#5a5a68');
  frame.addColorStop(1, '#d0d0dc');
  g.fillStyle = frame;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
  const b = Math.max(2, Math.min(w, h) * 0.07);
  const inner = g.createLinearGradient(x, y + b, x, y + h - b);
  inner.addColorStop(0, inset);
  inner.addColorStop(1, '#030206');
  g.fillStyle = inner;
  g.beginPath();
  g.roundRect(x + b, y + b, w - b * 2, h - b * 2, Math.max(1, r - b));
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = Math.max(1, b * 0.3);
  g.stroke();
  g.restore();
}

/** Text with a heavy dark outline, the way console HUD type reads over anything. */
export function outlinedText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, font: string, fill: string | CanvasGradient, outline = 'rgba(0,0,0,0.9)', weight = 0.18): void {
  g.font = `${size}px ${font}`;
  g.lineJoin = 'round';
  g.lineWidth = size * weight;
  g.strokeStyle = outline;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

const QUAD_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const QUAD_FRAG = /* glsl */ `
precision highp float;
${DISPLAY_GLSL}
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 c = texture(uTex, vUv);
  float a = c.a * uOpacity;
  // Canvas colours are display colours: undo the output pass so they come out as drawn.
  fragColor = vec4(fromDisplay(c.rgb) * a, a);
}
`;

/** A canvas shown on a screen-space quad. */
class Panel {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.RawShaderMaterial;
  key = '';

  constructor(w: number, h: number, geo: THREE.PlaneGeometry) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VERT,
      fragmentShader: QUAD_FRAG,
      uniforms: { uTex: { value: this.tex }, uOpacity: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  /** Redraw when `key` changes. */
  draw(key: string, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (key === this.key) return;
    this.key = key;
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    paint(this.g, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }

  place(x: number, y: number, w: number, h: number, opacity = 1): void {
    this.mesh.position.set(x, y, 0);
    this.mesh.scale.set(w, h, 1);
    this.mat.uniforms.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.003;
  }

  dispose(): void {
    this.tex.dispose();
    this.mat.dispose();
  }
}

export interface HudFrame {
  t: number;
  score: number;
  streak: number;
  mult: number;
  power: boolean;
  rock: number;
  star: number;
  section: { name: string; at: number };
  popups: Popup[];
  show: boolean;
  /** Three highways: the panels move out of their way. */
  band: boolean;
  aspect: number;
}

const ZONES: Array<[number, number, string]> = [
  [0, 0.33, '#e8262c'],
  [0.33, 0.66, '#f6d41c'],
  [0.66, 1, '#2ad848'],
];

/**
 * The HUD in screen space (y from −1 at the bottom to 1 at the top): the
 * score box with the streak lights and the multiplier on the left, the rock
 * meter and the star power tube on the right, section names at the top and
 * the streak and star power call-outs in the middle. Each panel is a canvas,
 * redrawn only when what it shows changes.
 */
export class Hud {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-16 / 9, 16 / 9, 1, -1, -1, 1);
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly left: Panel;
  private readonly right: Panel;
  private readonly title: Panel;
  private readonly calls: Panel[];

  constructor() {
    this.left = new Panel(512, 512, this.geo);
    this.right = new Panel(512, 512, this.geo);
    this.title = new Panel(1024, 192, this.geo);
    this.calls = [new Panel(1024, 160, this.geo), new Panel(1024, 160, this.geo)];
    for (const p of [this.left, this.right, this.title, ...this.calls]) this.scene.add(p.mesh);
  }

  update(f: HudFrame): void {
    const a = f.aspect;
    this.camera.left = -a;
    this.camera.right = a;
    this.camera.updateProjectionMatrix();
    const vis = f.show ? 1 : 0;
    // Left: the score, the streak lights and the multiplier.
    const mult = f.mult;
    const lit = mult >= 4 ? 10 : f.streak % 10;
    this.left.draw(`${f.score}|${mult}|${lit}|${f.power}`, (g) => this.paintLeft(g, f.score, mult, lit, f.power));
    // Right: the rock meter and the star tube (the needle moves smoothly, so redraw on a fine step).
    const needle = Math.round(f.rock * 200);
    const star = Math.round(f.star * 40);
    const blink = f.star >= 0.5 && !f.power ? Math.floor(f.t * 6) & 1 : 0;
    this.right.draw(`${needle}|${star}|${blink}|${f.power}`, (g) => this.paintRight(g, needle / 200, star / 40, blink === 1, f.power));
    const side = f.band ? 0.66 : 0.5;
    const size = 0.56;
    this.left.place(-a + size * 0.5 + 0.02 + (f.band ? 0 : Math.max(0, a - 1.78) * 0.5) + (f.band ? 0 : side - 0.5) , -0.62, size, size, vis);
    this.right.place(a - size * 0.5 - 0.02 - (f.band ? 0 : Math.max(0, a - 1.78) * 0.5), -0.62, size, size, vis);
    // Section names, top centre, coming and going.
    const age = f.t - f.section.at;
    const so = f.section.name && age < 5 ? clamp01(age / 0.25) * clamp01((5 - age) / 0.8) : 0;
    this.title.draw(f.section.name, (g, w, h) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 14;
      g.shadowOffsetY = 4;
      outlinedText(g, f.section.name, w / 2, h * 0.52, 92, FONT_SECTION, '#f4f4ee', 'rgba(20,16,12,0.85)', 0.1);
    });
    this.title.place(0, 0.83, 1.5, 1.5 * (192 / 1024), so * vis);
    // Call-outs.
    for (let i = 0; i < this.calls.length; i++) {
      const pp = f.popups[i];
      const panel = this.calls[i];
      if (!pp) {
        panel.place(0, 0, 0, 0, 0);
        continue;
      }
      const age2 = f.t - pp.at;
      const pop = age2 < 0.18 ? 0.6 + 0.6 * (age2 / 0.18) : 1.2 - 0.2 * Math.min(1, (age2 - 0.18) / 0.2);
      panel.draw(`${pp.kind}|${pp.text}`, (g, w, h) => {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const blue = pp.kind !== 'streak';
        const grad = g.createLinearGradient(0, h * 0.2, 0, h * 0.8);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.55, blue ? '#8fdcff' : '#ffffff');
        grad.addColorStop(1, blue ? '#2a7cff' : '#ffb020');
        outlinedText(g, pp.text, w / 2, h / 2, 96, FONT_HUD, grad, blue ? 'rgba(0,8,40,0.95)' : 'rgba(40,0,0,0.92)', 0.22);
      });
      const w = 1.25 * pop;
      panel.place(0, 0.36 - i * 0.2, w, w * (160 / 1024), clamp01((1.8 - age2) / 0.4) * vis);
    }
  }

  private paintLeft(g: CanvasRenderingContext2D, score: number, mult: number, lit: number, power: boolean): void {
    const u = 512 / 260;
    g.save();
    g.scale(u, u);
    g.textBaseline = 'middle';
    // The score box.
    chromePanel(g, 30, 40, 200, 58, 12);
    g.textAlign = 'right';
    outlinedText(g, score.toLocaleString('en-US'), 212, 71, 30, FONT_HUD, '#ffffff', 'rgba(0,0,0,0.9)', 0.12);
    // The multiplier plate, tilted like a stomp box.
    g.translate(130, 170);
    g.rotate(-0.06);
    chromePanel(g, -100, -62, 200, 124, 14, '#1c0d38');
    const colour = power ? '#5cc8ff' : ['#8a8a96', '#ff8a1a', '#3ee05a', '#b25cff'][mult - 1];
    for (let i = 0; i < 10; i++) {
      const bx = -82 + i * 18.2;
      const on = i < lit;
      g.fillStyle = on ? colour : '#2a2238';
      g.beginPath();
      g.arc(bx, -40, 6.5, 0, Math.PI * 2);
      g.fill();
      if (on) {
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.arc(bx - 2, -42, 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }
    const sq = 64;
    const face = g.createLinearGradient(0, -18, 0, -18 + sq);
    face.addColorStop(0, colour);
    face.addColorStop(1, '#14082a');
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.roundRect(-sq / 2 - 3, -21, sq + 6, sq + 6, 8);
    g.fill();
    g.fillStyle = face;
    g.beginPath();
    g.roundRect(-sq / 2, -18, sq, sq, 6);
    g.fill();
    g.textAlign = 'center';
    const label = power ? `x${mult * 2}` : mult > 1 ? `x${mult}` : '1';
    outlinedText(g, label, 0, -18 + sq * 0.54, power || mult > 1 ? 34 : 44, FONT_HUD, '#ffffff', 'rgba(0,0,0,0.9)', 0.16);
    g.restore();
  }

  private paintRight(g: CanvasRenderingContext2D, rock: number, star: number, blink: boolean, power: boolean): void {
    const u = 512 / 260;
    g.save();
    g.scale(u, u);
    chromePanel(g, 30, 40, 200, 150, 16, '#101418');
    const cx = 130;
    const cy = 138;
    const R = 76;
    const a0 = Math.PI * 1.08;
    const a1 = Math.PI * 1.92;
    g.lineWidth = 22;
    for (const [z0, z1, c] of ZONES) {
      g.strokeStyle = c;
      g.beginPath();
      g.arc(cx, cy, R - 12, a0 + (a1 - a0) * z0 + 0.02, a0 + (a1 - a0) * z1 - 0.02);
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2.5;
    for (let i = 0; i <= 12; i++) {
      const a = a0 + ((a1 - a0) * i) / 12;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 23), cy + Math.sin(a) * (R - 23));
      g.lineTo(cx + Math.cos(a) * (R - 1), cy + Math.sin(a) * (R - 1));
      g.stroke();
    }
    const na = a0 + (a1 - a0) * Math.min(1, Math.max(0, rock));
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(na) * (R - 6), cy + Math.sin(na) * (R - 6));
    g.stroke();
    g.fillStyle = '#d8d8e0';
    g.beginPath();
    g.arc(cx, cy, 8, 0, Math.PI * 2);
    g.fill();
    const zone = rock < 0.33 ? 0 : rock < 0.66 ? 1 : 2;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    outlinedText(g, 'ROCK', cx, 170, 28, FONT_HUD, ZONES[zone][2], 'rgba(0,0,0,0.9)', 0.16);
    // The star power tube.
    chromePanel(g, 40, 202, 180, 28, 14, '#060a12');
    if (star > 0) {
      const tube = g.createLinearGradient(0, 208, 0, 224);
      tube.addColorStop(0, '#e8f8ff');
      tube.addColorStop(0.5, '#3aa8ff');
      tube.addColorStop(1, '#0a4ab0');
      g.globalAlpha = blink ? 0.6 : 1;
      g.fillStyle = power ? '#9fe0ff' : tube;
      g.beginPath();
      g.roundRect(48, 209, 164 * star, 14, 7);
      g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  dispose(): void {
    for (const p of [this.left, this.right, this.title, ...this.calls]) p.dispose();
    this.geo.dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
