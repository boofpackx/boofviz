import type { GenContext } from './Generator';
import { CanvasLook, paletteCss } from './CanvasLook';
import { num } from './ShaderGenerator';
import { hash01 } from '../modulation';

/**
 * Silhouette Dance: the 2003 music-player ads. One flat, loud colour fills
 * the frame and cuts to the next on every bar; pure black silhouettes dance
 * on the beat; thin white earphone cords run from their ears to a little
 * white player in a hand and whip behind every move. Nothing else.
 *
 * A dancer is a simple skeleton drawn as a solid silhouette (thick rounded
 * limbs, so no detail is needed). Moves are short cycles of poses keyed to
 * the beat, eased so every pose hits on the beat; the feet stay planted, so
 * bending the knees drops the body. The cords are springs that lag behind.
 */

/** A pose: lean, left arm (shoulder, elbow), right arm, left leg (hip, knee), right leg, head tilt, lift. Degrees. */
type Pose = [number, number, number, number, number, number, number, number, number, number, number];

/** Each move: poses for one cycle, and beats per pose. */
const MOVES: Array<{ name: string; per: number; poses: Pose[] }> = [
  // Bounce step: knees on the beat, arms pumping bent.
  { name: 'bounce', per: 0.5, poses: [[0, 30, 80, 20, 100, 12, 30, 10, 28, 4, 0], [2, 20, 100, 30, 80, 8, 6, 8, 6, -4, 0]] },
  // Raise the roof: palms pushing up on the beat.
  { name: 'roof', per: 0.5, poses: [[0, 120, 60, 120, 60, 14, 34, 14, 34, 0, 0], [0, 150, 25, 150, 25, 10, 8, 10, 8, 0, 0]] },
  // Running man: alternate knees up, arms swinging.
  { name: 'running', per: 0.5, poses: [[-4, -25, 70, 40, 90, 50, 95, 4, 10, 5, 0], [4, 40, 90, -25, 70, 4, 10, 50, 95, -5, 0]] },
  // Jump: crouch, then airborne with arms up.
  { name: 'jump', per: 1, poses: [[6, 20, 40, 20, 40, 24, 60, 24, 60, 8, 0], [-4, 160, 10, 160, 10, 30, 70, 30, 70, -6, 0.22]] },
  // Shoulder pump and head bob, one arm up pointing.
  { name: 'point', per: 0.5, poses: [[-6, 165, 0, 15, 110, 14, 22, 6, 4, -10, 0], [-2, 150, 10, 20, 95, 10, 6, 6, 4, 6, 0]] },
  // Lean back, both arms out wide.
  { name: 'lean', per: 1, poses: [[-14, 90, 0, 90, 0, 18, 26, 18, 26, -14, 0], [10, 60, 70, 60, 70, 10, 10, 10, 10, 10, 0]] },
  // The pop: sharp angular robot hits.
  { name: 'pop', per: 0.5, poses: [[0, 90, 90, 10, 0, 8, 4, 8, 4, 0, 0], [0, 10, 0, 90, -90, 8, 4, 8, 4, 0, 0], [0, 90, -90, 90, 90, 16, 30, 16, 30, 0, 0], [0, 45, 135, 45, 135, 8, 4, 8, 4, 0, 0]] },
  // Side sway with hands clapping overhead.
  { name: 'clap', per: 0.5, poses: [[-8, 170, -20, 150, 30, 12, 18, 4, 2, -6, 0], [8, 150, 30, 170, -20, 4, 2, 12, 18, 6, 0]] },
];

interface Dancer {
  cord: Float32Array; // spring state: split point x, y, vx, vy; mid point x, y, vx, vy
  ready: boolean;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ease that arrives early and holds: the pose lands on the beat. */
function hit(t: number): number {
  const x = Math.min(1, t / 0.55);
  return 1 - Math.pow(1 - x, 3);
}

export class Silhouette extends CanvasLook {
  readonly kind = 'silhouette';
  private dancers: Dancer[] = [0, 1, 2].map(() => ({ cord: new Float32Array(8), ready: false }));

