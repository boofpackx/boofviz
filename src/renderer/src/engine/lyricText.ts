import * as THREE from 'three';
import { lineIndexAt } from '@shared/lyrics';
import type { GenContext } from './generators/Generator';
import { fontCss } from './generators/KineticType';
import { heroWord } from './generators/lyricCinema';
import { timeWords, type TimedLine } from './generators/lyricVideoMotion';
import { currentLines, lyricsFeed, songPositionMs, songTitle } from './lyricsFeed';

export interface LyricMoment {
  /** The sung line with word timings. */
  current: TimedLine;
  /** Its index (lyric line, or own-text row counter). */
  index: number;
  /** Earlier lines, most recent first. */
  previous: string[];
  /** The next line, if known. */
  next: string;
  /** Song time now (seconds) on the same clock as the word timings. */
  now: number;
  /** Index of the hero word in the current line (−1: none). */
  hero: number;
}

/**
 * What a lyric look shows right now: the sung line from Spotify's synced
 * lyrics; with no line, the song's name; with no song, nothing. With
 * "Words from: text" it is the look's own text ("a / b / c"), a line every
 * few beats. Pure of the clock and the lyrics feed, so preview and output agree.
 */
export function lyricMoment(ctx: GenContext): LyricMoment {
  const p = ctx.params;
  const upper = p.uppercase !== false;
  const fix = (s: string): string => (upper ? s.toUpperCase() : s);
  const synced = String(p.source ?? 'lyrics') === 'lyrics' && lyricsFeed.now.connected ? currentLines() : null;
  if (synced?.length) {
    const posMs = songPositionMs(Date.now(), typeof p.lead === 'number' ? p.lead : 120);
    const i = lineIndexAt(synced, posMs);
    if (i >= 0) {
      const l = synced[i];
      const start = l.t / 1000;
      const current = timeWords(fix(l.text || '♪'), start, synced[i + 1] ? synced[i + 1].t / 1000 : start + 4, l.words);
      const previous: string[] = [];
      for (let k = i - 1; k >= Math.max(0, i - 8); k--) previous.push(fix(synced[k].text || '♪'));
      return { current, index: i, previous, next: fix(synced[i + 1]?.text ?? ''), now: posMs / 1000, hero: heroWord(current.text) };
    }
  }
  if (String(p.source ?? 'lyrics') !== 'text') {
    // A still line that has been there a while: looks show it whole, no line change.
    const now = ctx.time;
    const current = { ...timeWords(fix(songTitle()), now - 60, now - 59), end: now + 3600 };
    return { current, index: 0, previous: [], next: '', now, hero: current.text ? heroWord(current.text) : -1 };
  }
  const rows = String(p.text ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rows.length) {
    const current = { ...timeWords('', ctx.time - 60, ctx.time - 59), end: ctx.time + 3600 };
    return { current, index: 0, previous: [], next: '', now: ctx.time, hero: -1 };
  }
  const lineBeats = Math.max(1, typeof p.lineBeats === 'number' ? p.lineBeats : 8);
  const spb = 60 / Math.max(40, ctx.frame.bpm || 120);
  const idx = Math.floor(ctx.beat / lineBeats);
  const row = (k: number): string => fix(rows[((k % rows.length) + rows.length) % rows.length] || ' ');
  const start = idx * lineBeats * spb;
  const previous: string[] = [];
  for (let k = idx - 1; k >= idx - 8; k--) previous.push(row(k));
  const current = timeWords(row(idx), start, start + lineBeats * spb);
  return { current, index: idx, previous, next: row(idx + 1), now: ctx.beat * spb, hero: heroWord(current.text) };
}

/**
 * Text drawn white-on-black into a texture, for shaders that use words as a
 * shape (embossing, hidden pictures, constellations). Redrawn only when the
 * text changes.
 */
export class TextMask {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private key = '';

  constructor(w = 1024, h = 512) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  /** Draw up to `maxLines` wrapped lines, as large as fits. */
  draw(text: string, font = 'heavy', maxLines = 3, blur = 0): void {
    const key = `${text}|${font}|${maxLines}|${blur}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (!text.trim()) {
      this.texture.needsUpdate = true;
      return;
    }
    // Largest size whose wrapped lines fit.
    let px = H / 1.3;
    let lines: string[] = [text];
    for (; px > 12; px *= 0.9) {
      g.font = fontCss(font, px);
      lines = wrap(g, text, W * 0.92);
      // A single word longer than the box stays on one line: check widths too.
      if (lines.length <= maxLines && lines.length * px * 1.05 <= H * 0.9 && lines.every((l) => g.measureText(l).width <= W * 0.94)) break;
    }
    g.font = fontCss(font, px);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (blur > 0) g.filter = `blur(${blur}px)`;
    lines.slice(0, maxLines).forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (Math.min(lines.length, maxLines) - 1) / 2) * px * 1.05));
    g.filter = 'none';
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

function wrap(g: CanvasRenderingContext2D, t: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}
