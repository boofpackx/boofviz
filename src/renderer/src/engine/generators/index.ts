import { Adjust } from './Adjust';
import { ArchiveFootage } from './ArchiveFootage';
import { Background } from './Background';
import { Broadcast } from './Broadcast';
import { Desktop90 } from './Desktop90';
import { BarCity } from './BarCity';
import { CodeRain } from './CodeRain';
import { Concrete } from './Concrete';
import { DemoParts } from './DemoParts';
import { DeStijl } from './DeStijl';
import { Dots } from './Dots';
import type { Generator } from './Generator';
import { GlassMeadow } from './GlassMeadow';
import { KineticType } from './KineticType';
import { Lines } from './Lines';
import { LostScene } from './LostScene';
import { LowPoly } from './LowPoly';
import { LiquidChrome } from './LiquidChrome';
import { Lyrics } from './Lyrics';
import { LyricVideo } from './LyricVideo';
import { Memphis } from './Memphis';
import { MusicChannel } from './MusicChannel';
import { OpArt } from './OpArt';
import { NeoBrutal } from './NeoBrutal';
import { Orb } from './Orb';
import { Pipes } from './Pipes';
import { PlatinumStage } from './PlatinumStage';
import { PixelArcade } from './PixelArcade';
import { Polygon } from './Polygon';
import { Prism } from './Prism';
import { RadialSpectrum } from './RadialSpectrum';
import { Ricochet } from './Ricochet';
import { Scope } from './Scope';
import { Screensaver90 } from './Screensaver90';
import { Spectrogram } from './Spectrogram';
import { SpectrumBars } from './SpectrumBars';
import { SwissGrid } from './SwissGrid';
import { SynthSunset } from './SynthSunset';
import { Tiles } from './Tiles';
import { TwistCube } from './TwistCube';
import { VitalSigns } from './VitalSigns';
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
  lostScene: () => new LostScene(),
  broadcast: () => new Broadcast(),
  adjust: () => new Adjust(),
  archiveFootage: () => new ArchiveFootage(),
  screensaver90: () => new Screensaver90(),
  pipes: () => new Pipes(),
  lowPoly: () => new LowPoly(),
  desktop90: () => new Desktop90(),
  musicChannel: () => new MusicChannel(),
  vitalSigns: () => new VitalSigns(),
  platinumStage: () => new PlatinumStage(),
  concrete: () => new Concrete(),
  neoBrutal: () => new NeoBrutal(),
};

export function createGenerator(kind: string): Generator {
  const f = FACTORIES[kind];
  if (!f) throw new Error(`Unknown generator "${kind}"`);
  return f();
}
