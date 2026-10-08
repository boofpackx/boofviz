// Bundled typefaces (open licence, shipped with the app so every machine draws
// the same letters). Each weight file covers Latin, Latin Extended and Cyrillic
// through unicode ranges, so only the parts a lyric needs are loaded.
import '@fontsource/rubik/900.css';
import '@fontsource/russo-one/400.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/700.css';
import '@fontsource/oswald/700.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/unbounded/900.css';

/** The faces to load before any text atlas is drawn (canvas text doesn't wait for fonts). */
const FACES = ['900 40px Rubik', '400 40px "Russo One"', '400 40px "EB Garamond"', '700 40px "EB Garamond"', '700 40px Oswald', '700 40px "Pixelify Sans"', '900 40px Unbounded'];
const SAMPLE = 'AaZz09 Жж';

let ready: Promise<void> | null = null;

/** Load the bundled faces (once). Never rejects; gives up after `timeoutMs`. */
export function preloadFonts(timeoutMs = 3000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  ready ??= Promise.race([Promise.all(FACES.map((f) => document.fonts.load(f, SAMPLE).catch(() => []))).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  return ready;
}
