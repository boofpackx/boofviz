import type { Layer, ParamBag, Scene } from './types/engine';

/**
 * The lyric router: one switch for the words on every look. Pure, so the
 * control window decides once and the preview and the output show the same.
 *
 *  - off: no lyrics anywhere, the looks' own lyric layers included.
 *  - own: every look exactly as it was made.
 *  - everywhere: every look shows lyrics, per look in this order:
 *      1. your choice for the look (theme default, its own only, a treatment, never);
 *      2. a look that already shows lyrics stays as it is;
 *      3. a look with its lyrics switched off gets them switched on;
 *      4. otherwise the treatment for its theme goes over the top.
 *
 * Saved looks are never rewritten: the router works on the scene sent to the screens.
 */

export type LyricsMode = 'off' | 'own' | 'everywhere';
export const LYRICS_MODES: Array<{ id: LyricsMode; label: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'own', label: "Looks' own" },
  { id: 'everywhere', label: 'Everywhere' },
];

/** A named lyric style: the overlay's params (kind lyricVideo or lyrics, style, material, font, …). */
export interface LyricTreatment {
  id: string;
  name: string;
  family: string;
  params: ParamBag;
}

const mv = (id: string, name: string, family: string, params: ParamBag): LyricTreatment => ({
  id,
  name,
  family,
  params: { kind: 'lyricVideo', ...params },
});
const classic = (id: string, name: string, params: ParamBag): LyricTreatment => ({
  id,
  name,
  family: 'Classic',
  params: { kind: 'lyrics', ...params },
});

export const TREATMENT_FAMILIES = ['Classic', 'Music video', 'Lyric cinema', '90s & Y2K', 'Neo 90s & vintage', 'Brutalist', 'Hero', 'Yours'] as const;

