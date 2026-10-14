import * as THREE from 'three';
import { GRID_EXPECTED, GRID_HORIZON, GRID_ROW, PARTS, type Part } from '@shared/types/audio';
import { FULLSCREEN_VERT } from '../shaders/common';
import { FullscreenPass } from '../three/fullscreen';
import { DIFFICULTIES, gridAt, heardAt, vocalLine, type ChartOptions, type Difficulty } from '../fretChart';
import { wordStream } from '../wordStream';
import { PartChart, type LiveNote } from './fret3d/chartState';
import { BOARD_LEN, FIRE_DEFAULT_TINT, Highway, KICK_RGB, LANE_RGB, PAD_RGB, POWER_RGB, type FireDraw, type GemDraw, type HighwayFrame, type TailDraw } from './fret3d/highway';
import { Hud } from './fret3d/hud';
import { createVenue } from './fret3d/venues';
import type { Venue, VenueFrame } from './fret3d/venueTypes';
import type { CompileTarget, GenContext, Generator } from './Generator';
import { num } from './ShaderGenerator';

/**
 * Fret Highway: the mid-2000s console guitar game in 3D, played by the
 * music. A venue with its band (who play along: the guitarist strums on the
 * guitar's notes, the drummer hits on the drums, the singer sings) and a
 * camera that cuts between them; in front, the five-lane neck the gems ride
 * down, reaching the frets on the beat they're played and bursting into
 * flame. Pick the part to play (guitar, bass, drums, or the whole band on
 * three highways): the notes come from that part of the song, tracked from
 * the mix in the analysis worker and charted ahead by the predictor (see
 * audio/band/). Star phrases fill star power, the drop sets it off.
 *
 * Finishes: PS2 (480 lines, scaled up soft, interlaced), PS3 (720p) or clean.
 */

const STREAK_STEP = 10;
/** Visible beats of highway at speed 1 (the expected rows reach GRID_HORIZON slots ahead). */
const VIS_BEATS = 3.6;

interface Burst {
  part: Part;
  lane: number;
  at: number;
  big: boolean;
  seed: number;
}

export interface Popup {
  text: string;
  at: number;
  kind: 'streak' | 'power' | 'ready';
}

/** What the highway did lately (read by the capture script through the debug hook). */
export const fretStats = { shown: 0, hits: 0, misses: 0, live: 0, streak: 0, score: 0, star: 0, power: false, section: '', part: 'guitar', methods: '' };

