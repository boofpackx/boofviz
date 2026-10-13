/**
 * Art for the fret highway: the gems, fret buttons, flames and glows drawn
 * once into small canvases (sprites) and stamped every frame, the board
 * textures for each venue, and the chrome HUD panels of a mid-2000s console
 * game. Everything is drawn here from code: no images.
 */

export const LANE_COLORS: Array<[string, string, string]> = [
  // [light, colour, dark]
  ['#9dff9a', '#22d23c', '#0a6a19'],
  ['#ff9a8e', '#ec2228', '#7a0a10'],
  ['#fff59a', '#f7dc1c', '#8c7404'],
  ['#9cc4ff', '#2a6ff2', '#0d2f88'],
  ['#ffcf8a', '#ff8414', '#8c3c00'],
];
/** Notes and frets in star power. */
export const POWER: [string, string, string] = ['#ffffff', '#79d2ff', '#1a6cc8'];

export const FONT_SECTION = '"Rock Salt", "Permanent Marker", cursive';
export const FONT_TITLE = '"New Rocker", "Russo One", serif';
export const FONT_HUD = 'Bungee, "Russo One", Impact, sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, squash: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.46 : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * squash;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

/** Sprite sizes: a gem is GEM_W × GEM_H with its centre (where it sits on the board) at GEM_CX, GEM_CY. */
export const GEM_W = 160;
export const GEM_H = 120;
export const GEM_CX = 80;
export const GEM_CY = 66;
/** Half the gem's width in sprite pixels (scale the sprite so this matches the lane). */
export const GEM_RX = 70;