export const BUILTIN_TREATMENTS: LyricTreatment[] = [
  classic('karaoke', 'Karaoke sweep', {
    mode: 'karaoke',
    position: 'lower',
    size: 0.85,
    backdrop: 0.45,
  }),
  classic('punch', 'Punch-in lines', {
    mode: 'punch',
    position: 'center',
    size: 1,
    backdrop: 0.3,
  }),
  classic('typewriter', 'Typewriter', {
    mode: 'typewriter',
    font: 'mono',
    position: 'lower',
    backdrop: 0.45,
  }),
  mv('drop', 'Drop', 'Music video', { style: 'drop' }),
  mv('slam', 'Slam', 'Music video', { style: 'slam' }),
  mv('pop', 'Pop', 'Music video', { style: 'pop', font: 'rounded' }),
  mv('flip', 'Flip', 'Music video', { style: 'flip' }),
  mv('shuffle', 'Shuffle', 'Music video', { style: 'shuffle' }),
  mv('spin', 'Spin', 'Music video', { style: 'spin3d' }),
  mv('stack', 'Stack', 'Music video', { style: 'stack' }),
  mv('wave', 'Wave', 'Music video', { style: 'wave' }),
  mv('orbit', 'Orbit', 'Music video', { style: 'orbit3d' }),
  mv('zoom', 'Fly-through', 'Music video', { style: 'zoomthrough' }),
  mv('glitch', 'Glitch', 'Music video', { style: 'glitch' }),
  mv('scatter', 'Scatter', 'Music video', { style: 'scatter' }),
  mv('shatter', 'Shatter drop', 'Music video', { style: 'shatterdrop' }),
  mv('jelly', 'Jelly', 'Music video', {
    style: 'jelly',
    material: 'jelly',
    font: 'rounded',
  }),
  mv('highway', 'Highway', 'Lyric cinema', { style: 'highway' }),
  mv('credits', 'Credits', 'Lyric cinema', { style: 'credits' }),
  mv('infomercial', 'Infomercial', 'Lyric cinema', { style: 'infomercial' }),
  mv('teletext', 'Teletext', 'Lyric cinema', { style: 'teletext' }),
  mv('laser', 'Laser show', 'Lyric cinema', { style: 'laser' }),
  mv('explosion', 'Explosion', 'Lyric cinema', { style: 'explosion' }),
  mv('screensaver', 'Screensaver', '90s & Y2K', { style: 'screensaver' }),
  mv('highscore', 'High score', '90s & Y2K', { style: 'highscore' }),
  mv('neonalley', 'Neon alley', '90s & Y2K', { style: 'neonalley' }),
  mv('jcard', 'J-card', '90s & Y2K', { style: 'jcard' }),
  mv('chrome', 'Chrome', '90s & Y2K', {
    style: 'drop',
    material: 'chrome',
    font: 'wide',
  }),
  mv('pixel', 'Pixel pop', '90s & Y2K', {
    style: 'pop',
    material: 'led',
    font: 'pixel',
  }),
  mv('holo', 'Holo', 'Neo 90s & vintage', {
    style: 'pop',
    material: 'holo',
    font: 'rounded',
  }),
  mv('melt', 'Melt', 'Neo 90s & vintage', { style: 'drop', material: 'melt' }),
  mv('glitter', 'Glitter', 'Neo 90s & vintage', { style: 'glitter' }),
  mv('ransom', 'Ransom note', 'Neo 90s & vintage', { style: 'ransom' }),
  mv('letterpress', 'Letterpress', 'Neo 90s & vintage', {
    style: 'stack',
    material: 'paper',
    font: 'garamond',
    colorMode: 'white',
    uppercase: false,
  }),
  mv('stencil', 'Stencil', 'Brutalist', {
    style: 'slam',
    material: 'stencil',
    font: 'wide',
  }),
  mv('mimeo', 'Mimeograph', 'Brutalist', {
    style: 'stack',
    material: 'mimeo',
    font: 'wood',
  }),
  mv('rubdown', 'Rub-down', 'Brutalist', {
    style: 'drop',
    material: 'rubdown',
    font: 'heavy',
  }),
  mv('swiss', 'Swiss grid', 'Brutalist', {
    style: 'stack',
    material: 'plain',
    font: 'heavy',
    colorMode: 'white',
    position: 'upper',
    uppercase: false,
  }),
  // Parts of the hero looks that work over any look.
  { id: 'steps', name: 'Step lane', family: 'Hero', params: { kind: 'stepChart' } },
  { id: 'press', name: 'Printed strip', family: 'Hero', params: { kind: 'hotMetal' } },
  { id: 'tween', name: 'Tweening words', family: 'Hero', params: { kind: 'keyframes' } },
];

/** The treatment each theme gets in Everywhere unless you pick another. */
export const THEME_DEFAULTS: Record<string, string> = {
  Equalizers: 'slam',
  '2D Graphic': 'stack',
  '3D Worlds': 'orbit',
  'Trippy / Psychedelic': 'wave',
  'Mellow / Ambient': 'zoom',
  'Live Action to BPM': 'slam',
  'Cartoon to BPM': 'pop',
  'Random Clips to BPM': 'glitch',
  'Retro / Glitch': 'glitch',
  'Club / Strobe': 'slam',
  'Logo / Branding': 'spin',
  'Icons & Homages': 'stack',
  'Pop Culture': 'drop',
  'Real 90s': 'teletext',
  'Y2K & Aero': 'infomercial',
  'Retro Type': 'credits',
  Lyrics: 'drop',
  'Lost Media': 'credits',
  'Retro TV': 'teletext',
  Brutalist: 'stencil',
  'Neo 90s': 'glitter',
  Vintage: 'jcard',
};
export const FALLBACK_TREATMENT = 'drop';

export function findTreatment(id: string, custom: readonly LyricTreatment[] = []): LyricTreatment | undefined {
  return custom.find((t) => t.id === id) ?? BUILTIN_TREATMENTS.find((t) => t.id === id);
}

/** Per-look choice: theme default, its own only, never, or a treatment id. */
export type LookChoice = 'theme' | 'own' | 'never' | string;

