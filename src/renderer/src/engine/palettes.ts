/**
 * Curated 5-colour palette packs (sRGB hex). The engine converts to linear
 * before use so gradients blend correctly before tonemapping.
 */
export const PALETTES: Record<string, readonly string[]> = {
  Neon: ['#0b0630', '#3a0ca3', '#f72585', '#4cc9f0', '#e0fbfc'],
  Vaporwave: ['#1a1036', '#5b2a86', '#ff71ce', '#01cdfe', '#fffb96'],
  Acid: ['#050505', '#1b5e20', '#aeea00', '#ffea00', '#f5f5f5'],
  Sunset: ['#1d0f2e', '#6a1b4d', '#e8505b', '#f9a65a', '#ffe8a3'],
  Mono: ['#050505', '#2b2b2b', '#6e6e6e', '#bdbdbd', '#ffffff'],
  Ocean: ['#020c1b', '#0a3d62', '#0f7ea6', '#38d9c3', '#d8fff8'],
  Infrared: ['#0a0000', '#4a0000', '#c1121f', '#ff7b00', '#fff3b0'],
  Pastel: ['#2d2a3e', '#a39fe1', '#f7a8c4', '#a8e6cf', '#fdfd96'],
  'Brutalist B&W': ['#000000', '#000000', '#ffffff', '#ffffff', '#ff2d00'],
  'Film Stock': ['#14110f', '#3d2b1f', '#8a6a4b', '#d9b382', '#f2e8cf'],
};

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Palette as linear-RGB triplets, flattened (5 × 3). */
export function paletteLinear(name: string): Float32Array {
  const hexes = PALETTES[name] ?? PALETTES.Neon;
  const out = new Float32Array(15);
  hexes.forEach((hex, i) => {
    const v = parseInt(hex.slice(1), 16);
    out[i * 3] = srgbToLinear(((v >> 16) & 255) / 255);
    out[i * 3 + 1] = srgbToLinear(((v >> 8) & 255) / 255);
    out[i * 3 + 2] = srgbToLinear((v & 255) / 255);
  });
  return out;
}
