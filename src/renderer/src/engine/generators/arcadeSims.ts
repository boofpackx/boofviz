import { hash01 } from '../modulation';

/**
 * Tiny deterministic retro-game simulations on a cell grid. Each sim is a pure
 * function of (seed, ticks since reset): the generator replays from the start
 * of the cycle when needed, so every window shows the same game state.
 *
 * Cell encoding (RGBA8): R colour id, G intensity, B style.
 */
export const Style = { Block: 0, Pellet: 1, Power: 2, Wall: 3, Trail: 4, Pixel: 5, Lcd: 6, Orb: 7 } as const;

export const Col = { None: 0, Cyan: 1, Yellow: 2, Purple: 3, Green: 4, Red: 5, Blue: 6, Orange: 7, White: 8, Pink: 9, Wall: 10, Lcd: 11, Grey: 12, Frightened: 13 } as const;

export class Grid {
  readonly cells: Uint8Array;
  constructor(
    public w: number,
    public h: number,
    readonly stride: number,
  ) {
    this.cells = new Uint8Array(stride * 64 * 4);
  }
  clear(): void {
    this.cells.fill(0);
  }
  set(x: number, y: number, color: number, intensity = 255, style: number = Style.Block): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.stride + x) * 4;
    this.cells[i] = color;
    this.cells[i + 1] = intensity;
    this.cells[i + 2] = style;
  }
}

export interface ArcadeSim {
  readonly w: number;
  readonly h: number;
  /** Simulation ticks per beat. */
  readonly tpb: number;
  reset(seed: number): void;
  step(tick: number): void;
  draw(g: Grid, beatPhase: number): void;
}

const rnd = (n: number, seed: number): number => hash01(n, seed);

// ---------------------------------------------------------------------------
// Falling blocks
// ---------------------------------------------------------------------------

const SHAPES: number[][][] = [
  [[0, 1], [1, 1], [2, 1], [3, 1]], // I
  [[1, 0], [2, 0], [1, 1], [2, 1]], // O
  [[1, 0], [0, 1], [1, 1], [2, 1]], // T
  [[1, 0], [2, 0], [0, 1], [1, 1]], // S
  [[0, 0], [1, 0], [1, 1], [2, 1]], // Z
  [[0, 0], [0, 1], [1, 1], [2, 1]], // J
  [[2, 0], [0, 1], [1, 1], [2, 1]], // L
];
const SHAPE_COLORS = [Col.Cyan, Col.Yellow, Col.Purple, Col.Green, Col.Red, Col.Blue, Col.Orange];

function rotate(cells: number[][], r: number): number[][] {
  let out = cells.map((c) => [...c]);
  for (let k = 0; k < r % 4; k++) out = out.map(([x, y]) => [-y, x]);
  const mx = Math.min(...out.map((c) => c[0]));
  const my = Math.min(...out.map((c) => c[1]));
  return out.map(([x, y]) => [x - mx, y - my]);
}

export class BlocksSim implements ArcadeSim {
  readonly w = 30;
  readonly h = 18;
  readonly tpb = 4;
  private readonly bw = 12;
  private board: number[] = [];
  private seed = 0;
  private piece = 0;
  private rot = 0;
  private px = 0;
  private py = 0;
  private targetX = 0;
  private targetRot = 0;
  private count = 0;
  private flashRows: number[] = [];
  private flashTicks = 0;
  private next = 0;

  reset(seed: number): void {
    this.seed = seed;
    this.board = new Array(this.bw * this.h).fill(0);
    this.count = 0;
    this.next = Math.floor(rnd(0, seed) * 7);
    this.spawn();
  }

  private cellsOf(piece: number, rot: number): number[][] {
    return rotate(SHAPES[piece], rot);
  }