/** A note gem: a chrome puck with a glossy coloured cap (a star for star-phrase notes). */
export function gemSprite(col: [string, string, string], star: boolean): HTMLCanvasElement {
  const [c, g] = canvas(GEM_W, GEM_H);
  const cx = GEM_CX;
  const cy = GEM_CY;
  // Soft contact shadow on the board.
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.ellipse(cx, cy + 20, 74, 30, 0, 0, Math.PI * 2);
  g.fill();
  if (star) {
    // Chrome side of the star, then the coloured top.
    for (let k = 14; k >= 0; k -= 2) {
      starPath(g, cx, cy + k * 0.6 - 4, 72, 0.5);
      g.fillStyle = k ? `rgb(${120 + k * 6},${120 + k * 6},${136 + k * 6})` : '#e8e8f2';
      g.fill();
    }
    starPath(g, cx, cy - 10, 64, 0.5);
    const grd = g.createRadialGradient(cx - 14, cy - 24, 4, cx, cy - 10, 70);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.35, col[0]);
    grd.addColorStop(0.8, col[1]);
    grd.addColorStop(1, col[2]);
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
    return c;
  }
  // Chrome base: a short cylinder.
  const side = g.createLinearGradient(cx - 70, 0, cx + 70, 0);
  side.addColorStop(0, '#4c4c58');
  side.addColorStop(0.3, '#f6f6fa');
  side.addColorStop(0.55, '#b8b8c6');
  side.addColorStop(1, '#3e3e48');
  g.fillStyle = side;
  g.beginPath();
  g.ellipse(cx, cy + 10, 70, 30, 0, 0, Math.PI);
  g.lineTo(cx - 70, cy - 4);
  g.ellipse(cx, cy - 4, 70, 30, 0, Math.PI, 0, true);
  g.closePath();
  g.fill();
  g.fillStyle = '#d8d8e2';
  g.beginPath();
  g.ellipse(cx, cy - 4, 70, 30, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.stroke();
  // The coloured cap with its gloss.
  const capY = cy - 10;
  g.beginPath();
  g.ellipse(cx, capY, 60, 25, 0, 0, Math.PI * 2);
  const cap = g.createRadialGradient(cx - 18, capY - 12, 3, cx, capY, 64);
  cap.addColorStop(0, '#ffffff');
  cap.addColorStop(0.18, col[0]);
  cap.addColorStop(0.62, col[1]);
  cap.addColorStop(1, col[2]);
  g.fillStyle = cap;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = col[2];
  g.stroke();
  // A dark centre dimple, then the highlight.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.ellipse(cx, capY + 2, 22, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.ellipse(cx - 24, capY - 10, 20, 6, -0.18, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** A fret button: a black disc in a coloured ring on a chrome rim; lit when pressed. */
export function fretSprite(col: [string, string, string], pressed: boolean): HTMLCanvasElement {
  const [c, g] = canvas(GEM_W, GEM_H);
  const cx = GEM_CX;
  const cy = GEM_CY;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.ellipse(cx, cy + 8, 78, 36, 0, 0, Math.PI * 2);
  g.fill();
  const rim = g.createLinearGradient(cx - 74, cy - 34, cx + 74, cy + 34);
  rim.addColorStop(0, '#f2f2f8');
  rim.addColorStop(0.5, '#7a7a88');
  rim.addColorStop(1, '#d6d6e0');
  g.fillStyle = rim;
  g.beginPath();
  g.ellipse(cx, cy, 74, 34, 0, 0, Math.PI * 2);
  g.fill();
  const ring = g.createLinearGradient(0, cy - 30, 0, cy + 30);
  ring.addColorStop(0, col[0]);
  ring.addColorStop(0.5, col[1]);
  ring.addColorStop(1, col[2]);
  g.fillStyle = ring;
  g.beginPath();
  g.ellipse(cx, cy, 66, 30, 0, 0, Math.PI * 2);
  g.fill();
  // The disc: pressed, it lights in the lane colour.
  const disc = g.createRadialGradient(cx - 10, cy - 8, 2, cx, cy, 52);
  if (pressed) {
    disc.addColorStop(0, '#ffffff');
    disc.addColorStop(0.35, col[0]);
    disc.addColorStop(1, col[1]);
  } else {
    disc.addColorStop(0, '#3a3a42');
    disc.addColorStop(0.6, '#121216');
    disc.addColorStop(1, '#050507');
  }
  g.fillStyle = disc;
  g.beginPath();
  g.ellipse(cx, cy + (pressed ? 3 : 0), 50, 22, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.ellipse(cx - 26, cy - 9, 16, 4, -0.15, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** One tongue of fire: white at the root, through yellow and orange to a red, clear tip. */
export function flameSprite(): HTMLCanvasElement {
  const [c, g] = canvas(128, 256);
  const tongue = (x: number, w: number, top: number, alpha: number): void => {
    g.save();
    g.globalAlpha = alpha;
    g.beginPath();
    g.moveTo(x, top);
    g.bezierCurveTo(x + w * 0.2, top + 70, x + w, 150, x + w * 0.62, 226);
    g.quadraticCurveTo(x, 252, x - w * 0.62, 226);
    g.bezierCurveTo(x - w, 150, x - w * 0.2, top + 70, x, top);
    g.closePath();
    const grd = g.createLinearGradient(0, 250, 0, top);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.16, 'rgba(255,236,120,1)');
    grd.addColorStop(0.45, 'rgba(255,140,20,0.95)');
    grd.addColorStop(0.8, 'rgba(220,40,0,0.6)');
    grd.addColorStop(1, 'rgba(160,0,0,0)');
    g.fillStyle = grd;
    g.fill();
    g.restore();
  };
  tongue(64, 52, 8, 0.85);
  tongue(46, 30, 60, 0.8);
  tongue(84, 30, 48, 0.8);
  tongue(64, 26, 90, 1);
  return c;
}

/** A soft round glow in a colour (for flashes, lights and star power). */
export function glowSprite(color: string, size = 128): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, color);
  grd.addColorStop(0.25, color.replace(/[\d.]+\)$/, '0.55)'));
  grd.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export const BOARD_W = 256;
export const BOARD_H = 512;

/** The highway's surface for a venue; tiles along its length (BOARD_H texels per two beats). */
export function boardTexture(venue: string): HTMLCanvasElement {
  const [c, g] = canvas(BOARD_W, BOARD_H);
  const W = BOARD_W;
  const H = BOARD_H;
  const r = (k: number): number => hash(k * 7919 + venue.length * 104729);
  if (venue === 'arena') {
    // Black stage deck: steel tread plate.
    g.fillStyle = '#121216';
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 24)
      for (let x = (y / 24) % 2 ? 12 : 0; x < W; x += 24) {
        g.save();
        g.translate(x + 6, y + 6);
        g.rotate(((x + y) / 24) % 2 ? 0.8 : -0.8);
        g.fillStyle = 'rgba(120,120,140,0.16)';
        g.fillRect(-7, -1.6, 14, 3.2);
        g.restore();
      }
    const sheen = g.createLinearGradient(0, 0, W, 0);
    sheen.addColorStop(0, 'rgba(0,0,0,0.5)');
    sheen.addColorStop(0.5, 'rgba(90,70,120,0.12)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, W, H);
  } else if (venue === 'neon') {
    g.fillStyle = '#120626';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,60,200,0.35)';
    g.lineWidth = 2;
    for (let x = 0; x <= W; x += W / 5) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    g.strokeStyle = 'rgba(60,230,255,0.22)';
    for (let y = 0; y < H; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
  } else if (venue === 'stadium') {
    g.fillStyle = '#0d1018';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${150 + r(i) * 100},${160 + r(i + 1) * 90},${200 + r(i + 2) * 55},${0.05 + r(i + 3) * 0.12})`;
      g.fillRect(r(i + 4) * W, r(i + 5) * H, 1 + r(i + 6) * 2, 1);
    }
    const sheen = g.createLinearGradient(0, 0, W, 0);
    sheen.addColorStop(0, 'rgba(0,0,0,0.55)');
    sheen.addColorStop(0.5, 'rgba(120,140,190,0.1)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, W, H);
  } else {
    // Garage: old dark planks running down the neck, grain and knots.
    const planks = 6;
    for (let p = 0; p < planks; p++) {
      const x0 = (p * W) / planks;
      const tone = 26 + r(p) * 16;
      g.fillStyle = `rgb(${tone + 16},${tone * 0.62},${tone * 0.4})`;
      g.fillRect(x0, 0, W / planks, H);
      for (let k = 0; k < 40; k++) {
        const gx = x0 + r(p * 100 + k) * (W / planks);
        g.strokeStyle = `rgba(${r(k) > 0.5 ? '0,0,0' : '120,70,40'},${0.12 + r(p * 50 + k) * 0.18})`;
        g.lineWidth = 1 + r(k + p) * 1.5;
        g.beginPath();
        g.moveTo(gx, 0);
        for (let y = 0; y <= H; y += 32) g.lineTo(gx + Math.sin(y / 60 + k) * 3 * r(k + 9), y);
        g.stroke();
      }
      // A knot or two.
      for (let k = 0; k < 2; k++) {
        const kx = x0 + (0.3 + r(p * 7 + k) * 0.4) * (W / planks);
        const ky = r(p * 13 + k) * H;
        g.fillStyle = 'rgba(10,4,2,0.5)';
        g.beginPath();
        g.ellipse(kx, ky, 4, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
      // Seams between planks, and plank ends.
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(x0, 0, 2, H);
      g.fillRect(x0, r(p + 40) * H, W / planks, 2);
    }
    const sheen = g.createLinearGradient(0, 0, W, 0);
    sheen.addColorStop(0, 'rgba(0,0,0,0.55)');
    sheen.addColorStop(0.5, 'rgba(255,190,120,0.05)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, W, H);
  }
  return c;
}

/** A chrome-framed panel with a dark inset (the console HUD look). */
export function chromePanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, inset = '#120c22'): void {
  const round = (px: number, py: number, pw: number, ph: number, pr: number): void => {
    g.beginPath();
    g.roundRect(px, py, pw, ph, pr);
  };
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.5)';
  round(x + r * 0.3, y + r * 0.45, w, h, r);
  g.fill();
  const frame = g.createLinearGradient(x, y, x, y + h);
  frame.addColorStop(0, '#fbfbff');
  frame.addColorStop(0.45, '#8c8c9c');
  frame.addColorStop(0.55, '#5a5a68');
  frame.addColorStop(1, '#d0d0dc');
  g.fillStyle = frame;
  round(x, y, w, h, r);
  g.fill();
  const b = Math.max(2, Math.min(w, h) * 0.07);
  const inner = g.createLinearGradient(x, y + b, x, y + h - b);
  inner.addColorStop(0, inset);
  inner.addColorStop(1, '#030206');
  g.fillStyle = inner;
  round(x + b, y + b, w - b * 2, h - b * 2, Math.max(1, r - b));
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
