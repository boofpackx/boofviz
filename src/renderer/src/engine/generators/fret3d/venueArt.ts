import type * as THREE from 'three';
import { FONT_HUD, FONT_SECTION } from './hud';
import { hash, paintTexture, poster, title } from './venueKit';

/** The textures the venues are dressed with, painted from code (no images shipped). */

const TAU = Math.PI * 2;

/** Brick wall: staggered courses, a few tones, mortar, soot toward the top. */
export function brickTexture(base: [number, number, number] = [128, 52, 38], repeat: [number, number] = [4, 2]): THREE.CanvasTexture {
  return paintTexture(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#4a423c';
      g.fillRect(0, 0, w, h);
      const bh = 32;
      const bw = 96;
      for (let r = 0; r < h / bh; r++) {
        const off = (r % 2) * (bw / 2);
        for (let c = -1; c < w / bw + 1; c++) {
          const t = 0.65 + hash(r * 131 + c * 17) * 0.5;
          g.fillStyle = `rgb(${base[0] * t},${base[1] * t},${base[2] * t})`;
          g.fillRect(c * bw + off + 3, r * bh + 3, bw - 6, bh - 6);
          g.fillStyle = 'rgba(0,0,0,0.12)';
          g.fillRect(c * bw + off + 3, r * bh + bh - 9, bw - 6, 6);
        }
      }
      const soot = g.createLinearGradient(0, 0, 0, h);
      soot.addColorStop(0, 'rgba(0,0,0,0.35)');
      soot.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = soot;
      g.fillRect(0, 0, w, h);
    },
    repeat,
  );
}