  private fits(piece: number, rot: number, x: number, y: number): boolean {
    for (const [cx, cy] of this.cellsOf(piece, rot)) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= this.bw || by >= this.h) return false;
      if (by >= 0 && this.board[by * this.bw + bx]) return false;
    }
    return true;
  }

  /** Pick the landing spot a decent player would choose. */
  private plan(): void {
    let best = -Infinity;
    for (let r = 0; r < 4; r++) {
      for (let x = -2; x < this.bw; x++) {
        if (!this.fits(this.piece, r, x, 0)) continue;
        let y = 0;
        while (this.fits(this.piece, r, x, y + 1)) y++;
        const b = [...this.board];
        for (const [cx, cy] of this.cellsOf(this.piece, r)) if (y + cy >= 0) b[(y + cy) * this.bw + x + cx] = 1;
        let lines = 0;
        let holes = 0;
        let agg = 0;
        let bump = 0;
        let prevH = -1;
        for (let row = 0; row < this.h; row++) if (b.slice(row * this.bw, row * this.bw + this.bw).every(Boolean)) lines++;
        for (let col = 0; col < this.bw; col++) {
          let top = this.h;
          for (let row = 0; row < this.h; row++) if (b[row * this.bw + col]) { top = row; break; }
          const ht = this.h - top;
          agg += ht;
          for (let row = top + 1; row < this.h; row++) if (!b[row * this.bw + col]) holes++;
          if (prevH >= 0) bump += Math.abs(ht - prevH);
          prevH = ht;
        }
        const score = lines * 8 - holes * 3.5 - agg * 0.5 - bump * 0.35 + rnd(this.count * 97 + r * 13 + x, this.seed) * 0.3;
        if (score > best) {
          best = score;
          this.targetX = x;
          this.targetRot = r;
        }
      }
    }
  }

  private spawn(): void {
    this.piece = this.next;
    this.next = Math.floor(rnd(++this.count, this.seed + 1) * 7);
    this.rot = 0;
    this.px = Math.floor(this.bw / 2) - 2;
    this.py = -2;
    if (!this.fits(this.piece, 0, this.px, this.py + 1)) this.board.fill(0); // topped out: clean slate
    this.plan();
  }

  step(): void {
    if (this.flashTicks > 0) {
      if (--this.flashTicks === 0) {
        for (const row of this.flashRows.sort((a, b) => a - b)) {
          this.board.splice(row * this.bw, this.bw);
          this.board.unshift(...new Array(this.bw).fill(0));
        }
        this.flashRows = [];
      }
      return;
    }
    if (this.rot !== this.targetRot && this.fits(this.piece, this.rot + 1, this.px, this.py)) this.rot = (this.rot + 1) % 4;
    const dx = Math.sign(this.targetX - this.px);
    if (dx && this.fits(this.piece, this.rot, this.px + dx, this.py)) this.px += dx;
    if (this.fits(this.piece, this.rot, this.px, this.py + 1)) {
      this.py++;
      return;
    }
    for (const [cx, cy] of this.cellsOf(this.piece, this.rot)) if (this.py + cy >= 0) this.board[(this.py + cy) * this.bw + this.px + cx] = SHAPE_COLORS[this.piece];
    for (let row = 0; row < this.h; row++) if (this.board.slice(row * this.bw, row * this.bw + this.bw).every(Boolean)) this.flashRows.push(row);
    if (this.flashRows.length) this.flashTicks = 3;
    this.spawn();
  }

  draw(g: Grid): void {
    const ox = Math.floor((this.w - this.bw) / 2);
    for (let y = 0; y < this.h; y++) {
      g.set(ox - 1, y, Col.Grey, 150);
      g.set(ox + this.bw, y, Col.Grey, 150);
      for (let x = 0; x < this.bw; x++) {
        const c = this.board[y * this.bw + x];
        if (c) g.set(ox + x, y, this.flashRows.includes(y) ? Col.White : c, this.flashRows.includes(y) ? 255 : 210);
      }
    }
    for (const [cx, cy] of this.cellsOf(this.piece, this.rot)) g.set(ox + this.px + cx, this.py + cy, SHAPE_COLORS[this.piece], 255);
    // Next-piece box on the right.
    const nx = ox + this.bw + 4;
    for (const [cx, cy] of this.cellsOf(this.next, 0)) g.set(nx + cx, 2 + cy, SHAPE_COLORS[this.next], 230);
  }
}

// ---------------------------------------------------------------------------
// Maze chase
// ---------------------------------------------------------------------------