  protected draw(g: CanvasRenderingContext2D, W: number, H: number, ctx: GenContext): void {
    const p = ctx.params;
    const f = ctx.frame;
    const bpb = f.beatsPerBar || 4;
    const bpp = Math.max(4, f.beatsPerPhrase || 16);
    const beat = ctx.beat;
    const bar = Math.floor(beat / bpb);
    const phrase = Math.floor(beat / bpp);
    // Flat colour, cut on the bar, through the palette (all five stops, never the same twice running).
    const every = Math.max(1, Math.round(num(p.cutBars, 1)));
    const slot = Math.floor(bar / every);
    // Only the palette's light colours: a black dancer must always stand out.
    const pal = ctx.palette;
    const light = [0, 1, 2, 3, 4].filter((i) => 0.2126 * pal[i * 3] + 0.7152 * pal[i * 3 + 1] + 0.0722 * pal[i * 3 + 2] > 0.12);
    const pool = light.length >= 2 ? light : [1, 2, 3, 4];
    const pickC = (sl: number): number => pool[Math.floor(hash01(sl, 3) * pool.length)];
    let ci = pickC(slot);
    if (ci === pickC(slot - 1)) ci = pool[(pool.indexOf(ci) + 1) % pool.length];
    g.fillStyle = paletteCss(ctx.palette, ci);
    g.fillRect(0, 0, W, H);
    // Framing per phrase: wide, close, or two dancers (always two after a drop until the phrase ends).
    const framing = String(p.framing ?? 'mixed');
    const pick = framing === 'mixed' ? ['wide', 'wide', 'pair', 'close'][Math.floor(hash01(phrase, 7) * 4)] : framing;
    const pair = pick === 'pair' || (framing === 'mixed' && ctx.env.drop > 0.3);
    const close = pick === 'close' && !pair;
    // Sized so raised hands stay in frame; the close-up crops at the knees.
    // Sized by height, but never wider than a tall screen allows.
    const base = Math.min(H, W * (pair ? 0.9 : 1.4));
    const scale = base * (close ? 1.15 : pair ? 0.6 : 0.64);
    const floorY = close ? H * 0.5 + base * 0.72 : H * 0.5 + base * 0.43;
    const silent = f.silence;
    const xs = pair ? [W * 0.33, W * 0.67] : [W * 0.5];
    xs.forEach((x, di) => {
      // Each phrase brings a new move; the second dancer mirrors or offsets.
      const moveSet = String(p.moves ?? 'all');
      const pool = moveSet === 'all' ? MOVES : MOVES.filter((m) => moveSet.split(',').map((s) => s.trim()).includes(m.name));
      const list = pool.length ? pool : MOVES;
      const m = list[Math.floor(hash01(phrase * 3 + (di && hash01(phrase, 9) > 0.5 ? 1 : 0), 5) * list.length)];
      // Builds go double time; breakdowns half time.
      const speed = ctx.frame.energyTrend === 'building' && ctx.env.energy > 0.5 ? 2 : ctx.env.energy < 0.18 ? 0.5 : 1;
      const offset = di === 1 && !(hash01(phrase, 11) > 0.4) ? m.per * 0.5 : 0;
      const tb = silent ? Math.floor(beat) : beat * speed - offset;
      const per = m.per;
      const k = Math.floor(tb / per);
      const fr = silent ? 0 : (tb / per) - k;
      const a = m.poses[k % m.poses.length], b = m.poses[(k + 1) % m.poses.length];
      const e = hit(fr);
      const pose = a.map((v, i) => lerp(v, b[i], e)) as Pose;
      const mirror = di === 1 && hash01(phrase, 11) > 0.4;
      this.dancer(g, x, floorY, scale, pose, ctx, di, mirror, hash01(phrase * 7 + di, 13));
    });
  }