/** An old patterned rug: a dark red field, a navy border, a medallion. */
export function rugTexture(): THREE.CanvasTexture {
  return paintTexture(512, 360, (g, w, h) => {
    g.fillStyle = '#6a1814';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c2448';
    g.fillRect(0, 0, w, 34);
    g.fillRect(0, h - 34, w, 34);
    g.fillRect(0, 0, 34, h);
    g.fillRect(w - 34, 0, 34, h);
    g.strokeStyle = '#d8b878';
    g.lineWidth = 4;
    g.strokeRect(40, 40, w - 80, h - 80);
    g.strokeRect(14, 14, w - 28, h - 28);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = i % 2 ? '#d8b878' : '#8a2a20';
      g.beginPath();
      g.arc(17 + ((w - 34) * i) / 25, 17, 6, 0, TAU);
      g.arc(17 + ((w - 34) * i) / 25, h - 17, 6, 0, TAU);
      g.fill();
    }
    g.save();
    g.translate(w / 2, h / 2);
    for (let k = 4; k > 0; k--) {
      g.fillStyle = k % 2 ? '#1c2448' : '#c8a060';
      g.beginPath();
      g.moveTo(0, -k * 26);
      g.lineTo(k * 44, 0);
      g.lineTo(0, k * 26);
      g.lineTo(-k * 44, 0);
      g.closePath();
      g.fill();
    }
    g.restore();
    // Wear.
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${hash(i) * 0.12})`;
      g.fillRect(hash(i * 3) * w, hash(i * 7) * h, 8, 3);
    }
  });
}

/** A milk crate's side: a plastic grid. */
export function crateTexture(color: string): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.85)';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.fillRect(14 + x * 27, 22 + y * 24, 18, 14);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, 0, w, 8);
  });
}

/** Velvet curtains: folds. */
export function curtainTexture(dark: string, light: string): THREE.CanvasTexture {
  return paintTexture(256, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 10; i++) grd.addColorStop(i / 10, i % 2 ? light : dark);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

/** The garage window at night: blinds, a street lamp out there. */
export function windowTexture(): THREE.CanvasTexture {
  return paintTexture(256, 192, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0c1630');
    sky.addColorStop(1, '#3a3a58');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const lamp = g.createRadialGradient(w * 0.72, h * 0.3, 2, w * 0.72, h * 0.3, h * 0.5);
    lamp.addColorStop(0, 'rgba(255,220,150,1)');
    lamp.addColorStop(0.15, 'rgba(255,180,90,0.5)');
    lamp.addColorStop(1, 'rgba(255,160,80,0)');
    g.fillStyle = lamp;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#05070c';
    g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillRect(w * 0.1, h * 0.62, w * 0.25, h * 0.2);
    g.fillRect(w * 0.45, h * 0.66, w * 0.18, h * 0.16);
    for (let i = 0; i < 16; i++) {
      const y = (i * h) / 16;
      g.fillStyle = 'rgba(200,190,160,0.88)';
      g.fillRect(0, y, w, h / 16 - 4);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, y + h / 16 - 6, w, 2);
    }
  });
}

export function checkerTexture(a = '#e8e4dc', b = '#141414', repeat: [number, number] = [8, 6]): THREE.CanvasTexture {
  return paintTexture(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = a;
      g.fillRect(0, 0, w, h);
      g.fillStyle = b;
      g.fillRect(0, 0, w / 2, h / 2);
      g.fillRect(w / 2, h / 2, w / 2, h / 2);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let i = 0; i < 60; i++) g.fillRect(hash(i) * w, hash(i + 99) * h, 6, 2);
    },
    repeat,
  );
}

/** Stage decking: black boards with gaffer tape marks. */
export function deckTexture(repeat: [number, number] = [6, 3]): THREE.CanvasTexture {
  return paintTexture(
    256,
    256,
    (g, w) => {
      for (let i = 0; i < 8; i++) {
        const t = 14 + hash(i * 5) * 12;
        g.fillStyle = `rgb(${t},${t},${t + 2})`;
        g.fillRect(0, i * 32, w, 32);
        g.fillStyle = '#050505';
        g.fillRect(0, i * 32, w, 2);
      }
      g.fillStyle = 'rgba(230,220,180,0.35)';
      g.fillRect(40, 60, 30, 6);
      g.fillRect(52, 48, 6, 30);
      g.fillRect(180, 170, 36, 6);
    },
    repeat,
  );
}

/** A night sky: dark at the top, a glow at the horizon (the city), stars. */
export function skyTexture(): THREE.CanvasTexture {
  return paintTexture(1024, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#000004');
    grd.addColorStop(0.38, '#04061a');
    grd.addColorStop(0.5, '#22163c');
    grd.addColorStop(0.53, '#3a2240');
    grd.addColorStop(1, '#050308');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const y = hash(i * 3 + 1) * h * 0.48;
      const a = hash(i * 5 + 2) * 0.9 * (1 - y / (h * 0.5));
      g.fillStyle = `rgba(255,255,255,${a})`;
      const s = hash(i * 7) > 0.96 ? 2 : 1;
      g.fillRect(hash(i * 11) * w, y, s, s);
    }
  });
}

/** A soft puff for haze and smoke. */
export function smokeTexture(): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w * (0.25 + hash(i) * 0.5);
      const y = h * (0.25 + hash(i + 50) * 0.5);
      const r = w * (0.12 + hash(i + 90) * 0.18);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.16)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
  });
}

/**
 * A neon sign: `draw` strokes its tubes (a path, or strokeText) and is run
 * several times, wide and faint for the glow, then narrow and white-hot.
 * Shown additively, so the black is see-through.
 */
export function neonTexture(w: number, h: number, color: string, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  return paintTexture(w, h, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [lw, a, c] of [
      [34, 0.08, color],
      [20, 0.18, color],
      [11, 0.55, color],
      [6, 1, color],
      [2.5, 0.9, '#ffffff'],
    ] as const) {
      g.globalAlpha = a;
      g.strokeStyle = c;
      g.lineWidth = lw;
      draw(g);
    }
    g.globalAlpha = 1;
  });
}

/** The amp's logo plate. */
export function plateTexture(text: string): THREE.CanvasTexture {
  return paintTexture(512, 160, (g, w, h) => {
    g.fillStyle = '#0c0c0e';
    g.fillRect(0, 0, w, h);
    const plate = g.createLinearGradient(0, h * 0.25, 0, h * 0.75);
    plate.addColorStop(0, '#f2dc98');
    plate.addColorStop(0.5, '#b08a3a');
    plate.addColorStop(1, '#6a4e1c');
    g.fillStyle = plate;
    g.fillRect(w * 0.06, h * 0.2, w * 0.88, h * 0.6);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = '#1a1a1a';
      g.beginPath();
      g.arc(w * (0.18 + i * 0.13), h * 0.5, h * 0.12, 0, TAU);
      g.fill();
      g.fillStyle = '#e8e8e8';
      g.fillRect(w * (0.18 + i * 0.13) - 2, h * 0.38, 4, h * 0.1);
    }
    title(g, text, w * 0.5, h * 0.5, h * 0.5, '#f8eed0', 'rgba(0,0,0,0.85)');
  });
}

/** A bedsheet banner, spray painted. */
export function bannerTexture(text: string, sub: string): THREE.CanvasTexture {
  return paintTexture(512, 192, (g, w, h) => {
    g.fillStyle = '#e8e2d2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 9; i++) g.fillRect(0, i * 22 + hash(i) * 8, w, 3);
    title(g, text, w / 2, h * 0.45, h * 0.36, '#b81818', 'rgba(20,10,10,0.7)', FONT_SECTION);
    title(g, sub, w / 2, h * 0.82, h * 0.13, '#1a1a1a', 'rgba(0,0,0,0)', FONT_SECTION);
  });
}

export function pizzaTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#d8c09a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b81818';
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.3, 0, TAU);
    g.fill();
    title(g, 'PIZZA', w / 2, h / 2, w * 0.13, '#fff4d8', '#7a1010', FONT_HUD);
    g.fillStyle = 'rgba(120,70,20,0.3)';
    g.beginPath();
    g.arc(w * 0.25, h * 0.75, w * 0.12, 0, TAU);
    g.fill();
  });
}

/** Record sleeves leaning on the crates. */
export function sleeveTexture(seed: number): THREE.CanvasTexture {
  const palettes = [
    ['#1a1a1a', '#e8c41c'],
    ['#e83a1a', '#1a1a1a'],
    ['#2a5ab8', '#f0f0f0'],
    ['#f0e0c0', '#a81818'],
  ];
  const [a, b] = palettes[seed % palettes.length];
  return paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    if (seed % 2) {
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.3, 0, TAU);
      g.fill();
    } else for (let i = 0; i < 5; i++) g.fillRect(0, i * 26 + 6, w, 10);
  });
}

/** Stadium stands far off: rows of people as dots, aisles, a few lights. */
export function standsTexture(): THREE.CanvasTexture {
  return paintTexture(
    512,
    256,
    (g, w, h) => {
      g.fillStyle = '#0a0a10';
      g.fillRect(0, 0, w, h);
      const tones = ['#2a2a36', '#3a2a2a', '#26323a', '#3a3a30', '#46404a'];
      for (let y = 4; y < h; y += 8)
        for (let x = 2; x < w; x += 5) {
          if (x % 128 < 8) continue;
          g.fillStyle = tones[Math.floor(hash(x * 977 + y) * tones.length)];
          g.fillRect(x, y, 3, 5);
        }
    },
    [6, 1],
  );
}

/** The garage's posters (bands made up, gigs long gone). */
export function garagePosters(): THREE.CanvasTexture[] {
  return [
    poster(
      (g, w, h) => {
        const bg = g.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#f08a2a');
        bg.addColorStop(1, '#a8240c');
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#1a0a04';
        g.beginPath();
        g.moveTo(w * 0.58, h * 0.22);
        g.lineTo(w * 0.3, h * 0.58);
        g.lineTo(w * 0.5, h * 0.58);
        g.lineTo(w * 0.38, h * 0.9);
        g.lineTo(w * 0.74, h * 0.48);
        g.lineTo(w * 0.54, h * 0.48);
        g.lineTo(w * 0.68, h * 0.22);
        g.closePath();
        g.fill();
        title(g, 'WILD', w / 2, h * 0.1, w * 0.26, '#fff2c0');
        title(g, 'STATIC', w / 2, h * 0.94, w * 0.2, '#fff2c0');
      },
      256,
      320,
    ),
    poster(
      (g, w, h) => {
        g.fillStyle = '#141838';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#e8c41c';
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 ? w * 0.12 : w * 0.28;
          g.lineTo(w / 2 + Math.cos(a) * r, h * 0.55 + Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
        title(g, 'BRASS', w / 2, h * 0.13, w * 0.24, '#f6d62a', '#000');
        title(g, 'KNUCKLE', w / 2, h * 0.27, w * 0.17, '#f6d62a', '#000');
        title(g, 'FRI 9PM', w / 2, h * 0.9, w * 0.13, '#e8e0d0', '#000', FONT_HUD);
      },
      256,
      316,
    ),
    poster(
      (g, w, h) => {
        g.fillStyle = '#4a1858';
        g.fillRect(0, 0, w, h);
        for (let i = 9; i > 0; i--) {
          g.fillStyle = i % 2 ? '#ff5ab4' : '#ffd23a';
          g.beginPath();
          g.arc(w / 2, h * 0.5, (i / 9) * w * 0.48, 0, TAU);
          g.fill();
        }
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.ellipse(w / 2, h * 0.5, w * 0.14, w * 0.08, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#18082a';
        g.beginPath();
        g.arc(w / 2, h * 0.5, w * 0.06, 0, TAU);
        g.fill();
      },
      256,
      290,
    ),
    poster(
      (g, w, h) => {
        g.fillStyle = '#1c6a6a';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#0a1a1a';
        for (const [px, s] of [
          [0.32, 1],
          [0.68, 0.9],
        ]) {
          g.beginPath();
          g.arc(w * px, h * 0.38, w * 0.09 * s, 0, TAU);
          g.fill();
          g.fillRect(w * (px - 0.1 * s), h * 0.45, w * 0.2 * s, h * 0.4);
        }
        title(g, 'NIGHT', w / 2, h * 0.1, w * 0.22, '#f0f0e0', '#000');
        title(g, 'DRIVERS', w / 2, h * 0.92, w * 0.18, '#f0f0e0', '#000');
      },
      256,
      400,
    ),
    poster(
      (g, w, h) => {
        g.fillStyle = '#e8e2d0';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#121212';
        g.beginPath();
        g.arc(w / 2, h * 0.48, w * 0.24, Math.PI, 0);
        g.lineTo(w * 0.68, h * 0.66);
        g.lineTo(w * 0.32, h * 0.66);
        g.closePath();
        g.fill();
        g.fillStyle = '#e8e2d0';
        g.beginPath();
        g.arc(w * 0.41, h * 0.5, w * 0.06, 0, TAU);
        g.arc(w * 0.59, h * 0.5, w * 0.06, 0, TAU);
        g.fill();
        for (let i = 0; i < 5; i++) g.fillRect(w * (0.35 + i * 0.065), h * 0.66, w * 0.04, h * 0.06);
        title(g, 'TOUR 2005', w / 2, h * 0.12, w * 0.15, '#121212', '#e8e2d0', FONT_HUD);
        title(g, 'BONES', w / 2, h * 0.86, w * 0.22, '#c41a1a', '#000');
      },
      256,
      307,
    ),
  ];
}