interface Actor {
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: number;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class MazeSim implements ArcadeSim {
  readonly w = 31;
  readonly h = 17;
  readonly tpb = 4;
  private walls: boolean[] = [];
  private pellets: number[] = [];
  private seed = 0;
  private player: Actor = { x: 0, y: 0, dx: 1, dy: 0, color: Col.Yellow };
  private chasers: Actor[] = [];
  private fright = 0;
  private flash = 0;
  private t = 0;

  private wall(x: number, y: number): boolean {
    return x < 0 || y < 0 || x >= this.w || y >= this.h || this.walls[y * this.w + x];
  }

  reset(seed: number): void {
    this.seed = seed;
    const W = this.w;
    const H = this.h;
    this.walls = new Array(W * H).fill(true);
    // Carve the left half with a backtracker on odd cells, then mirror it.
    const half = Math.ceil(W / 2);
    const stack: Array<[number, number]> = [[1, 1]];
    this.walls[W + 1] = false;
    let n = 0;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = DIRS.map(([dx, dy]) => [cx + dx * 2, cy + dy * 2, dx, dy]).filter(([x, y]) => x > 0 && y > 0 && x < half && y < H - 1 && this.walls[y * W + x]);
      if (!opts.length) {
        stack.pop();
        continue;
      }
      const [x, y, dx, dy] = opts[Math.floor(rnd(n++, seed) * opts.length)];
      this.walls[(cy + dy) * W + cx + dx] = false;
      this.walls[y * W + x] = false;
      stack.push([x, y]);
    }
    // Braid: open dead ends so the maze loops like an arcade board.
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < half; x++) {
        if (this.walls[y * W + x]) continue;
        const open = DIRS.filter(([dx, dy]) => !this.walls[(y + dy) * W + x + dx]).length;
        if (open <= 1 && rnd(y * 100 + x, seed + 5) < 0.85) {
          const cand = DIRS.filter(([dx, dy]) => this.walls[(y + dy) * W + x + dx] && x + dx * 2 > 0 && x + dx * 2 < half + 1 && y + dy * 2 > 0 && y + dy * 2 < H - 1);
          if (cand.length) {
            const [dx, dy] = cand[Math.floor(rnd(y * 31 + x, seed + 6) * cand.length)];
            this.walls[(y + dy) * W + x + dx] = false;
          }
        }
      }
    }
    for (let y = 0; y < H; y++) for (let x = half; x < W; x++) this.walls[y * W + x] = this.walls[y * W + (W - 1 - x)];
    // Centre corridor so both halves connect.
    for (let x = 1; x < W - 1; x++) this.walls[Math.floor(H / 2) * W + x] = this.walls[Math.floor(H / 2) * W + x] && x % 6 !== 0;
    this.pellets = this.walls.map((w) => (w ? 0 : 1));
    for (const [x, y] of [
      [1, 1],
      [W - 2, 1],
      [1, H - 2],
      [W - 2, H - 2],
    ]) {
      this.walls[y * W + x] = false;
      this.pellets[y * W + x] = 2;
    }
    const mid = Math.floor(H / 2);
    this.player = { x: Math.floor(W / 2), y: mid, dx: 1, dy: 0, color: Col.Yellow };
    this.walls[mid * W + this.player.x] = false;
    this.chasers = [Col.Red, Col.Pink, Col.Cyan, Col.Orange].map((color, i) => ({ x: i < 2 ? 1 : W - 2, y: i % 2 ? 1 : H - 2, dx: 0, dy: 0, color }));
    this.fright = 0;
    this.t = 0;
  }

  private moveActor(a: Actor, target: [number, number] | null, randomness: number, salt: number): void {
    const opts = DIRS.filter(([dx, dy]) => !this.wall(a.x + dx, a.y + dy) && !(dx === -a.dx && dy === -a.dy && (a.dx || a.dy)));
    const choices = opts.length ? opts : DIRS.filter(([dx, dy]) => !this.wall(a.x + dx, a.y + dy));
    if (!choices.length) return;
    let pick = choices[0];
    if (target && rnd(this.t * 7 + salt, this.seed + 9) > randomness) {
      let bestD = Infinity;
      for (const c of choices) {
        const d = Math.hypot(a.x + c[0] - target[0], a.y + c[1] - target[1]);
        if (d < bestD) {
          bestD = d;
          pick = c;
        }
      }
    } else pick = choices[Math.floor(rnd(this.t * 13 + salt, this.seed + 3) * choices.length)];
    a.dx = pick[0];
    a.dy = pick[1];
    a.x += a.dx;
    a.y += a.dy;
  }

  private nearestPellet(): [number, number] | null {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let i = 0; i < this.pellets.length; i++) {
      if (!this.pellets[i]) continue;
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      const d = Math.abs(x - this.player.x) + Math.abs(y - this.player.y);
      if (d < bd) {
        bd = d;
        best = [x, y];
      }
    }
    return best;
  }

  step(): void {
    this.t++;
    if (this.flash > 0) {
      this.flash--;
      return;
    }
    const p = this.player;
    this.moveActor(p, this.nearestPellet(), 0.15, 1);
    const i = p.y * this.w + p.x;
    if (this.pellets[i] === 2) this.fright = 24;
    this.pellets[i] = 0;
    if (!this.pellets.some(Boolean)) this.pellets = this.walls.map((w) => (w ? 0 : 1));
    if (this.fright > 0) this.fright--;
    this.chasers.forEach((c, k) => {
      if (this.t % (this.fright > 0 ? 2 : 1) !== 0) return;
      const target: [number, number] = this.fright > 0 ? [this.w - p.x, this.h - p.y] : [p.x + p.dx * k * 2, p.y + p.dy * k * 2];
      this.moveActor(c, target, 0.3 + k * 0.1, 10 + k);
      if (c.x === p.x && c.y === p.y) {
        if (this.fright > 0) {
          c.x = Math.floor(this.w / 2);
          c.y = Math.floor(this.h / 2);
        } else {
          this.flash = 6;
          p.x = Math.floor(this.w / 2);
          p.y = Math.floor(this.h / 2);
        }
      }
    });
  }

  draw(g: Grid, beatPhase: number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.walls[i]) g.set(x, y, Col.Wall, 255, Style.Wall);
        else if (this.pellets[i] === 1) g.set(x, y, Col.White, 200, Style.Pellet);
        else if (this.pellets[i] === 2) g.set(x, y, Col.White, beatPhase < 0.5 ? 255 : 70, Style.Power);
      }
    }
    for (const c of this.chasers) g.set(c.x, c.y, this.fright > 0 ? Col.Frightened : c.color, 255, Style.Orb);
    g.set(this.player.x, this.player.y, this.flash > 0 && this.flash % 2 ? Col.White : Col.Yellow, 255, Style.Orb);
  }
}

