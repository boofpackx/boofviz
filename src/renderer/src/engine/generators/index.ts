import { Background } from './Background';
import { BarCity } from './BarCity';
import { CodeRain } from './CodeRain';
import { DemoParts } from './DemoParts';
import { DeStijl } from './DeStijl';
import { Dots } from './Dots';
import type { Generator } from './Generator';
import { GlassMeadow } from './GlassMeadow';
import { KineticType } from './KineticType';
import { Lines } from './Lines';
import { LiquidChrome } from './LiquidChrome';
import { Lyrics } from './Lyrics';
import { LyricVideo } from './LyricVideo';
import { Memphis } from './Memphis';
import { OpArt } from './OpArt';
import { Orb } from './Orb';
import { PixelArcade } from './PixelArcade';
import { Polygon } from './Polygon';
import { Prism } from './Prism';
import { RadialSpectrum } from './RadialSpectrum';
import { Ricochet } from './Ricochet';
import { Scope } from './Scope';
import { Spectrogram } from './Spectrogram';
import { SpectrumBars } from './SpectrumBars';
import { SwissGrid } from './SwissGrid';
import { SynthSunset } from './SynthSunset';
import { Tiles } from './Tiles';
import { TwistCube } from './TwistCube';
import { Warp } from './Warp';

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
  lyrics: () => new Lyrics(),
  lyricVideo: () => new LyricVideo(),
  prism: () => new Prism(),
  synthSunset: () => new SynthSunset(),
  opArt: () => new OpArt(),
  dots: () => new Dots(),
  glassMeadow: () => new GlassMeadow(),
  deStijl: () => new DeStijl(),
  pixelArcade: () => new PixelArcade(),
  demoParts: () => new DemoParts(),
  codeRain: () => new CodeRain(),
  warp: () => new Warp(),
  orb: () => new Orb(),
  liquidChrome: () => new LiquidChrome(),
  ricochet: () => new Ricochet(),
  twistCube: () => new TwistCube(),
  background: () => new Background(),
};

export function createGenerator(kind: string): Generator {
  const f = FACTORIES[kind];
  if (!f) throw new Error(`Unknown generator "${kind}"`);
  return f();
}
