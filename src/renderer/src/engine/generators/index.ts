import { Background } from './Background';
import { BarCity } from './BarCity';
import type { Generator } from './Generator';
import { KineticType } from './KineticType';
import { Lines } from './Lines';
import { Memphis } from './Memphis';
import { Polygon } from './Polygon';
import { RadialSpectrum } from './RadialSpectrum';
import { Scope } from './Scope';
import { SpectrumBars } from './SpectrumBars';
import { Spectrogram } from './Spectrogram';
import { SwissGrid } from './SwissGrid';
import { Tiles } from './Tiles';

const FACTORIES: Record<string, () => Generator> = {
  spectrumBars: () => new SpectrumBars(),
  radialSpectrum: () => new RadialSpectrum(),
  barCity: () => new BarCity(),
  spectrogram: () => new Spectrogram(),
  scope: () => new Scope(),
  lines: () => new Lines(),
  polygon: () => new Polygon(),
  swissGrid: () => new SwissGrid(),
  tiles: () => new Tiles(),
  memphis: () => new Memphis(),
  kineticType: () => new KineticType(),
  background: () => new Background(),
};

export function createGenerator(kind: string): Generator {
  const f = FACTORIES[kind];
  if (!f) throw new Error(`Unknown generator "${kind}"`);
  return f();
}