// ---------------------------------------------------------------------------
// Pixel aliens (original sprites)
// ---------------------------------------------------------------------------

const SPRITES: string[][] = [
  ['..X...X..', '...XXX...', '..XXXXX..', '.XX.X.XX.', 'XXXXXXXXX', 'X.X...X.X'],
  ['..X...X..', '...XXX...', '..XXXXX..', '.XX.X.XX.', 'XXXXXXXXX', '.X.X.X.X.'],
  ['...XXX...', '.XXXXXXX.', 'XX.XXX.XX', 'XXXXXXXXX', '..X...X..', '.X.X.X.X.'],
  ['...XXX...', '.XXXXXXX.', 'XX.XXX.XX', 'XXXXXXXXX', '.X.....X.', 'X.......X'],
  ['....X....', '..XXXXX..', '.X.X.X.X.', 'XXXXXXXXX', '.XX...XX.', 'X..X.X..X'],
  ['....X....', '..XXXXX..', '.X.X.X.X.', 'XXXXXXXXX', '..XX.XX..', '.X.....X.'],
];
const CANNON = ['....X....', '...XXX...', 'XXXXXXXXX', 'XXXXXXXXX'];
const BOOM = ['X..X.X..X', '.X.....X.', '..X.X.X..', '.X.....X.', 'X..X.X..X'];

export class AliensSim implements ArcadeSim {
  readonly w = 64;
  readonly h = 36;
  readonly tpb = 8;
  private alive: boolean[] = [];
  private boom: number[] = [];
  private ox = 4;
  private oy = 3;
  private dir = 1;
  private frame = 0;
  private cannonX = 28;
  private shots: Array<{ x: number; y: number }> = [];
  private seed = 0;
  private t = 0;
  private readonly cols = 6;
  private readonly rows = 4;

  reset(seed: number): void {
    this.seed = seed;
    this.alive = new Array(this.cols * this.rows).fill(true);
    this.boom = new Array(this.cols * this.rows).fill(0);
    this.ox = 4;
    this.oy = 3;
    this.dir = 1;
    this.shots = [];
    this.t = 0;
  }

