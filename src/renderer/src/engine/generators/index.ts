import { Adjust } from './Adjust';
import { ArchiveFootage } from './ArchiveFootage';
import { Background } from './Background';
import { Broadcast } from './Broadcast';
import { Desktop90 } from './Desktop90';
import { BarCity } from './BarCity';
import { CodeRain } from './CodeRain';
import { Concrete } from './Concrete';
import { Demo80 } from './Demo80';
import { DemoParts } from './DemoParts';
import { DeStijl } from './DeStijl';
import { Dots } from './Dots';
import { FretHighway } from './FretHighway';
import type { Generator } from './Generator';
import { GlassMeadow } from './GlassMeadow';
import { KineticType } from './KineticType';
import { Lines } from './Lines';
import { Loader8 } from './Loader8';
import { LostScene } from './LostScene';
import { LowPoly } from './LowPoly';
import { LiquidChrome } from './LiquidChrome';
import { Lyrics } from './Lyrics';
import { LyricVideo } from './LyricVideo';
import { Memphis } from './Memphis';
import { MusicChannel } from './MusicChannel';
import { OpArt } from './OpArt';
import { NeoBrutal } from './NeoBrutal';
import { ClipEngine } from './ClipEngine';
import { Neo90 } from './Neo90';
import { Prints } from './Prints';
import { StepChart } from './StepChart';
import { HotMetal } from './HotMetal';
import { Hifi80 } from './Hifi80';
import { Keyframes } from './Keyframes';
import { Poured } from './Poured';
import { BeatGames } from './BeatGames';
import { SketchScreen } from './SketchScreen';
import { TapeDeck } from './TapeDeck';
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
import { Vector80 } from './Vector80';
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
  hifi80: () => new Hifi80(),
  vector80: () => new Vector80(),
  loader8: () => new Loader8(),
  demo80: () => new Demo80(),
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
  neo90: () => new Neo90(),
  prints: () => new Prints(),
  tapeDeck: () => new TapeDeck(),
  sketchScreen: () => new SketchScreen(),
  stepChart: () => new StepChart(),
  hotMetal: () => new HotMetal(),
  keyframes: () => new Keyframes(),
  poured: () => new Poured(),
  beatGames: () => new BeatGames(),
  fretHighway: () => new FretHighway(),
  clipEngine: () => new ClipEngine(),
};

export function createGenerator(kind: string): Generator {
  const f = FACTORIES[kind];
  if (!f) throw new Error(`Unknown generator "${kind}"`);
  return f();
}
