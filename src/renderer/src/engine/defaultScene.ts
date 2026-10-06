import type { Scene } from '@shared/types/engine';

/** Phase 1 scene: a single spectrum-bar EQ layer on the Neon palette. */
export const DEFAULT_SCENE: Scene = {
  palette: 'Neon',
  layers: [
    {
      id: 'eq',
      name: 'Spectrum EQ',
      enabled: true,
      source: { type: 'generator', kind: 'spectrumBars', params: { bars: 64, gap: 0.28, height: 0.58, horizon: 0.3, glow: 0.6 } },
      fx: [],
      blend: 'normal',
      opacity: 1,
      modulators: [],
    },
  ],
};
