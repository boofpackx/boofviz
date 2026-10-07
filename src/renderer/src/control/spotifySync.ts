import { lyricsFeed } from '@/engine/lyricsFeed';
import { AudioChangeDetector } from './audioChange';
import { engine } from './runtime';

/** Watch the analysis and nudge Spotify when the music changes (control window only). */
export function startSpotifyAutoSync(): () => void {
  const det = new AudioChangeDetector();
  let last = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (!lyricsFeed.now.connected || !engine.builder.connected) return;
    if (det.update(now, engine.builder.frame, dt)) void window.boofviz.spotifyControl('sync');
  }, 100);
  return () => window.clearInterval(timer);
}