  private stamp(g: Grid, sprite: string[], x: number, y: number, color: number, intensity = 255): void {
    sprite.forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && g.set(x + i, y + j, color, intensity, Style.Pixel)));
  }

  step(): void {
    this.t++;
    // The formation steps once per beat, the shots fly every tick.
    if (this.t % this.tpb === 0) {
      this.frame ^= 1;
      const width = this.cols * 10;
      if ((this.dir > 0 && this.ox + width >= this.w - 1) || (this.dir < 0 && this.ox <= 1)) {
        this.dir = -this.dir;
        this.oy += 2;
        if (this.oy > 14) this.oy = 3;
      } else this.ox += this.dir * 2;
      // Fire at a live column.
      const live = this.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
      if (!live.length) this.reset(this.seed + 1);
      else {
        const target = live[Math.floor(rnd(this.t, this.seed) * live.length)];
        this.cannonX = this.ox + (target % this.cols) * 10 + 4;
        this.shots.push({ x: this.cannonX, y: this.h - 6 });
      }
    }
    for (const s of this.shots) s.y -= 2;
    this.shots = this.shots.filter((s) => {
      for (let i = 0; i < this.alive.length; i++) {
        if (!this.alive[i]) continue;
        const ix = this.ox + (i % this.cols) * 10;
        const iy = this.oy + Math.floor(i / this.cols) * 8;
        if (s.x >= ix && s.x < ix + 9 && s.y >= iy && s.y < iy + 6) {
          this.alive[i] = false;
          this.boom[i] = 4;
          return false;
        }
      }
      return s.y > 0;
    });
    for (let i = 0; i < this.boom.length; i++) if (this.boom[i] > 0) this.boom[i]--;
  }

  draw(g: Grid): void {
    for (let i = 0; i < this.alive.length; i++) {
      const x = this.ox + (i % this.cols) * 10;
      const y = this.oy + Math.floor(i / this.cols) * 8;
      const type = Math.floor(i / this.cols) === 0 ? 4 : Math.floor(i / this.cols) < 2 ? 2 : 0;
      if (this.alive[i]) this.stamp(g, SPRITES[type + this.frame], x, y, y > 18 ? Col.Green : Col.White);
      else if (this.boom[i] > 0) this.stamp(g, BOOM, x, y, Col.White, 200);
    }
    for (const s of this.shots) {
      g.set(s.x, s.y, Col.White, 255, Style.Pixel);
      g.set(s.x, s.y + 1, Col.White, 200, Style.Pixel);
    }
    // Shields and cannon in the green zone near the ground.
    for (let k = 0; k < 4; k++) {
      const bx = 8 + k * 15;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) if (!(y === 2 && x > 1 && x < 4)) g.set(bx + x, this.h - 11 + y, Col.Green, 200, Style.Pixel);
    }
    this.stamp(g, CANNON, this.cannonX - 4, this.h - 6, Col.Green);
    for (let x = 0; x < this.w; x++) g.set(x, this.h - 1, Col.Green, 160, Style.Pixel);
  }
}

// ---------------------------------------------------------------------------
// Paddle rally
// ---------------------------------------------------------------------------

const DIGITS = ['XXX X.X X.X X.X XXX', '.X. XX. .X. .X. XXX', 'XXX ..X XXX X.. XXX', 'XXX ..X XXX ..X XXX', 'X.X X.X XXX ..X ..X', 'XXX X.. XXX ..X XXX', 'XXX X.. XXX X.X XXX', 'XXX ..X ..X ..X ..X', 'XXX X.X XXX X.X XXX', 'XXX X.X XXX ..X XXX'];

export class PaddleSim implements ArcadeSim {
  readonly w = 48;
  readonly h = 27;
  readonly tpb = 8;
  private bx = 24;
  private by = 13;
  private vx = 1;
  private vy = 1;
  private ly = 11;
  private ry = 11;
  private score = [0, 0];
  private serve = 0;
  private seed = 0;
  private t = 0;

  reset(seed: number): void {
    this.seed = seed;
    this.bx = 24;
    this.by = 13;
    this.vx = rnd(1, seed) < 0.5 ? -1 : 1;
    this.vy = rnd(2, seed) < 0.5 ? -1 : 1;
    this.score = [0, 0];
    this.t = 0;
  }

