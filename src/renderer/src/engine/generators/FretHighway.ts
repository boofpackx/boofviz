import { catsAt, chartNote, DIFFICULTIES, eventsAt, judge, medianPitch, writeNote, type ChartNote, type ChartOptions, type Difficulty, type NoteResult } from '../fretChart';
import { wordStream } from '../wordStream';
import { CanvasLook } from './CanvasLook';
import {
  boardTexture,
  BOARD_H,
  BOARD_W,
  chromePanel,
  flameSprite,
  FONT_HUD,
  FONT_SECTION,
  fretSprite,
  gemSprite,
  GEM_CX,
  GEM_CY,
  GEM_H,
  GEM_RX,
  GEM_W,
  glowSprite,
  hash,
  LANE_COLORS,
  outlinedText,
  POWER,
} from './fretArt';
import { createVenue, type Venue } from './fretVenues';
import type { GenContext } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Fret Highway: the mid-2000s guitar game, played by the music. A five-lane
 * neck runs into the venue, gems ride down it and reach the frets on the beat
 * they're played, bursting into flame; held notes are sustains that wobble,
 * star phrases fill the star power meter and the drop sets it off (blue
 * notes, double score). Score, streak lights, the multiplier and the rock
 * meter sit at the sides, and section names come up as the song moves on.
 *
 * The audio only arrives as it plays, so the gems on their way are the
 * prediction of the chart written from the bars just heard (fretChart.ts);
 * the music says at the frets whether each one was right. With the console
 * finish it's drawn at 480 lines and scaled up, soft like the console.
 */

const LANES = 5;
const CONSOLE_LINES = 480;
const STREAK_STEP = 10;

interface LiveNote {
  note: ChartNote;
  result: NoteResult;
  /** Beat it was judged (the burst waits for the gem to reach the frets). */
  judgedBeat: number;
  /** Its flames have been lit. */
  burst: boolean;
}

interface Burst {
  lane: number;
  /** Clock time it began (s). */
  at: number;
  big: boolean;
  seed: number;
}

interface Popup {
  text: string;
  at: number;
  color: string;
}

/** What the highway did lately (read by the capture script through the debug hook). */
export const fretStats = { shown: 0, hits: 0, misses: 0, live: 0, streak: 0, score: 0, star: 0, power: false, section: '' };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * The gig so far: score, streak, star power and sections, shared by every fret
 * highway in this window, so a change of venue mid-song keeps the scoreboard
 * (and two highways crossfading never count a note twice).
 */
const gig = {
  score: 0,
  streak: 0,
  rock: 0.62,
  starMeter: 0,
  powerUntil: -1,
  starPhrases: new Map<number, { hits: number; failed: boolean; counted: boolean }>(),
  section: { name: '', at: -100 },
  sectionCounts: new Map<string, number>(),
  lastSectionBase: '',
  lastPhrase: Number.NaN,
  popups: [] as Popup[],
  /** Slots already scored. */
  scored: new Set<number>(),
  /** Clock time a highway last drew (s). */
  at: -1e9,
};

function resetGig(): void {
  gig.score = 0;
  gig.streak = 0;
  gig.rock = 0.62;
  gig.starMeter = 0;
  gig.powerUntil = -1;
  gig.starPhrases.clear();
  gig.section = { name: '', at: -100 };
  gig.sectionCounts.clear();
  gig.lastSectionBase = '';
  gig.lastPhrase = Number.NaN;
  gig.popups = [];
  gig.scored.clear();
}

export class FretHighway extends CanvasLook {
  readonly kind = 'fretHighway';

  private readonly notes = new Map<number, LiveNote>();
  private readonly empty = new Set<number>();
  private readonly liveDone = new Set<number>();
  private bursts: Burst[] = [];
  private shownScore = gig.score;
  private rockShown = gig.rock;
  private powerGlow = 0;
  private lastGridValid = 0;

  private venue: Venue | null = null;
  private venueKind = '';
  private board: HTMLCanvasElement | null = null;
  private lo: HTMLCanvasElement | null = null;
  private loG: CanvasRenderingContext2D | null = null;
  private art: {
    gems: HTMLCanvasElement[];
    stars: HTMLCanvasElement[];
    power: HTMLCanvasElement;
    powerStar: HTMLCanvasElement;
    frets: HTMLCanvasElement[];
    pressed: HTMLCanvasElement[];
    flame: HTMLCanvasElement;
    glows: HTMLCanvasElement[];
    white: HTMLCanvasElement;
    blue: HTMLCanvasElement;
  } | null = null;

