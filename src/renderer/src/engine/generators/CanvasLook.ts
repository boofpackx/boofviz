import * as THREE from 'three';
import { DISPLAY_GLSL, GEN_HEADER } from '../shaders/common';
import type { GenContext } from './Generator';
import { ShaderGenerator } from './ShaderGenerator';

const FRAG = /* glsl */ `${GEN_HEADER}
${DISPLAY_GLSL}
uniform sampler2D uTex;
void main() {
  // Premultiplied: a look drawn as an overlay leaves the canvas clear around its words.
  vec4 c = texture(uTex, vec2(vUv.x, 1.0 - vUv.y));
  fragColor = vec4(fromDisplay(c.rgb) * c.a, c.a);
}
`;

/**
 * A look drawn with the 2D canvas at the screen's own resolution (up to 2560 px
 * wide), so vector shapes and type stay sharp on a projector. Subclasses draw
 * a frame in `draw`; everything they draw must come from the clock, the beat
 * and the lyrics feed, so the preview and the output show the same frame.
 */
export abstract class CanvasLook extends ShaderGenerator {
  protected readonly canvas: HTMLCanvasElement;
  protected readonly g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;

  constructor(private readonly maxWidth = 2560) {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 9;
    const tex = CanvasLook.texture(canvas);
    super(FRAG, { uTex: { value: tex } });
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.tex = tex;
  }

  private static texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }

  update(ctx: GenContext): void {
    super.update(ctx);
    const k = Math.min(1, this.maxWidth / Math.max(1, ctx.width));
    const W = Math.max(320, Math.round(ctx.width * k));
    const H = Math.max(180, Math.round(ctx.height * k));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
      // A texture can't change size in place: start a new one.
      this.tex.dispose();
      this.tex = CanvasLook.texture(this.canvas);
      this.u.uTex.value = this.tex;
      this.resized(W, H);
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    // As a lyric style over another look: only the words, on a clear canvas.
    if (ctx.params.overlay === true) g.clearRect(0, 0, W, H);
    this.draw(g, W, H, ctx);
    this.tex.needsUpdate = true;
  }

  /** The canvas changed size (rebuild cached art). */
  protected resized(_w: number, _h: number): void {}

  protected abstract draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void;

  dispose(): void {
    this.tex.dispose();
    super.dispose();
  }
}

/** A palette colour (linear 0..1 from ctx.palette) as a CSS colour, with optional mix to white/black. */
export function paletteCss(pal: Float32Array, i: number, lighten = 0, alpha = 1): string {
  const ch = (v: number): number => {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
    const l = lighten >= 0 ? s + (1 - s) * lighten : s * (1 + lighten);
    return Math.round(Math.min(1, Math.max(0, l)) * 255);
  };
  const o = (i % 5) * 3;
  return `rgba(${ch(pal[o])},${ch(pal[o + 1])},${ch(pal[o + 2])},${alpha})`;
}