  step(): void {
    this.t++;
    if (this.serve > 0) {
      this.serve--;
      return;
    }
    this.bx += this.vx;
    this.by += this.vy;
    if (this.by <= 1 || this.by >= this.h - 2) this.vy = -this.vy;
    // Paddles chase the ball with a little lag, so rallies sometimes end.
    const lag = (k: number): number => (rnd(this.t * 3 + k, this.seed) < 0.82 ? 1 : 0);
    this.ly += Math.sign(this.by - 2 - this.ly) * lag(1);
    this.ry += Math.sign(this.by - 2 - this.ry) * lag(2);
    this.ly = Math.max(1, Math.min(this.h - 6, this.ly));
    this.ry = Math.max(1, Math.min(this.h - 6, this.ry));
    if (this.bx === 3 && this.by >= this.ly && this.by < this.ly + 5) this.vx = 1;
    if (this.bx === this.w - 4 && this.by >= this.ry && this.by < this.ry + 5) this.vx = -1;
    if (this.bx <= 0 || this.bx >= this.w - 1) {
      this.score[this.bx <= 0 ? 1 : 0] = (this.score[this.bx <= 0 ? 1 : 0] + 1) % 10;
      this.bx = 24;
      this.by = 4 + Math.floor(rnd(this.t, this.seed + 4) * (this.h - 8));
      this.vx = -this.vx;
      this.serve = 8;
    }
  }

  private digit(g: Grid, d: number, x: number, y: number): void {
    DIGITS[d].split(' ').forEach((row, j) => [...row].forEach((ch, i) => ch === 'X' && g.set(x + i, y + j, Col.White, 230, Style.Pixel)));
  }

  draw(g: Grid): void {
    for (let y = 0; y < this.h; y += 2) g.set(Math.floor(this.w / 2), y, Col.White, 120, Style.Pixel);
    for (let k = 0; k < 5; k++) {
      g.set(2, this.ly + k, Col.White, 255, Style.Pixel);
      g.set(this.w - 3, this.ry + k, Col.White, 255, Style.Pixel);
    }
    if (this.serve === 0) g.set(this.bx, this.by, Col.White, 255, Style.Pixel);
    this.digit(g, this.score[0], Math.floor(this.w / 2) - 7, 2);
    this.digit(g, this.score[1], Math.floor(this.w / 2) + 4, 2);
    for (let x = 0; x < this.w; x++) {
      g.set(x, 0, Col.White, 140, Style.Pixel);
      g.set(x, this.h - 1, Col.White, 140, Style.Pixel);
    }
  }
}

// ---------------------------------------------------------------------------
// Snake (LCD phone style)
// ---------------------------------------------------------------------------

export class SnakeSim implements ArcadeSim {
  readonly w = 32;
  readonly h = 18;
  readonly tpb = 4;
  private body: Array<[number, number]> = [];
  private dir: [number, number] = [1, 0];
  private food: [number, number] = [20, 9];
  private grow = 0;
  private seed = 0;
  private t = 0;
  private dead = 0;

  reset(seed: number): void {
    this.seed = seed;
    this.body = [
      [6, 9],
      [5, 9],
      [4, 9],
    ];
    this.dir = [1, 0];
    this.grow = 2;
    this.t = 0;
    this.dead = 0;
    this.placeFood();
  }

  private occupied(x: number, y: number): boolean {
    return x <= 0 || y <= 0 || x >= this.w - 1 || y >= this.h - 1 || this.body.some(([bx, by]) => bx === x && by === y);
  }

  private placeFood(): void {
    for (let k = 0; k < 50; k++) {
      const x = 1 + Math.floor(rnd(this.t * 31 + k, this.seed) * (this.w - 2));
      const y = 1 + Math.floor(rnd(this.t * 17 + k, this.seed + 1) * (this.h - 2));
      if (!this.occupied(x, y)) {
        this.food = [x, y];
        return;
      }
    }
  }