export interface RouteOptions {
  mode: LyricsMode;
  /** The choice for this look (Everywhere only). */
  choice?: LookChoice;
  /** Category → treatment id (missing: THEME_DEFAULTS). */
  themes?: Record<string, string>;
  /** One treatment for every look instead of by theme ('' or missing: by theme). */
  allLooks?: string;
  custom?: readonly LyricTreatment[];
  /** Applied over every added treatment (size multiplier, position). */
  tune?: { size?: number; position?: string };
  /** Overlay params to show instead of everything else (a treatment being tried in the preview). */
  force?: ParamBag | null;
}

/** Generators that are only words. */
const WORD_KINDS = new Set(['lyrics', 'lyricVideo', 'kineticType']);
/** Looks whose words come from `source` ('lyrics' | 'title' | 'text'). */
const SOURCE_KINDS = new Set(['lyricVideo', 'kineticType', 'demoParts', 'desktop90', 'neoBrutal', 'neo90', 'prints', 'tapeDeck', 'sketchScreen', 'stepChart', 'hotMetal', 'keyframes', 'poured', 'beatGames']);
/** Layouts that never print the sung line. */
const WORDLESS: Record<string, string[]> = {
  desktop90: ['pet'],
  neoBrutal: ['numbers', 'stickers', 'eq', 'data'],
};

const P = (l: Layer): ParamBag => l.source.params ?? {};
const src = (l: Layer): string => String(P(l).source ?? 'lyrics');
const wordless = (l: Layer): boolean => !!WORDLESS[l.source.kind]?.includes(String(P(l).mode));

/** Whether an enabled layer shows the sung line (or the song name standing in for it). */
export function showsLyrics(l: Layer): boolean {
  if (!l.enabled) return false;
  const k = l.source.kind;
  const p = P(l);
  if (k === 'lyrics') return true;
  if (k === 'broadcast') return !!p.captions && p.captions !== 'off' && Number(p.lyrics ?? 1) >= 0.5;
  if (!SOURCE_KINDS.has(k) || src(l) === 'text' || wordless(l)) return false;
  if (k === 'neo90') return p.words !== 'off';
  if (k === 'prints') return p.captions !== false;
  if (k === 'demoParts') return p.scroller !== 'off';
  return true;
}

/** Whether a look shows any words at all (lyrics, or text of its own). For playlists and badges. */
export function showsWords(scene: Pick<Scene, 'layers'>): boolean {
  return scene.layers.some((l) => showsLyrics(l) || (l.enabled && WORD_KINDS.has(l.source.kind) && String(P(l).text ?? '').trim() !== ''));
}

const withParams = (l: Layer, params: ParamBag, enabled = l.enabled): Layer => ({
  ...l,
  enabled,
  source: { ...l.source, params: { ...P(l), ...params } },
});

/** The same layer with its lyrics off (null: it has nothing else to show, so hide it). */
function lyricsOff(l: Layer): Layer {
  if (!showsLyrics(l)) return l;
  const k = l.source.kind;
  if (k === 'lyrics' || k === 'lyricVideo' || k === 'kineticType') return { ...l, enabled: false };
  if (k === 'broadcast') return withParams(l, { lyrics: 0 });
  return withParams(l, { source: 'text', text: '' });
}

/** The same layer with its own lyrics switched on, or null when it can't show them. */
function lyricsOn(l: Layer): Layer | null {
  const k = l.source.kind;
  const p = P(l);
  if (k === 'lyrics') return l.enabled ? null : { ...l, enabled: true };
  if (k === 'broadcast') return l.enabled && p.captions && p.captions !== 'off' ? withParams(l, { lyrics: 1 }) : null;
  if (!SOURCE_KINDS.has(k) || wordless(l)) return null;
  // A switched-off word layer comes back on; a look's other layers only when they're showing.
  if (!l.enabled && !(k === 'lyricVideo' || k === 'kineticType')) return null;
  const on: ParamBag = { source: 'lyrics' };
  if (k === 'neo90' && p.words === 'off') on.words = 'line';
  if (k === 'prints') on.captions = true;
  if (k === 'demoParts' && p.scroller === 'off') on.scroller = 'band';
  return withParams(l, on, true);
}