  private dancer(g: CanvasRenderingContext2D, cx: number, floorY: number, S: number, poseIn: Pose, ctx: GenContext, di: number, mirror: boolean, look: number): void {
    // A mirrored dancer is the same pose with left and right swapped and the lean reversed.
    const pose: Pose = mirror ? [-poseIn[0], poseIn[3], poseIn[4], poseIn[1], poseIn[2], poseIn[7], poseIn[8], poseIn[5], poseIn[6], -poseIn[9], poseIn[10]] : poseIn;
    const [lean0, aL, eL, aR, eR, hL, kL, hR, kR, tilt0, lift] = pose;
    // Hips sway a step each beat, the head nods on the hats.
    const sway = Math.sin(ctx.beat * Math.PI) * (1 + ctx.env.energy);
    const lean = lean0 + sway * 4;
    const tilt = tilt0 + ctx.env.hat * 7 - sway * 3;
    const rad = Math.PI / 180;
    const kick = ctx.env.kick * num(ctx.params.bounce, 1);
    // Leg geometry decides how high the hips are, so planted feet stay on the floor.
    const thigh = 0.235, shin = 0.235;
    const bendL = kL + kick * 14, bendR = kR + kick * 14;
    const legH = (h: number, k: number): number => thigh * Math.cos(h * rad) + shin * Math.cos((h - k) * rad);
    const hipY = floorY - S * (Math.max(legH(hL, bendL), legH(hR, bendR)) + 0.03 + lift);
    const hipX = cx + Math.sin(lean * rad) * S * 0.05 + sway * S * 0.025;
    const torso = 0.31;
    const lr = lean * rad;
    const hip: [number, number] = [hipX, hipY];
    const neck: [number, number] = [hipX + Math.sin(lr) * torso * S, hipY - Math.cos(lr) * torso * S];
    const along = (o: [number, number], ang: number, len: number): [number, number] => [o[0] + Math.sin(ang) * len * S, o[1] + Math.cos(ang) * len * S];
    const side = (o: [number, number], d: number): [number, number] => [o[0] + Math.cos(lr) * d * S, o[1] + Math.sin(lr) * d * S];
    const shL = side(along(neck, lr, 0.03), -0.115), shR = side(along(neck, lr, 0.03), 0.115);
    const hpL = side(hip, -0.06), hpR = side(hip, 0.06);
    // Limb directions: angle from straight down, outward positive.
    const arm = (sh: [number, number], s: number, a: number, e: number): [[number, number], [number, number]] => {
      const elbow = along(sh, a * s * rad + lr, 0.16);
      return [elbow, along(elbow, (a + e) * s * rad + lr, 0.15)];
    };
    const leg = (hp: [number, number], s: number, h: number, k: number): [[number, number], [number, number]] => {
      const knee = along(hp, h * s * rad, thigh);
      return [knee, along(knee, (h - k) * s * rad, shin)];
    };
    const [elL, haL] = arm(shL, -1, aL, eL);
    const [elR, haR] = arm(shR, 1, aR, eR);
    const [knL, ftL] = leg(hpL, -1, hL, bendL);
    const [knR, ftR] = leg(hpR, 1, hR, bendR);
    const headR = 0.074;
    const headC = along(neck, lr + tilt * rad + Math.PI, 0.085);
    g.fillStyle = '#000';
    const limb = (a: [number, number], b: [number, number], w0: number, w1: number): void => {
      // A tapered capsule.
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      g.beginPath();
      g.moveTo(a[0] + nx * w0 * S, a[1] + ny * w0 * S);
      g.lineTo(b[0] + nx * w1 * S, b[1] + ny * w1 * S);
      g.lineTo(b[0] - nx * w1 * S, b[1] - ny * w1 * S);
      g.lineTo(a[0] - nx * w0 * S, a[1] - ny * w0 * S);
      g.fill();
      g.beginPath();
      g.arc(a[0], a[1], w0 * S, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(b[0], b[1], w1 * S, 0, Math.PI * 2);
      g.fill();
    };
    // Baggy trousers, shoes, a hoodie torso, sleeves, hands, head and hair.
    limb(hpL, knL, 0.062, 0.05);
    limb(knL, ftL, 0.05, 0.046);
    limb(hpR, knR, 0.062, 0.05);
    limb(knR, ftR, 0.05, 0.046);
    for (const [ft, s] of [[ftL, -1], [ftR, 1]] as Array<[[number, number], number]>) {
      g.beginPath();
      g.ellipse(ft[0] + s * 0.03 * S, ft[1] + 0.015 * S, 0.062 * S, 0.03 * S, 0, 0, Math.PI * 2);
      g.fill();
    }
    const waistL = side(hip, -0.1), waistR = side(hip, 0.1);
    const chestL = side(along(neck, lr, 0.04), -0.14), chestR = side(along(neck, lr, 0.04), 0.14);
    const mid = along(hip, lr + Math.PI, torso * 0.5);
    g.beginPath();
    g.moveTo(waistL[0], waistL[1] + 0.03 * S);
    g.quadraticCurveTo(...side(mid, -0.13), chestL[0], chestL[1]);
    g.quadraticCurveTo(neck[0], neck[1] - 0.035 * S, chestR[0], chestR[1]);
    g.quadraticCurveTo(...side(mid, 0.13), waistR[0], waistR[1] + 0.03 * S);
    g.closePath();
    g.fill();
    limb(shL, elL, 0.05, 0.042);
    limb(elL, haL, 0.042, 0.034);
    limb(shR, elR, 0.05, 0.042);
    limb(elR, haR, 0.042, 0.034);
    for (const ha of [haL, haR]) {
      g.beginPath();
      g.arc(ha[0], ha[1], 0.038 * S, 0, Math.PI * 2);
      g.fill();
    }
    limb(neck, headC, 0.04, 0.04);
    g.beginPath();
    g.ellipse(headC[0], headC[1], headR * 0.9 * S, headR * S, lr + tilt * rad, 0, Math.PI * 2);
    g.fill();
    if (look < 0.34) {
      // A big round puff of hair.
      g.beginPath();
      g.arc(headC[0], headC[1] - headR * 0.3 * S, headR * 1.45 * S, 0, Math.PI * 2);
      g.fill();
    } else if (look < 0.67) {
      // A ponytail that swings with the beat.
      const swing = Math.sin(ctx.beat * Math.PI) * 0.7 - lr;
      const base = side(along(headC, lr + Math.PI, headR * 0.6), -0.05);
      limb(base, along(base, Math.PI * 0.75 + swing, 0.17), 0.04, 0.02);
    } else {
      // A cap with a short brim.
      g.beginPath();
      g.ellipse(...side(along(headC, lr + Math.PI, headR * 0.55), 0.06), 0.07 * S, 0.02 * S, lr, 0, Math.PI * 2);
      g.fill();
    }
    // The earphone cords: ears → a split under the chin → the player in the left hand. The split and the slack lag behind.
    const earL = side(headC, -headR * 0.92), earR = side(headC, headR * 0.92);
    const player = haL;
    const tSplit = along(neck, lr, 0.06);
    const tMid: [number, number] = [(tSplit[0] + player[0]) / 2, Math.max(tSplit[1], player[1]) + 0.06 * S + ctx.env.snare * 0.05 * S];
    const d = this.dancers[di];
    const c = d.cord;
    const far = (x: number, y: number, tx: number, ty: number): boolean => !Number.isFinite(x) || Math.hypot(x - tx, y - ty) > S;
    if (!d.ready || far(c[0], c[1], tSplit[0], tSplit[1]) || far(c[4], c[5], tMid[0], tMid[1])) {
      c.set([tSplit[0], tSplit[1], 0, 0, tMid[0], tMid[1], 0, 0]);
      d.ready = true;
    }
    // The split point follows closely; the slack swings on a soft spring (small steps keep it stable).
    const steps = 8, h = Math.min(0.05, ctx.dt) / steps;
    for (let k = 0; k < steps; k++) {
      c[2] += ((tSplit[0] - c[0]) * 400 - c[2] * 35) * h;
      c[3] += ((tSplit[1] - c[1]) * 400 - c[3] * 35) * h;
      c[0] += c[2] * h;
      c[1] += c[3] * h;
      c[6] += ((tMid[0] - c[4]) * 60 - c[6] * 6) * h;
      c[7] += ((tMid[1] - c[5]) * 60 - c[7] * 6) * h;
      c[4] += c[6] * h;
      c[5] += c[7] * h;
    }
    g.strokeStyle = '#fff';
    g.lineWidth = Math.max(1.5, S * 0.0045);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(earL[0], earL[1]);
    g.quadraticCurveTo(earL[0] - 0.01 * S, (earL[1] + c[1]) / 2, c[0], c[1]);
    g.moveTo(earR[0], earR[1]);
    g.quadraticCurveTo(earR[0] + 0.01 * S, (earR[1] + c[1]) / 2, c[0], c[1]);
    g.moveTo(c[0], c[1]);
    g.bezierCurveTo(c[4], c[5], c[4], c[5], player[0], player[1]);
    g.stroke();
    g.fillStyle = '#fff';
    for (const ear of [earL, earR]) {
      g.beginPath();
      g.arc(ear[0], ear[1], S * 0.007, 0, Math.PI * 2);
      g.fill();
    }
    g.save();
    g.translate(player[0], player[1]);
    g.rotate(lr + aL * 0.2 * rad);
    g.beginPath();
    g.roundRect(-0.019 * S, -0.03 * S, 0.038 * S, 0.06 * S, 0.006 * S);
    g.fill();
    g.restore();
  }
}