  step(): void {
    this.t++;
    if (this.dead > 0) {
      if (--this.dead === 0) this.reset(this.seed + this.t);
      return;
    }
    const [hx, hy] = this.body[0];
    const opts = DIRS.filter(([dx, dy]) => !(dx === -this.dir[0] && dy === -this.dir[1]) && !this.occupied(hx + dx, hy + dy));
    if (!opts.length) {
      this.dead = 8;
      return;
    }
    // Head for the food, with a little wander so it looks alive.
    opts.sort((a, b) => Math.hypot(hx + a[0] - this.food[0], hy + a[1] - this.food[1]) - Math.hypot(hx + b[0] - this.food[0], hy + b[1] - this.food[1]));
    const pick = rnd(this.t, this.seed + 7) < 0.12 && opts.length > 1 ? opts[1] : opts[0];
    this.dir = [pick[0], pick[1]];
    this.body.unshift([hx + pick[0], hy + pick[1]]);
    if (this.body[0][0] === this.food[0] && this.body[0][1] === this.food[1]) {
      this.grow += 3;
      this.placeFood();
    }
    if (this.grow > 0) this.grow--;
    else this.body.pop();
  }

  draw(g: Grid, beatPhase: number): void {
    for (let x = 0; x < this.w; x++) {
      g.set(x, 0, Col.Lcd, 255, Style.Lcd);
      g.set(x, this.h - 1, Col.Lcd, 255, Style.Lcd);
    }
    for (let y = 0; y < this.h; y++) {
      g.set(0, y, Col.Lcd, 255, Style.Lcd);
      g.set(this.w - 1, y, Col.Lcd, 255, Style.Lcd);
    }
    const blink = this.dead > 0 && this.dead % 2 === 0;
    if (!blink) for (const [x, y] of this.body) g.set(x, y, Col.Lcd, 255, Style.Lcd);
    if (beatPhase < 0.6) g.set(this.food[0], this.food[1], Col.Lcd, 255, Style.Lcd);
  }
}

// ---------------------------------------------------------------------------
// Light-cycle racers
// ---------------------------------------------------------------------------

export class RacersSim implements ArcadeSim {
  readonly w = 64;
  readonly h = 36;
  readonly tpb = 8;
  private trail: number[] = [];
  private racers: Array<Actor & { alive: boolean; respawn: number }> = [];
  private seed = 0;
  private t = 0;

  reset(seed: number): void {
    this.seed = seed;
    this.trail = new Array(this.w * this.h).fill(0);
    const colors = [Col.Cyan, Col.Orange, Col.Pink, Col.Yellow];
    this.racers = colors.map((color, i) => ({ x: i % 2 ? this.w - 8 : 8, y: i < 2 ? 8 : this.h - 9, dx: i % 2 ? -1 : 1, dy: 0, color, alive: true, respawn: 0 }));
    this.t = 0;
  }

  private blocked(x: number, y: number): boolean {
    return x < 0 || y < 0 || x >= this.w || y >= this.h || this.trail[y * this.w + x] !== 0;
  }

  step(): void {
    this.t++;
    this.racers.forEach((r, k) => {
      if (!r.alive) {
        if (--r.respawn <= 0) {
          r.x = 4 + Math.floor(rnd(this.t * 5 + k, this.seed) * (this.w - 8));
          r.y = 4 + Math.floor(rnd(this.t * 7 + k, this.seed + 1) * (this.h - 8));
          r.alive = !this.blocked(r.x, r.y);
          r.respawn = 4;
        }
        return;
      }
      const turn = (left: boolean): [number, number] => (left ? [r.dy, -r.dx] : [-r.dy, r.dx]);
      let [dx, dy] = [r.dx, r.dy];
      const roll = rnd(this.t * 11 + k, this.seed + 2);
      if (this.blocked(r.x + dx, r.y + dy) || roll < 0.06) {
        const options = [turn(true), turn(false)].filter(([a, b]) => !this.blocked(r.x + a, r.y + b));
        if (options.length) [dx, dy] = options[Math.floor(rnd(this.t * 3 + k, this.seed + 3) * options.length)];
      }
      if (this.blocked(r.x + dx, r.y + dy)) {
        // Crash: the trail derezzes.
        r.alive = false;
        r.respawn = 12;
        for (let i = 0; i < this.trail.length; i++) if (this.trail[i] === r.color) this.trail[i] = 0;
        return;
      }
      r.dx = dx;
      r.dy = dy;
      this.trail[r.y * this.w + r.x] = r.color;
      r.x += dx;
      r.y += dy;
    });
  }

  draw(g: Grid): void {
    for (let i = 0; i < this.trail.length; i++) if (this.trail[i]) g.set(i % this.w, Math.floor(i / this.w), this.trail[i], 200, Style.Trail);
    for (const r of this.racers) if (r.alive) g.set(r.x, r.y, Col.White, 255, Style.Pixel);
  }
}