/** The treatment params for a look, with the global fine-tune applied. */
export function treatmentParams(id: string, o: Pick<RouteOptions, 'custom' | 'tune'>): ParamBag {
  const t = findTreatment(id, o.custom) ?? findTreatment(FALLBACK_TREATMENT)!;
  return applyTune({ ...t.params }, o.tune);
}

function applyTune(params: ParamBag, tune: RouteOptions['tune']): ParamBag {
  const size = tune?.size ?? 1;
  if (size !== 1) params.size = Number(params.size ?? (params.kind === 'lyrics' ? 0.8 : 1)) * size;
  if (tune?.position && tune.position !== 'auto') params.position = tune.position;
  return params;
}

/** Which treatment a look gets in Everywhere, by the one-for-all choice or its theme. */
export function themeTreatment(category: string | undefined, o: Pick<RouteOptions, 'themes' | 'allLooks' | 'custom'>): string {
  const pick = o.allLooks || o.themes?.[category ?? ''] || THEME_DEFAULTS[category ?? ''] || FALLBACK_TREATMENT;
  return findTreatment(pick, o.custom) ? pick : FALLBACK_TREATMENT;
}

export type RouteResult = 'none' | 'own' | 'switched-on' | 'themed' | 'chosen' | 'never' | 'off';

/** What the router did to a look, for the status line and the library badges. */
export interface Routed {
  scene: Scene;
  result: RouteResult;
  /** The treatment added over the look (themed / chosen). */
  treatment?: string;
}

export function routeLyrics(scene: Scene, o: RouteOptions): Routed {
  const plain: Scene = { ...scene, lyricOverlay: null };
  const own = scene.layers.some(showsLyrics);
  if (o.mode === 'own') return { scene: plain, result: own ? 'own' : 'none' };
  const strip = (result: RouteResult): Routed => ({
    scene: { ...plain, layers: scene.layers.map(lyricsOff) },
    result,
  });
  if (o.mode === 'off' && !o.force) return strip('off');
  if (o.force) {
    const r = strip('chosen');
    return {
      ...r,
      scene: { ...r.scene, lyricOverlay: applyTune({ ...o.force }, o.tune) },
    };
  }
  const choice = o.choice ?? 'theme';
  if (choice === 'own') return { scene: plain, result: own ? 'own' : 'none' };
  if (choice === 'never') return strip('never');
  if (choice !== 'theme' && findTreatment(choice, o.custom)) {
    const r = strip('chosen');
    return {
      ...r,
      scene: { ...r.scene, lyricOverlay: treatmentParams(choice, o) },
      treatment: choice,
    };
  }
  if (own) return { scene: plain, result: 'own' };
  // Its own lyrics, switched on: the top-most layer that can show them.
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const on = lyricsOn(scene.layers[i]);
    if (!on) continue;
    const layers = scene.layers.slice();
    layers[i] = on;
    return { scene: { ...plain, layers }, result: 'switched-on' };
  }
  const id = themeTreatment(scene.category, o);
  return {
    scene: { ...plain, lyricOverlay: treatmentParams(id, o) },
    result: 'themed',
    treatment: id,
  };
}

/** Short status for a routed look ("own lyrics", "themed: Teletext", …). */
export function describeRoute(r: Pick<Routed, 'result' | 'treatment'>, custom: readonly LyricTreatment[] = []): string {
  const name = r.treatment ? (findTreatment(r.treatment, custom)?.name ?? r.treatment) : '';
  switch (r.result) {
    case 'own':
      return 'its own lyrics';
    case 'switched-on':
      return 'its own lyrics, switched on';
    case 'themed':
      return `themed: ${name}`;
    case 'chosen':
      return `your pick: ${name}`;
    case 'never':
      return 'never (your pick)';
    case 'off':
      return 'none (lyrics off)';
    default:
      return 'no lyrics';
  }
}