  private sprites() {
    this.art ??= {
      gems: LANE_COLORS.map((c) => gemSprite(c, false)),
      stars: LANE_COLORS.map((c) => gemSprite(c, true)),
      power: gemSprite(POWER, false),
      powerStar: gemSprite(POWER, true),
      frets: LANE_COLORS.map((c) => fretSprite(c, false)),
      pressed: LANE_COLORS.map((c) => fretSprite(c, true)),
      flame: flameSprite(),
      glows: ['rgba(80,255,110,1)', 'rgba(255,80,80,1)', 'rgba(255,240,90,1)', 'rgba(90,150,255,1)', 'rgba(255,160,50,1)'].map((c) => glowSprite(c)),
      white: glowSprite('rgba(255,255,240,1)'),
      blue: glowSprite('rgba(110,200,255,1)'),
    };
    return this.art;
  }

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const kind = String(ctx.params.venue ?? 'garage');
    if (kind !== this.venueKind || !this.venue) {
      this.venueKind = kind;
      this.venue = createVenue(kind);
      this.board = boardTexture(kind);
    }
    // The console finish: everything at 480 lines, then scaled up soft.
    const consoleLook = ctx.params.finish !== 'clean' && H > CONSOLE_LINES;
    if (!consoleLook) {
      this.frame(g, W, H, ctx);
      return;
    }
    const lh = CONSOLE_LINES;
    const lw = Math.round((lh * W) / H);
    if (!this.lo || this.lo.width !== lw || this.lo.height !== lh) {
      this.lo = document.createElement('canvas');
      this.lo.width = lw;
      this.lo.height = lh;
      this.loG = this.lo.getContext('2d')!;
    }
    const lg = this.loG!;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'source-over';
    this.frame(lg, lw, lh, ctx);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'medium';
    g.drawImage(this.lo, 0, 0, W, H);
    // Interlaced fields: every other line a touch darker, alternating each frame.
    const field = Math.floor(ctx.time * 60) & 1;
    const line = H / lh;
    g.fillStyle = 'rgba(0,0,0,0.085)';
    g.beginPath();
    for (let y = field; y < lh; y += 2) g.rect(0, y * line, W, line * 0.55);
    g.fill();
  }

  private frame(g: CanvasRenderingContext2D, w: number, h: number, ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const grid = f.grid;
    const art = this.sprites();
    const react = num(p.react, 1);
    const difficulty = (DIFFICULTIES as readonly string[]).includes(String(p.difficulty)) ? (p.difficulty as Difficulty) : 'hard';
    const speed = clamp(num(p.speed, 1), 0.5, 2);
    const visBeats = 3.5 / speed;
    const lookahead = Math.ceil(visBeats * 4);
    const beat = f.beat;
    const x = beat * 4;
    const spb = 60 / Math.max(40, f.bpm);
    const now = ctx.time;
    const o: ChartOptions = {
      difficulty,
      barSlots: f.beatsPerBar * 4,
      phraseSlots: f.beatsPerPhrase * 4,
      // Fixed references (offsets in the cycle), so phrase numbers count up through the song.
      barStart: mod(Math.round((beat - f.barPhase * f.beatsPerBar) * 4), f.beatsPerBar * 4),
      phraseStart: mod(Math.round((beat - f.phrasePhase * f.beatsPerPhrase) * 4), f.beatsPerPhrase * 4),
    };
    const locked = f.bpmConfidence >= 0.35 && !f.silence;

    // A new song (the grid started over), or no highway on screen for a while: a fresh scoreboard.
    if (grid.valid < this.lastGridValid - 8 || now - gig.at > 15 || now < gig.at - 1) this.resetScore();
    this.lastGridValid = grid.valid;
    gig.at = now;

    // ---- The chart: notes come into view at the far end, are judged at the frets ----
    if (locked) {
      for (let s = Math.ceil(x - 1); s <= Math.floor(x + lookahead); s++) {
        if (this.notes.has(s) || this.empty.has(s)) continue;
        const n = chartNote(grid, s, lookahead, o);
        if (n) {
          this.notes.set(s, { note: n, result: 'pending', judgedBeat: 0, burst: false });
          fretStats.shown++;
        } else this.empty.add(s);
      }
    }
    const power = beat < gig.powerUntil;
    for (const [s, ln] of this.notes) {
      if (s < x - 24) {
        this.notes.delete(s);
        continue;
      }
      if (ln.result !== 'pending') continue;
      const r = judge(grid, ln.note);
      if (r === 'pending') continue;
      ln.result = r;
      ln.judgedBeat = beat;
      if (gig.scored.has(s)) continue;
      gig.scored.add(s);
      this.scoreNote(ln, r, now, power, o);
    }
    for (const s of gig.scored) if (s < x - 64) gig.scored.delete(s);
    for (const s of this.empty) if (s < x - 24) this.empty.delete(s);
    for (const s of this.liveDone) if (s < x - 24) this.liveDone.delete(s);

    // Onsets the chart didn't see coming still light their fret.
    if (locked) {
      for (let s = Math.floor(x) - 1; s <= Math.floor(x); s++) {
        if (this.liveDone.has(s) || !catsAt(grid, s)) continue;
        this.liveDone.add(s);
        if (this.notes.has(s) || this.notes.has(s - 1) || this.notes.has(s + 1)) continue;
        const w0 = writeNote(eventsAt(grid, s), s, { ...o, difficulty: 'expert' }, medianPitch(grid, s - 1, o.barSlots));
        if (!w0) continue;
        for (let l = 0; l < LANES; l++) if (w0.lanes & (1 << l)) this.bursts.push({ lane: l, at: now, big: false, seed: s * 7 + l });
        fretStats.live++;
      }
    }

    // ---- Star power: the drop (or a big phrase start, or a sung chorus) sets it off ----
    const phrase = Math.floor((x - o.phraseStart) / o.phraseSlots);
    const phraseStartNow = phrase !== gig.lastPhrase;
    let chorusStart = false;
    if (phraseStartNow) {
      gig.lastPhrase = phrase;
      chorusStart = this.nameSection(ctx, grid.valid, o, x);
    }
    if (!power && gig.starMeter >= 0.5 && (f.drop || chorusStart || (phraseStartNow && ctx.env.energy > 0.72))) {
      gig.powerUntil = beat + gig.starMeter * 32;
      gig.popups.push({ text: 'STAR POWER!', at: now, color: '#8fdcff' });
    }
    if (power) gig.starMeter = clamp((gig.powerUntil - beat) / 32, 0, 1);
    else if (gig.powerUntil > 0 && beat >= gig.powerUntil) {
      gig.powerUntil = -1;
      gig.starMeter = 0;
    }
    this.powerGlow += ((power ? 1 : 0) - this.powerGlow) * Math.min(1, ctx.dt * 4);

    // ---- The venue ----
    this.venue!.draw(g, w, h, {
      t: now,
      beat,
      spb,
      kick: ctx.env.kick * react,
      snare: ctx.env.snare * react,
      bass: ctx.env.bass,
      mids: ctx.env.mids,
      highs: ctx.env.highs,
      energy: ctx.env.energy,
      drop: ctx.env.drop,
      power: this.powerGlow,
      stage: num(p.stage, 1),
      bands: f.bands32,
      rock: this.rockShown,
    });

    // ---- The neck ----
    const cx = w / 2;
    const yN = h * 0.885;
    const wN = h * 0.7;
    const k = 1.38;
    const yV = h * 0.1005;
    const sAt = (z: number): number => 1 / (1 + z * k);
    const yAt = (z: number): number => yV + (yN - yV) * sAt(z);
    const zAtY = (y: number): number => (1 / ((y - yV) / (yN - yV)) - 1) / k;
    const laneW = wN * 0.188;
    const laneX = (i: number, z: number): number => cx + (i - 2) * laneW * sAt(z);
    const zOf = (slot: number): number => (slot / 4 - beat) / visBeats;

    // Board surface, scrolling down the neck with the song.
    const yTop = yAt(1.06);
    const strip = Math.max(1, Math.round(h / 180));
    const board = this.board!;
    g.imageSmoothingEnabled = true;
    for (let y = Math.floor(yTop); y < h; y += strip) {
      const z = zAtY(y + strip / 2);
      const half = wN * 0.5 * sAt(z);
      const songBeat = beat + z * visBeats;
      const v = Math.floor(mod(-songBeat * (BOARD_H / 2), BOARD_H));
      g.globalAlpha = z > 0.72 ? clamp(1 - (z - 0.72) / 0.34, 0, 1) : 1;
      g.drawImage(board, 0, v, BOARD_W, 1, cx - half, y, half * 2, strip + 0.6);
    }
    g.globalAlpha = 1;
    // Star power: the neck lights up blue.
    if (this.powerGlow > 0.01) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.28 * this.powerGlow;
      const grd = g.createLinearGradient(0, yTop, 0, h);
      grd.addColorStop(0, 'rgba(60,160,255,0)');
      grd.addColorStop(1, 'rgba(60,160,255,1)');
      g.fillStyle = grd;
      this.boardPath(g, cx, wN, sAt, yAt, -0.15, 1.02);
      g.fill();
      g.restore();
    }

    // Beat lines across the neck; the bar line heavier.
    for (let b = Math.ceil(beat - 0.5); b <= beat + visBeats + 0.01; b++) {
      const z = (b - beat) / visBeats;
      if (z < -0.13 || z > 1.02) continue;
      const s = sAt(z);
      const y = yAt(z);
      const half = wN * 0.5 * s;
      const bar = mod(b * 4 - o.barStart, o.barSlots) === 0;
      g.globalAlpha = clamp((1.02 - z) / 0.3, 0, 1) * (bar ? 0.85 : 0.45);
      g.fillStyle = this.powerGlow > 0.5 ? '#bfe8ff' : '#f2f2ff';
      const th = Math.max(1, h * (bar ? 0.0085 : 0.0042) * s);
      g.fillRect(cx - half, y - th / 2, half * 2, th);
    }
    g.globalAlpha = 1;
    // Strings down the middle of each lane.
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = Math.max(1, h / 480);
    for (let i = 0; i < LANES; i++) {
      g.beginPath();
      g.moveTo(laneX(i, 0), yN);
      g.lineTo(laneX(i, 0.95), yAt(0.95));
      g.stroke();
    }
    // Chrome rails down both edges.
    for (const side of [-1, 1]) {
      const rail = g.createLinearGradient(0, yTop, 0, h);
      const tint = this.powerGlow > 0.5 ? '170,225,255' : '236,236,246';
      rail.addColorStop(0, `rgba(${tint},0)`);
      rail.addColorStop(0.25, `rgba(${tint},0.75)`);
      rail.addColorStop(1, `rgba(${tint},1)`);
      g.fillStyle = rail;
      const zs = [-0.15, 1.04];
      const t0 = h * 0.011;
      g.beginPath();
      zs.forEach((z, i) => {
        const half = wN * 0.5 * sAt(z);
        const pt = cx + side * half;
        if (i) g.lineTo(pt, yAt(z));
        else g.moveTo(pt, yAt(z));
      });
      for (let i = zs.length - 1; i >= 0; i--) {
        const z = zs[i];
        const half = wN * 0.5 * sAt(z) - t0 * sAt(z);
        g.lineTo(cx + side * half, yAt(z));
      }
      g.closePath();
      g.fill();
      if (this.powerGlow > 0.02) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.5 * this.powerGlow * (0.75 + 0.25 * Math.sin(now * 9));
        for (let z = 0; z < 1; z += 0.1) {
          const sz = laneW * 1.3 * sAt(z);
          g.drawImage(art.blue, cx + side * wN * 0.5 * sAt(z) - sz / 2, yAt(z) - sz / 2, sz, sz);
        }
        g.restore();
      }
    }

    // ---- Sustains, frets, gems ----
    const scaleAt = (z: number): number => ((laneW * 0.5) / GEM_RX) * 0.94 * sAt(z);
    const shown: Array<{ ln: LiveNote; z: number }> = [];
    const flameAt = (ln: LiveNote): number => Math.max(ln.judgedBeat, ln.note.slot / 4 - 0.12);
    for (const ln of this.notes.values()) {
      const z = zOf(ln.note.slot);
      if (z > 1.03 || z < -0.16) continue;
      if (ln.result === 'hit' && beat >= flameAt(ln)) continue;
      shown.push({ ln, z });
    }
    shown.sort((a, b) => b.z - a.z);
    const held = new Array<boolean>(LANES).fill(false);
    // Sustain tails, behind everything else on the neck.
    for (const ln of this.notes.values()) {
      const n = ln.note;
      if (!n.hold) continue;
      const endSlot = Math.min(n.slot + n.hold, this.nextInLane(n) - 1);
      let z0 = zOf(n.slot);
      const z1 = Math.min(1, zOf(endSlot));
      if (z1 <= 0 || z0 > 1) continue;
      const holding = ln.result === 'hit' && beat >= flameAt(ln);
      if (holding) z0 = 0;
      if (z1 <= z0) continue;
      for (let l = 0; l < LANES; l++) {
        if (!(n.lanes & (1 << l))) continue;
        if (holding) held[l] = true;
        const col = power ? POWER : LANE_COLORS[l];
        this.tail(g, l, z0, z1, laneX, yAt, sAt, laneW, now, holding ? 1 : ln.result === 'miss' ? -1 : 0, col, ctx.env.mids * react);
      }
    }
    // The frets.
    const recent = new Array<number>(LANES).fill(0);
    for (const b of this.bursts) recent[b.lane] = Math.max(recent[b.lane], 1 - (now - b.at) / 0.12);
    for (let i = 0; i < LANES; i++) {
      const sc = scaleAt(0) * 1.05;
      const down = held[i] || recent[i] > 0;
      const spr = down ? art.pressed[i] : art.frets[i];
      g.drawImage(spr, laneX(i, 0) - GEM_CX * sc, yN - GEM_CY * sc + (down ? h * 0.003 : 0), GEM_W * sc, GEM_H * sc);
    }
    // Gems, far to near.
    for (const { ln, z } of shown) {
      const n = ln.note;
      const phraseKey = Math.floor((n.slot - o.phraseStart) / o.phraseSlots);
      const star = n.star && !gig.starPhrases.get(phraseKey)?.failed;
      let alpha = clamp((1.03 - z) / 0.16, 0, 1);
      if (z < 0) alpha *= ln.result === 'miss' ? clamp(1 + z / 0.09, 0, 1) : 1;
      if (alpha <= 0) continue;
      g.globalAlpha = alpha;
      const sc = scaleAt(z);
      for (let l = 0; l < LANES; l++) {
        if (!(n.lanes & (1 << l))) continue;
        const spr = power ? (star ? art.powerStar : art.power) : star ? art.stars[l] : art.gems[l];
        g.drawImage(spr, laneX(l, z) - GEM_CX * sc, yAt(z) - GEM_CY * sc, GEM_W * sc, GEM_H * sc);
      }
    }
    g.globalAlpha = 1;

    // ---- Fire at the frets ----
    for (const ln of this.notes.values()) {
      if (ln.result !== 'hit' || ln.burst || beat < flameAt(ln)) continue;
      ln.burst = true;
      for (let l = 0; l < LANES; l++) if (ln.note.lanes & (1 << l)) this.bursts.push({ lane: l, at: now, big: true, seed: ln.note.slot * 5 + l });
    }
    this.bursts = this.bursts.filter((b) => now >= b.at - 0.1 && now - b.at < (b.big ? 0.42 : 0.2));
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of this.bursts) this.fire(g, b, laneX(b.lane, 0), yN, laneW, now, power);
    for (let l = 0; l < LANES; l++) {
      if (!held[l]) continue;
      // A held note keeps burning while it sustains.
      this.fire(g, { lane: l, at: now - 0.06 - 0.05 * Math.sin(now * 37 + l), big: true, seed: Math.floor(now * 20) * 9 + l }, laneX(l, 0), yN, laneW, now, power);
    }
    g.restore();

    // ---- HUD ----
    if (p.hud !== false) this.hud(g, h, cx, wN, now, power, ctx.dt);
    if (p.sections !== false) this.sectionTitle(g, w, h, now);
    this.drawPopups(g, cx, h, now);

    fretStats.streak = gig.streak;
    fretStats.score = gig.score;
    fretStats.star = gig.starMeter;
    fretStats.power = power;
    fretStats.section = gig.section.name;
  }

  private boardPath(g: CanvasRenderingContext2D, cx: number, wN: number, sAt: (z: number) => number, yAt: (z: number) => number, z0: number, z1: number): void {
    g.beginPath();
    g.moveTo(cx - wN * 0.5 * sAt(z0), yAt(z0));
    g.lineTo(cx - wN * 0.5 * sAt(z1), yAt(z1));
    g.lineTo(cx + wN * 0.5 * sAt(z1), yAt(z1));
    g.lineTo(cx + wN * 0.5 * sAt(z0), yAt(z0));
    g.closePath();
  }

  /** The slot of the next note sharing a lane with n (Infinity: none in view). */
  private nextInLane(n: ChartNote): number {
    let next = Infinity;
    for (const [s, ln] of this.notes) if (s > n.slot && s < next && ln.note.lanes & n.lanes) next = s;
    return next;
  }

  private tail(
    g: CanvasRenderingContext2D,
    lane: number,
    z0: number,
    z1: number,
    laneX: (i: number, z: number) => number,
    yAt: (z: number) => number,
    sAt: (z: number) => number,
    laneW: number,
    now: number,
    state: number,
    col: [string, string, string],
    whammy: number,
  ): void {
    const N = 26;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (let i = 0; i <= N; i++) {
      const z = z0 + ((z1 - z0) * i) / N;
      const s = sAt(z);
      const wob = state > 0 ? Math.sin(z * 34 - now * 16) * laneW * (0.035 + 0.06 * whammy) * s : 0;
      const half = laneW * 0.085 * s;
      const xc = laneX(lane, z) + wob;
      left.push([xc - half, yAt(z)]);
      right.push([xc + half, yAt(z)]);
    }
    g.save();
    g.globalAlpha = state < 0 ? 0.35 : clamp((1.02 - z1) / 0.12, 0.25, 1);
    g.beginPath();
    left.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
    g.fillStyle = state < 0 ? '#5a5a66' : col[1];
    g.fill();
    g.lineWidth = Math.max(1, laneW * 0.02);
    g.strokeStyle = state > 0 ? '#ffffff' : col[2];
    g.stroke();
    if (state > 0) {
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = col[0];
      g.lineWidth = Math.max(1, laneW * 0.05);
      g.beginPath();
      left.forEach(([px, py], i) => {
        const xm = (px + right[i][0]) / 2;
        if (i) g.lineTo(xm, py);
        else g.moveTo(xm, py);
      });
      g.stroke();
    }
    g.restore();
  }

  private fire(g: CanvasRenderingContext2D, b: Burst, x: number, y: number, laneW: number, now: number, power: boolean): void {
    const art = this.art!;
    const dur = b.big ? 0.42 : 0.2;
    const age = clamp((now - b.at) / dur, 0, 1);
    const fade = Math.pow(1 - age, 0.8);
    // A flash of the lane's colour around the fret.
    const gl = laneW * (b.big ? 2.0 : 1.3) * (0.8 + 0.4 * (1 - age));
    g.globalAlpha = fade * (b.big ? 0.75 : 0.55);
    g.drawImage(power ? art.blue : art.glows[b.lane], x - gl / 2, y - gl / 2, gl, gl * 0.7);
    if (b.big) {
      // The flame: a tall tongue and two licks beside it.
      const fw = laneW * 1.3;
      const fh = fw * 2.3 * (0.65 + 0.55 * Math.sin(Math.min(1, age * 3) * Math.PI * 0.5)) * (1 - age * 0.35);
      const lean = (hash(b.seed) - 0.5) * laneW * 0.3;
      g.globalAlpha = fade;
      g.drawImage(art.flame, x - fw / 2 + lean * age, y - fh * 0.88, fw, fh);
      g.globalAlpha = fade * 0.75;
      for (const side of [-1, 1]) {
        const lw = fw * 0.6;
        const lh = fh * (0.45 + 0.2 * hash(b.seed + side));
        g.drawImage(art.flame, x + side * fw * 0.28 - lw / 2, y - lh * 0.85, lw, lh);
      }
      g.globalAlpha = fade * 0.9;
      const core = laneW * 0.9;
      g.drawImage(art.white, x - core / 2, y - core * 0.35, core, core * 0.6);
    }
    // Sparks thrown up and out.
    const n = b.big ? 9 : 4;
    const t = (now - b.at) * (b.big ? 1 : 1.4);
    g.globalAlpha = fade;
    g.fillStyle = power ? '#cfefff' : '#ffe9a0';
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (hash(b.seed * 31 + i) - 0.5) * 2.2;
      const v = laneW * (3.5 + hash(b.seed * 17 + i) * 4.5);
      const px = x + Math.cos(a) * v * t;
      const py = y + Math.sin(a) * v * t + laneW * 9 * t * t;
      const sz = Math.max(1, laneW * 0.05 * (1 - age));
      g.fillRect(px - sz / 2, py - sz / 2, sz, sz * 1.6);
    }
    g.globalAlpha = 1;
  }

  private scoreNote(ln: LiveNote, r: NoteResult, now: number, power: boolean, o: ChartOptions): void {
    const n = ln.note;
    const phraseKey = Math.floor((n.slot - o.phraseStart) / o.phraseSlots);
    if (r === 'hit') {
      gig.streak++;
      const mult = Math.min(4, 1 + Math.floor(gig.streak / STREAK_STEP)) * (power ? 2 : 1);
      let gems = 0;
      for (let l = 0; l < LANES; l++) if (n.lanes & (1 << l)) gems++;
      gig.score += 50 * gems * mult + n.hold * 25 * mult;
      gig.rock = clamp(gig.rock + 0.025, 0.05, 1);
      fretStats.hits++;
      if (gig.streak % 50 === 0) gig.popups.push({ text: `${gig.streak} NOTE STREAK!`, at: now, color: '#ffffff' });
      if (n.star) {
        const sp = gig.starPhrases.get(phraseKey) ?? { hits: 0, failed: false, counted: false };
        sp.hits++;
        gig.starPhrases.set(phraseKey, sp);
      }
    } else {
      gig.streak = 0;
      gig.rock = clamp(gig.rock - 0.07, 0.05, 1);
      fretStats.misses++;
      if (n.star) {
        const sp = gig.starPhrases.get(phraseKey) ?? { hits: 0, failed: false, counted: false };
        sp.failed = true;
        gig.starPhrases.set(phraseKey, sp);
      }
    }
    // A star phrase played all the way through fills a quarter of the meter.
    for (const [key, sp] of gig.starPhrases) {
      const end = o.phraseStart + (key + 1) * o.phraseSlots;
      if (sp.counted || n.slot < end) continue;
      sp.counted = true;
      if (!sp.failed && sp.hits > 0) {
        const before = gig.starMeter;
        gig.starMeter = clamp(gig.starMeter + 0.25, 0, 1);
        if (before < 0.5 && gig.starMeter >= 0.5 && !power) gig.popups.push({ text: 'STAR POWER READY', at: now, color: '#8fdcff' });
      }
    }
    for (const key of gig.starPhrases.keys()) if (key < Math.floor((n.slot - o.phraseStart) / o.phraseSlots) - 4) gig.starPhrases.delete(key);
  }

  private resetScore(): void {
    resetGig();
    this.shownScore = 0;
    this.notes.clear();
    this.empty.clear();
    this.bursts = [];
  }

  /** Name the section a new phrase starts (true when it's a chorus starting). */
  private nameSection(ctx: GenContext, valid: number, o: ChartOptions, x: number): boolean {
    let base: string;
    const ws = wordStream(ctx, 0, 1);
    const line = ws.current >= 0 ? ws.lines[ws.current] : null;
    if (ws.synced && line) base = line.chorus ? 'CHORUS' : 'VERSE';
    else if (valid < o.phraseSlots) base = 'INTRO';
    else {
      let kicks = 0;
      for (let s = Math.floor(x) - o.phraseSlots; s < Math.floor(x); s++) if (catsAt(ctx.frame.grid, s) & 1) kicks++;
      base = kicks < 2 ? 'BREAKDOWN' : ctx.env.energy > 0.62 ? 'CHORUS' : 'VERSE';
    }
    if (base === gig.lastSectionBase) return false;
    gig.lastSectionBase = base;
    const count = (gig.sectionCounts.get(base) ?? 0) + 1;
    gig.sectionCounts.set(base, count);
    gig.section = { name: base === 'VERSE' || base === 'CHORUS' ? `${base} ${count}` : base, at: ctx.time };
    return base === 'CHORUS';
  }

  private sectionTitle(g: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    const age = now - gig.section.at;
    if (!gig.section.name || age > 5) return;
    const a = clamp(age / 0.25, 0, 1) * clamp((5 - age) / 0.8, 0, 1);
    g.save();
    g.globalAlpha = a;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = h * 0.062;
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = size * 0.25;
    g.shadowOffsetY = size * 0.06;
    outlinedText(g, gig.section.name, w / 2, h * 0.085, size, FONT_SECTION, '#f4f4ee', 'rgba(20,16,12,0.85)', 0.1);
    g.restore();
  }

  private drawPopups(g: CanvasRenderingContext2D, cx: number, h: number, now: number): void {
    gig.popups = gig.popups.filter((pp) => now >= pp.at && now - pp.at < 1.8);
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    gig.popups.forEach((pp, i) => {
      const age = now - pp.at;
      const pop = age < 0.18 ? 0.6 + 0.6 * (age / 0.18) : 1.2 - 0.2 * Math.min(1, (age - 0.18) / 0.2);
      g.globalAlpha = clamp((1.8 - age) / 0.4, 0, 1);
      const size = h * 0.058 * pop;
      const grad = g.createLinearGradient(0, h * 0.33 - size / 2, 0, h * 0.33 + size / 2);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.55, pp.color);
      grad.addColorStop(1, pp.color === '#ffffff' ? '#ffb020' : '#2a7cff');
      outlinedText(g, pp.text, cx, h * (0.34 + i * 0.075), size, FONT_HUD, grad, pp.color === '#ffffff' ? 'rgba(40,0,0,0.92)' : 'rgba(0,8,40,0.95)', 0.24);
    });
    g.restore();
  }

  private hud(g: CanvasRenderingContext2D, h: number, cx: number, wN: number, now: number, power: boolean, dt: number): void {
    this.shownScore += (gig.score - this.shownScore) * Math.min(1, dt * 8);
    if (Math.abs(gig.score - this.shownScore) < 1) this.shownScore = gig.score;
    this.rockShown += (gig.rock - this.rockShown) * Math.min(1, dt * 3);
    const u = h / 480;
    g.save();
    g.textBaseline = 'middle';

    // ---- Left: the score, the streak lights and the multiplier ----
    const pw = 108 * u;
    const px = cx - wN * 0.5 - pw - 22 * u;
    const py = h * 0.66;
    chromePanel(g, px, py, pw, 34 * u, 7 * u);
    g.textAlign = 'right';
    outlinedText(g, Math.round(this.shownScore).toLocaleString('en-US'), px + pw - 10 * u, py + 18 * u, 17 * u, FONT_HUD, '#ffffff', 'rgba(0,0,0,0.9)', 0.12);
    // The multiplier plate, tilted like a stomp box.
    const my = py + 44 * u;
    g.save();
    g.translate(px + pw / 2, my + 40 * u);
    g.rotate(-0.06);
    chromePanel(g, -pw / 2, -40 * u, pw, 80 * u, 9 * u, '#1c0d38');
    const mult = Math.min(4, 1 + Math.floor(gig.streak / STREAK_STEP));
    const lit = mult >= 4 ? STREAK_STEP : gig.streak % STREAK_STEP;
    const multCol = power ? '#5cc8ff' : ['#8a8a96', '#ff8a1a', '#3ee05a', '#b25cff'][mult - 1];
    for (let i = 0; i < STREAK_STEP; i++) {
      const bx = -pw / 2 + 12 * u + i * ((pw - 24 * u) / (STREAK_STEP - 1));
      const on = i < lit;
      g.fillStyle = on ? multCol : '#2a2238';
      g.beginPath();
      g.arc(bx, -26 * u, 4 * u, 0, Math.PI * 2);
      g.fill();
      if (on) {
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.arc(bx - 1.2 * u, -27.4 * u, 1.5 * u, 0, Math.PI * 2);
        g.fill();
      }
    }
    // The number in its square.
    const sq = 40 * u;
    const sqx = -sq / 2;
    const sqy = -12 * u;
    const face = g.createLinearGradient(0, sqy, 0, sqy + sq);
    face.addColorStop(0, multCol);
    face.addColorStop(1, '#14082a');
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.roundRect(sqx - 2 * u, sqy - 2 * u, sq + 4 * u, sq + 4 * u, 5 * u);
    g.fill();
    g.fillStyle = face;
    g.beginPath();
    g.roundRect(sqx, sqy, sq, sq, 4 * u);
    g.fill();
    g.textAlign = 'center';
    outlinedText(g, power ? `x${mult * 2}` : mult > 1 ? `x${mult}` : `${mult}`, 0, sqy + sq * 0.54, (power || mult > 1 ? 21 : 28) * u, FONT_HUD, '#ffffff', 'rgba(0,0,0,0.9)', 0.16);
    g.restore();

    // ---- Right: the rock meter and the star power gauge ----
    const rw = 118 * u;
    const rx = cx + wN * 0.5 + 22 * u;
    const ry = h * 0.66;
    chromePanel(g, rx, ry, rw, 92 * u, 10 * u, '#101418');
    const mcx = rx + rw / 2;
    const mcy = ry + 62 * u;
    const R = 44 * u;
    const a0 = Math.PI * 1.08;
    const a1 = Math.PI * 1.92;
    const zones: Array<[number, number, string]> = [
      [0, 0.33, '#e8262c'],
      [0.33, 0.66, '#f6d41c'],
      [0.66, 1, '#2ad848'],
    ];
    g.lineWidth = 13 * u;
    for (const [z0, z1, c] of zones) {
      g.strokeStyle = c;
      g.globalAlpha = 0.95;
      g.beginPath();
      g.arc(mcx, mcy, R - 7 * u, a0 + (a1 - a0) * z0 + 0.02, a0 + (a1 - a0) * z1 - 0.02);
      g.stroke();
    }
    g.globalAlpha = 1;
    // Tick marks and the needle.
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 1.5 * u;
    for (let i = 0; i <= 12; i++) {
      const a = a0 + ((a1 - a0) * i) / 12;
      g.beginPath();
      g.moveTo(mcx + Math.cos(a) * (R - 13 * u), mcy + Math.sin(a) * (R - 13 * u));
      g.lineTo(mcx + Math.cos(a) * (R - 1 * u), mcy + Math.sin(a) * (R - 1 * u));
      g.stroke();
    }
    const jitter = Math.sin(now * 23) * 0.006;
    const na = a0 + (a1 - a0) * clamp(this.rockShown + jitter, 0, 1);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3 * u;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(mcx, mcy);
    g.lineTo(mcx + Math.cos(na) * (R - 4 * u), mcy + Math.sin(na) * (R - 4 * u));
    g.stroke();
    g.fillStyle = '#d8d8e0';
    g.beginPath();
    g.arc(mcx, mcy, 5 * u, 0, Math.PI * 2);
    g.fill();
    // ROCK, lit in the zone's colour.
    const zone = this.rockShown < 0.33 ? 0 : this.rockShown < 0.66 ? 1 : 2;
    g.textAlign = 'center';
    outlinedText(g, 'ROCK', mcx, ry + 80 * u, 17 * u, FONT_HUD, zones[zone][2], 'rgba(0,0,0,0.9)', 0.16);
    // The star power gauge: a glass tube that fills blue.
    const ty = ry + 98 * u;
    chromePanel(g, rx + 6 * u, ty, rw - 12 * u, 16 * u, 8 * u, '#060a12');
    const fillW = (rw - 22 * u) * gig.starMeter;
    if (fillW > 0) {
      const ready = gig.starMeter >= 0.5 && !power;
      const tube = g.createLinearGradient(0, ty + 3 * u, 0, ty + 13 * u);
      tube.addColorStop(0, '#e8f8ff');
      tube.addColorStop(0.5, '#3aa8ff');
      tube.addColorStop(1, '#0a4ab0');
      g.globalAlpha = ready ? 0.75 + 0.25 * Math.sin(now * 10) : 1;
      g.fillStyle = tube;
      g.beginPath();
      g.roundRect(rx + 11 * u, ty + 4 * u, fillW, 8 * u, 4 * u);
      g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  dispose(): void {
    this.venue?.dispose?.();
    super.dispose();
  }
}
