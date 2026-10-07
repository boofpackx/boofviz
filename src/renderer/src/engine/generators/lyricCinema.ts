/**
 * Lyric Cinema: the directing layer over the music-video lyric engine. Reads
 * the song's shape from its synced lines (repeated lines are the chorus),
 * picks a hero word per line, and moves the camera. All pure functions of the
 * lyrics, song time and beat, so preview and output stay identical.
 */

const STOP = new Set(
  [
    'a an the and or but so of to in on at by for with from up down out over i im i\'m me my you your yours we us our he him his she her it its they them their is am are was were be been being do does did have has had will would can could should just not no yes oh ooh ah yeah la na hey this that these those there here what when where who why how all as if then than too very',
    // Russian / Ukrainian filler words, so Cyrillic lyrics get sensible hero words too.
    'и в во не на я ты мы вы он она оно они что как а но да нет это с со у к ко по из за от до о об же бы ли мне меня мной тебя тебе его её ее ей им их нас вас нам вам мой моя моё мои твой твоя так все всё был была было были только уже ещё еще где когда кто там тут вот ну ой ах эй і й та що як це ти ми ви він вона воно вони не так ще вже',
  ]
    .join(' ')
    .split(' '),
);

/** Lowercase letters and digits of any script (Latin, Cyrillic...), apostrophes kept. */
const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (s: string): string[] => norm(s).split(' ').filter(Boolean);

export interface SongMap {
  /** Line i is part of the chorus (its text comes back elsewhere in the song). */
  chorus: boolean[];
  /** Index of the hero word in each line (−1: none). */
  hero: number[];
}

/** The song's shape from its lines: chorus lines and a hero word per line. */
export function songMap(lines: Array<{ text: string }>): SongMap {
  const counts = new Map<string, number>();
  const freq = new Map<string, number>();
  for (const l of lines) {
    const n = norm(l.text);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const w of wordsOf(l.text)) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const chorus = lines.map((l) => {
    const n = norm(l.text);
    return !!n && (counts.get(n) ?? 0) >= 2;
  });
  const hero = lines.map((l) => heroWord(l.text, freq));
  return { chorus, hero };
}

/** The word that should own the frame: repeated through the song, long, not a filler word. */
export function heroWord(text: string, freq?: Map<string, number>): number {
  const raw = text.split(/\s+/).filter(Boolean);
  if (raw.length < 3) return -1;
  let best = -1;
  let score = -1;
  raw.forEach((w, i) => {
    const n = norm(w);
    if (!n || STOP.has(n)) return;
    const s = (freq?.get(n) ?? 1) * 1.0 + n.length * 0.35 + (i === raw.length - 1 ? 0.4 : 0);
    if (s > score) {
      score = s;
      best = i;
    }
  });
  return best;
}

/** How big this moment is, 0..~1.4: verses calm, choruses big, drops bigger. */
export function intensityFor(chorus: boolean, energy: number, drop: number, drama: number): number {
  const base = (chorus ? 1 : 0.45) * (0.65 + 0.55 * Math.min(1, Math.max(0, energy))) + 0.45 * Math.min(1, Math.max(0, drop));
  return 0.7 + (Math.min(1.4, base) - 0.7) * Math.min(1, Math.max(0, drama));
}

export interface Shot {
  /** Camera position and look-at target, in units of the view height. */
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  roll: number;
  /** Field-of-view multiplier (punch-ins narrow it). */
  fov: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);

/**
 * The director's camera for a moment: a push-in through each line, a whip-pan
 * when a new line starts, a slow orbit through choruses, a punch-in on the hero
 * word and a shake on drops. `amount` 0 = locked off.
 */
export function directShot(o: {
  amount: number;
  intensity: number;
  lineStart: number;
  lineEnd: number;
  now: number;
  heroStart: number | null;
  chorus: boolean;
  beat: number;
  drop: number;
  seed: number;
  flat: boolean;
}): Shot {
  const a = Math.max(0, o.amount);
  const shot: Shot = { px: 0.09, py: 0.07, pz: 1, tx: 0, ty: 0, tz: 0, roll: 0, fov: 1 };
  if (o.flat) {
    shot.px = 0;
    shot.py = 0;
  }
  if (a <= 0) return shot;
  const len = Math.max(0.5, o.lineEnd - o.lineStart);
  const t = clamp01((o.now - o.lineStart) / len);
  // Push in over the line (harder in big moments).
  shot.pz = 1.08 - 0.16 * t * a * o.intensity;
  // Whip-pan into each new line from alternating sides.
  const side = o.seed % 2 ? 1 : -1;
  const whip = 1 - outCubic((o.now - o.lineStart) / 0.3);
  if (!o.flat) {
    shot.px += side * 0.5 * whip * a * Math.min(1, o.intensity);
    shot.roll = side * 0.06 * whip * a;
  }
  // Choruses circle slowly.
  if (o.chorus && !o.flat) {
    const ang = Math.sin(o.beat * Math.PI / 16) * 0.22 * a;
    shot.px += Math.sin(ang) * 1.0;
    shot.pz *= Math.cos(ang);
  }
  // Punch in when the hero word lands.
  if (o.heroStart !== null && o.now >= o.heroStart) {
    const k = Math.max(0, 1 - (o.now - o.heroStart) / 0.5);
    shot.fov *= 1 - 0.14 * k * a * o.intensity;
  }
  // Drops shake (stepped, so both windows agree frame to frame).
  if (o.drop > 0.05) {
    const s = Math.floor(o.now * 30);
    const h = (n: number): number => {
      const x = Math.sin(s * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x) - 0.5;
    };
    shot.px += h(1) * 0.03 * o.drop * a;
    shot.py += h(2) * 0.03 * o.drop * a;
  }
  return shot;
}

/** Bouncing-screensaver motion: a triangle wave per axis, and how many walls it has hit (for colour changes). */
export function bounce(now: number, rangeX: number, rangeY: number): { x: number; y: number; hits: number } {
  const vx = 0.13;
  const vy = 0.097;
  const tri = (u: number): number => 1 - 4 * Math.abs(u - Math.floor(u + 0.5));
  const ux = now * vx + 0.25;
  const uy = now * vy + 0.1;
  const hits = Math.floor(ux * 2 + 0.5) + Math.floor(uy * 2 + 0.5);
  return { x: tri(ux) * rangeX * 0.5, y: tri(uy) * rangeY * 0.5, hits };
}