/**
 * The gig so far, shared by every fret highway in this window, so a change
 * of venue mid-song keeps the scoreboard (and two highways crossfading never
 * count a note twice).
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
  scored: new Set<string>(),
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

const FINISH_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSrcRes;
uniform int uMode;
uniform float uField;
in vec2 vUv;
out vec4 fragColor;
float bayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return float(m[i]) / 16.0 - 0.5;
}
void main() {
  vec4 c = texture(uSrc, vUv);
  if (uMode == 1) {
    // The PS2: interlaced fields (every other line a touch darker, alternating each frame)
    // and 16-bit colour, ordered-dithered.
    float line = floor(vUv.y * uSrcRes.y);
    c.rgb *= 1.0 - 0.09 * mod(line + uField, 2.0);
    vec3 g = pow(max(c.rgb, 0.0) / (1.0 + c.rgb), vec3(1.0 / 2.2));
    g = floor(g * 31.0 + 0.5 + bayer(vUv * uSrcRes) * 0.9) / 31.0;
    g = clamp(g, 0.0, 0.999);
    vec3 lin = pow(g, vec3(2.2));
    c.rgb = lin / max(1.0 - lin, 1e-3);
  }
  fragColor = vec4(c.rgb, 1.0);
}
`;

export class FretHighway implements Generator {
  readonly kind = 'fretHighway';

  private readonly hwScene = new THREE.Scene();
  private readonly hwCam = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 80);
  private readonly highways = new Map<Part, Highway>();
  private readonly charts = new Map<Part, PartChart>();
  private layout = '';
  private venue: Venue | null = null;
  private venueKind = '';
  private hud: Hud | null = null;
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly finish: FullscreenPass;
  private mode = 1;
  private field = 0;
  private bursts: Burst[] = [];
  private shownScore = gig.score;
  private rockShown = gig.rock;
  private powerGlow = 0;
  private lastGridValid = 0;
  private readonly lastNotes = { guitar: -1e9, bass: -1e9, drums: -1e9, snare: -1e9, kick: -1e9, hat: -1e9, crash: -1e9, vocals: -1e9 };
  private readonly pitchNow = { guitar: 0, bass: 0 };
  private readonly envPrev = { kick: 0, snare: 0, hat: 0 };
  private cueX = Number.NaN;

  constructor() {
    this.finish = new FullscreenPass(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: FINISH_FRAG,
        uniforms: { uSrc: { value: null }, uSrcRes: { value: new THREE.Vector2(1, 1) }, uMode: { value: 1 }, uField: { value: 0 } },
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  /** The parts on screen and how the highways are laid out. */
  private setLayout(part: string): Part[] {
    const parts: Part[] = part === 'band' ? ['guitar', 'drums', 'bass'] : PARTS.includes(part as Part) ? [part as Part] : ['guitar'];
    const key = parts.join(',');
    if (key === this.layout) return parts;
    this.layout = key;
    for (const h of this.highways.values()) {
      this.hwScene.remove(h.group);
      h.dispose();
    }
    this.highways.clear();
    parts.forEach((p, i) => {
      const h = new Highway(p === 'drums');
      if (parts.length > 1) {
        // The band: three narrower necks, the outer two turned in a little.
        const side = i - 1;
        h.group.position.set(side * 6.3, 0, side ? 0.6 : 0);
        h.group.rotation.y = -side * 0.08;
        h.group.scale.setScalar(1);
      }
      this.highways.set(p, h);
      this.hwScene.add(h.group);
      if (!this.charts.has(p)) this.charts.set(p, new PartChart(p));
    });
    if (parts.length > 1) {
      this.hwCam.position.set(0, 9.5, 11.5);
      this.hwCam.lookAt(0, 0, -8);
      this.hwCam.fov = 50;
    } else {
      this.hwCam.position.set(0, 4.0, 5.4);
      this.hwCam.lookAt(0, 0, -7.2);
      this.hwCam.fov = 47;
    }
    return parts;
  }

  update(ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const grid = f.grid;
    const now = ctx.time;
    const beat = f.beat;
    const x = beat * 4;
    const react = num(p.react, 1);
    const difficulty = (DIFFICULTIES as readonly string[]).includes(String(p.difficulty)) ? (p.difficulty as Difficulty) : 'hard';
    const parts = this.setLayout(String(p.part ?? 'guitar'));
    const speed = clamp(num(p.speed, 1), 0.7, 1.6);
    const visBeats = Math.min(VIS_BEATS / speed, (GRID_HORIZON - 1) / 4);
    const lookahead = Math.floor(visBeats * 4);
    const unitsPerBeat = (BOARD_LEN * 0.94) / visBeats;
    const o: ChartOptions = {
      difficulty,
      barSlots: f.beatsPerBar * 4,
      phraseSlots: f.beatsPerPhrase * 4,
      barStart: mod(Math.round((beat - f.barPhase * f.beatsPerBar) * 4), f.beatsPerBar * 4),
      phraseStart: mod(Math.round((beat - f.phrasePhase * f.beatsPerPhrase) * 4), f.beatsPerPhrase * 4),
    };
    const locked = f.bpmConfidence >= 0.35 && !f.silence;

    // A new song (the grid started over), or no highway on screen for a while: a fresh scoreboard.
    if (grid.valid < this.lastGridValid - 8 || now - gig.at > 15 || now < gig.at - 1) {
      resetGig();
      this.shownScore = 0;
      for (const c of this.charts.values()) c.clear();
      this.bursts = [];
    }
    this.lastGridValid = grid.valid;
    gig.at = now;

    // ---- The charts ----
    const power = beat < gig.powerUntil;
    for (const part of parts) {
      const chart = this.charts.get(part)!;
      const judged = chart.update(grid, x, lookahead, o, f.bpm, beat, locked);
      for (const ln of judged) {
        const key = `${part}:${ln.note.slot}`;
        if (gig.scored.has(key)) continue;
        gig.scored.add(key);
        this.score(ln, now, power, o);
      }
    }
    if (gig.scored.size > 2000) gig.scored.clear();

    this.cueBand(ctx, x, now);

    // ---- Star power: the drop (or a sung chorus, or a big phrase start) sets it off ----
    const phrase = Math.floor((x - o.phraseStart) / o.phraseSlots);
    const phraseStart = phrase !== gig.lastPhrase;
    let chorusStart = false;
    if (phraseStart) {
      gig.lastPhrase = phrase;
      chorusStart = this.nameSection(ctx, grid.valid, o, x);
    }
    if (!power && gig.starMeter >= 0.5 && (f.drop || chorusStart || (phraseStart && ctx.env.energy > 0.72))) {
      gig.powerUntil = beat + gig.starMeter * 32;
      gig.popups.push({ text: 'STAR POWER!', at: now, kind: 'power' });
    }
    if (power) gig.starMeter = clamp((gig.powerUntil - beat) / 32, 0, 1);
    else if (gig.powerUntil > 0 && beat >= gig.powerUntil) {
      gig.powerUntil = -1;
      gig.starMeter = 0;
    }
    this.powerGlow += ((power ? 1 : 0) - this.powerGlow) * Math.min(1, ctx.dt * 4);

    // ---- The highways ----
    this.bursts = this.bursts.filter((b) => now >= b.at - 0.1 && now - b.at < (b.big ? 0.45 : 0.22));
    for (const part of parts) this.drawHighway(part, ctx, beat, unitsPerBeat, o, power, now, react);

    // ---- The venue ----
    const kind = String(p.venue ?? 'garage');
    if (kind !== this.venueKind || !this.venue) {
      this.venue?.dispose();
      this.venueKind = kind;
      this.venue = createVenue(kind);
    }
    const vf: VenueFrame = {
      t: now,
      dt: ctx.dt,
      beat,
      barStart: beat - f.barPhase * f.beatsPerBar,
      beatsPerBar: f.beatsPerBar,
      beatsPerPhrase: f.beatsPerPhrase,
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
      notes: { ...this.lastNotes },
      singing: vocalLine(grid, grid.slot - 1),
      guitarPitch: this.pitchNow.guitar,
      bassPitch: this.pitchNow.bass,
      aspect: ctx.width / Math.max(1, ctx.height),
    };
    this.venue.update(vf);

    // ---- The HUD ----
    this.shownScore += (gig.score - this.shownScore) * Math.min(1, ctx.dt * 8);
    if (Math.abs(gig.score - this.shownScore) < 1) this.shownScore = gig.score;
    this.rockShown += (gig.rock - this.rockShown) * Math.min(1, ctx.dt * 3);
    this.hud ??= new Hud();
    gig.popups = gig.popups.filter((pp) => now >= pp.at && now - pp.at < 1.8);
    this.hud.update({
      t: now,
      score: Math.round(this.shownScore),
      streak: gig.streak,
      mult: Math.min(4, 1 + Math.floor(gig.streak / STREAK_STEP)),
      power,
      rock: this.rockShown,
      star: gig.starMeter,
      section: p.sections !== false ? gig.section : { name: '', at: -100 },
      popups: gig.popups,
      show: p.hud !== false,
      band: parts.length > 1,
      aspect: ctx.width / Math.max(1, ctx.height),
    });

    this.hwCam.aspect = ctx.width / Math.max(1, ctx.height);
    this.hwCam.updateProjectionMatrix();
    this.mode = p.finish === 'clean' ? 0 : p.finish === 'ps3' ? 2 : 1;
    this.field = Math.floor(now * 60) & 1;

    fretStats.streak = gig.streak;
    fretStats.score = gig.score;
    fretStats.star = gig.starMeter;
    fretStats.power = power;
    fretStats.section = gig.section.name;
    fretStats.part = parts.join('+');
  }

  /**
   * When the band on stage plays: each part's expected notes as they reach
   * now (so in time with the music; the heard rows only fill in a quarter
   * second later), the beat detector's hits for the drums while the drums
   * aren't predicted, and the beat itself for the strings while they aren't.
   */
  private cueBand(ctx: GenContext, x: number, now: number): void {
    const grid = ctx.frame.grid;
    const s1 = Math.floor(x);
    const s0 = Number.isNaN(this.cueX) || s1 < this.cueX || s1 - this.cueX > 8 ? s1 : this.cueX + 1;
    this.cueX = s1;
    const ex = (row: number, s: number): number => gridAt(grid, row + GRID_EXPECTED, s);
    const sure = (row: number): boolean => gridAt(grid, row, s1) >= 0.3 * 255;
    const drums = sure(GRID_ROW.confDrums);
    const strings = { guitar: sure(GRID_ROW.confGuitar), bass: sure(GRID_ROW.confBass) };
    const n = this.lastNotes;
    const e = ctx.env;
    for (let s = s0; s <= s1; s++) {
      for (const part of ['guitar', 'bass'] as const) {
        const onset = part === 'guitar' ? GRID_ROW.guitar : GRID_ROW.bass;
        const hit = strings[part] ? ex(onset, s) > 0 : e.energy > 0.3 && !ctx.frame.silence && s % (part === 'bass' ? 4 : 2) === 0;
        if (!hit) continue;
        n[part] = now;
        const pitch = ex(part === 'guitar' ? GRID_ROW.guitarPitch : GRID_ROW.bassPitch, s);
        if (pitch) this.pitchNow[part] = pitch;
      }
      if (ex(GRID_ROW.vocals, s)) n.vocals = now;
      if (drums) {
        if (ex(GRID_ROW.kick, s)) n.kick = now;
        if (ex(GRID_ROW.snare, s)) n.snare = now;
        if (ex(GRID_ROW.hat, s)) n.hat = now;
        if (ex(GRID_ROW.crash, s)) n.crash = now;
      }
    }
    if (!drums) {
      if (e.kick > 0.5 && this.envPrev.kick <= 0.5) n.kick = now;
      if (e.snare > 0.5 && this.envPrev.snare <= 0.5) n.snare = now;
      if (e.hat > 0.5 && this.envPrev.hat <= 0.5) n.hat = now;
    }
    this.envPrev.kick = e.kick;
    this.envPrev.snare = e.snare;
    this.envPrev.hat = e.hat;
    n.drums = Math.max(n.kick, n.snare, n.hat, n.crash);
  }

  private drawHighway(part: Part, ctx: GenContext, beat: number, unitsPerBeat: number, o: ChartOptions, power: boolean, now: number, react: number): void {
    const hw = this.highways.get(part)!;
    const chart = this.charts.get(part)!;
    const drums = part === 'drums';
    const zOf = (slot: number): number => -((slot / 4 - beat) * unitsPerBeat);
    const flameAt = (ln: LiveNote): number => Math.max(ln.judgedBeat, ln.note.slot / 4 - 0.1);
    const gems: GemDraw[] = [];
    const stars: GemDraw[] = [];
    const kicks: GemDraw[] = [];
    const tails: TailDraw[] = [];
    const fires: FireDraw[] = [];
    const pressed = new Array<number>(hw.lanes).fill(0);
    const flash = new Array<number>(5).fill(0);
    const colours = drums ? PAD_RGB : LANE_RGB;
    const held = new Array<boolean>(hw.lanes).fill(false);
    for (const ln of chart.notes.values()) {
      const n = ln.note;
      const z = zOf(n.slot);
      if (z < -BOARD_LEN * 1.03 || z > 2.5) continue;
      const hit = ln.result === 'hit' && beat >= flameAt(ln);
      // Light the fire once the gem reaches the frets.
      if (hit && !ln.burst) {
        ln.burst = true;
        fretStats.hits++;
        for (let l = 0; l < hw.lanes; l++) if (n.lanes & (1 << l)) this.bursts.push({ part, lane: l, at: now, big: true, seed: n.slot * 5 + l });
        if (n.kick) this.bursts.push({ part, lane: -1, at: now, big: true, seed: n.slot * 3 });
        hw.sparksAt(drums && !n.lanes ? 0 : hw.laneX(Math.log2(n.lanes & -n.lanes) | 0), 0, now, 10, n.slot, power);
      }
      // Sustain tails (drawn even after the gem has gone, while held).
      if (n.hold > 0) {
        const endSlot = Math.min(n.slot + n.hold, chart.nextInLane(n) - 1);
        const holding = hit && beat * 4 < endSlot;
        const z0 = holding ? 0 : z;
        const z1 = Math.max(-BOARD_LEN, zOf(endSlot));
        if (z1 < z0 - 0.05 && (holding || !hit)) {
          for (let l = 0; l < hw.lanes; l++) {
            if (!(n.lanes & (1 << l))) continue;
            if (holding) held[l] = true;
            tails.push({ x: hw.laneX(l), z0, z1, rgb: power ? POWER_RGB : colours[l], held: holding ? 1 : ln.result === 'miss' ? -1 : 0 });
          }
        }
      }
      if (hit) continue;
      // Fade in from the far end; a missed gem slides past the frets and fades.
      let alpha = clamp((BOARD_LEN * 1.02 + z) / (BOARD_LEN * 0.16), 0, 1);
      if (z > 0) alpha *= ln.result === 'miss' ? clamp(1 - z / 1.2, 0, 1) : clamp(1 - z / 2.2, 0, 1);
      if (alpha <= 0.01) continue;
      const phraseKey = Math.floor((n.slot - o.phraseStart) / o.phraseSlots);
      const star = n.star && !gig.starPhrases.get(phraseKey)?.failed;
      for (let l = 0; l < hw.lanes; l++) {
        if (!(n.lanes & (1 << l))) continue;
        const g: GemDraw = { x: hw.laneX(l), z, rgb: power ? POWER_RGB : colours[l], alpha, hopo: n.hopo, power, glow: 0 };
        (star ? stars : gems).push(star ? { ...g, rgb: power ? POWER_RGB : [colours[l][0] * 0.6 + 0.6, colours[l][1] * 0.6 + 0.6, colours[l][2] * 0.6 + 0.6] } : g);
      }
      if (n.kick) kicks.push({ x: 0, z, rgb: power ? POWER_RGB : KICK_RGB, alpha, hopo: false, power, glow: 0 });
    }
    // Gems the chart didn't see coming still light their fret (a small flash).
    const s = ctx.frame.grid.slot - 1;
    if (heardAt(ctx.frame.grid, part, s) && !chart.notes.has(s) && !chart.notes.has(s - 1) && !chart.notes.has(s + 1) && !this.bursts.some((b) => b.part === part && b.seed === -s)) {
      this.bursts.push({ part, lane: drums ? 1 : 2, at: now, big: false, seed: -s });
      fretStats.live++;
    }
    for (const b of this.bursts) {
      if (b.part !== part) continue;
      const age = now - b.at;
      const lanesHit = b.lane < 0 ? [...Array(hw.lanes).keys()] : [b.lane];
      for (const l of lanesHit) {
        pressed[l] = Math.max(pressed[l], clamp(1 - age / 0.14, 0, 1));
        flash[l] = Math.max(flash[l], clamp(1 - age / 0.25, 0, 1));
      }
      const tint = power ? POWER_RGB : FIRE_DEFAULT_TINT;
      if (b.lane < 0) {
        // The kick: a flash right across the frets.
        for (let l = 0; l < hw.lanes; l++) fires.push({ x: hw.laneX(l), z: 0.05, start: b.at, seed: b.seed + l, size: 0.9, kind: 1, tint: power ? POWER_RGB : KICK_RGB });
        continue;
      }
      fires.push({ x: hw.laneX(b.lane), z: 0.05, start: b.at, seed: b.seed, size: b.big ? 1.15 : 0.7, kind: 1, tint: power ? POWER_RGB : colours[b.lane] });
      if (b.big) fires.push({ x: hw.laneX(b.lane), z: 0.02, start: b.at, seed: b.seed * 1.37, size: 0.95, kind: 0, tint });
    }
    for (let l = 0; l < hw.lanes; l++) {
      if (!held[l]) continue;
      pressed[l] = 1;
      flash[l] = Math.max(flash[l], 0.7);
      fires.push({ x: hw.laneX(l), z: 0.02, start: now - 0.1, seed: l * 7 + Math.floor(now * 8), size: 0.85, kind: 2, tint: power ? POWER_RGB : FIRE_DEFAULT_TINT });
    }
    const frame: HighwayFrame = {
      beat,
      unitsPerBeat,
      barOffset: o.barStart / 4,
      beatsPerBar: ctx.frame.beatsPerBar,
      power: this.powerGlow,
      time: now,
      whammy: ctx.env.mids * react,
      theme: { garage: 0, arena: 1, neon: 2, stadium: 3 }[String(ctx.params.venue ?? 'garage')] ?? 0,
      tint: [1, 1, 1],
      flash,
      pressed,
      gems,
      stars,
      kicks,
      tails,
      fires,
    };
    hw.update(frame);
  }

  private score(ln: LiveNote, now: number, power: boolean, o: ChartOptions): void {
    const n = ln.note;
    const phraseKey = Math.floor((n.slot - o.phraseStart) / o.phraseSlots);
    if (ln.result === 'hit') {
      gig.streak++;
      const mult = Math.min(4, 1 + Math.floor(gig.streak / STREAK_STEP)) * (power ? 2 : 1);
      let gems = n.kick ? 1 : 0;
      for (let l = 0; l < 5; l++) if (n.lanes & (1 << l)) gems++;
      gig.score += 50 * Math.max(1, gems) * mult + n.hold * 25 * mult;
      gig.rock = clamp(gig.rock + 0.025, 0.05, 1);
      if (gig.streak % 50 === 0) gig.popups.push({ text: `${gig.streak} NOTE STREAK!`, at: now, kind: 'streak' });
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
    fretStats.shown++;
    // A star phrase played all the way through fills a quarter of the meter.
    for (const [key, sp] of gig.starPhrases) {
      const end = o.phraseStart + (key + 1) * o.phraseSlots;
      if (sp.counted || n.slot < end) continue;
      sp.counted = true;
      if (!sp.failed && sp.hits > 0) {
        const before = gig.starMeter;
        gig.starMeter = clamp(gig.starMeter + 0.25, 0, 1);
        if (before < 0.5 && gig.starMeter >= 0.5 && !power) gig.popups.push({ text: 'STAR POWER READY', at: now, kind: 'ready' });
      }
    }
    for (const key of gig.starPhrases.keys()) if (key < phraseKey - 4) gig.starPhrases.delete(key);
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
      for (let s = Math.floor(x) - o.phraseSlots; s < Math.floor(x); s++) if (gridAt(ctx.frame.grid, GRID_ROW.kick, s)) kicks++;
      base = kicks < 2 ? 'BREAKDOWN' : ctx.env.energy > 0.62 ? 'CHORUS' : 'VERSE';
    }
    if (base === gig.lastSectionBase) return false;
    gig.lastSectionBase = base;
    const count = (gig.sectionCounts.get(base) ?? 0) + 1;
    gig.sectionCounts.set(base, count);
    gig.section = { name: base === 'VERSE' || base === 'CHORUS' ? `${base} ${count}` : base, at: ctx.time };
    return base === 'CHORUS';
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    // Draw at the finish's resolution, then up to the layer.
    const lines = this.mode === 1 ? 480 : this.mode === 2 ? 720 : target.height;
    const h = Math.min(target.height, lines);
    const w = Math.max(1, Math.round((h * target.width) / Math.max(1, target.height)));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    }
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    if (this.venue) renderer.render(this.venue.scene, this.venue.camera);
    renderer.clear(false, true, false);
    renderer.render(this.hwScene, this.hwCam);
    if (this.hud) renderer.render(this.hud.scene, this.hud.camera);
    const u = this.finish.material.uniforms;
    u.uSrc.value = this.rt.texture;
    (u.uSrcRes.value as THREE.Vector2).set(w, h);
    u.uMode.value = this.mode;
    u.uField.value = this.field;
    this.finish.render(renderer, target);
  }

  compileTargets(): CompileTarget[] {
    this.setLayout('guitar');
    this.venue ??= createVenue('garage');
    this.hud ??= new Hud();
    return [{ scene: this.hwScene, camera: this.hwCam }, { scene: this.venue.scene, camera: this.venue.camera }, { scene: this.hud.scene, camera: this.hud.camera }, this.finish];
  }

  dispose(): void {
    for (const h of this.highways.values()) h.dispose();
    this.highways.clear();
    this.venue?.dispose();
    this.hud?.dispose();
    this.rt?.dispose();
    this.finish.dispose();
  }
}
