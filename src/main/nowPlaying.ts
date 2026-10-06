import { safeStorage, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '@shared/ipc';
import { EMPTY_LYRICS, type NowPlaying, type SpotifyCommand, type TrackLyrics } from '@shared/lyrics';
import { LyricsService, type TrackInfo } from './lyrics';
import { SpotifyClient, type TokenStore } from './spotify';
import { dataDir, type SettingsStore } from './settingsStore';

const env = (key: string, fallback: string): string => (process.env[key] || fallback).replace(/\/+$/, '');

/**
 * Refresh token in userData, encrypted with the OS keychain (DPAPI / Keychain /
 * libsecret). Without real encryption (e.g. Linux "basic_text") it stays in memory only.
 */
function secureTokenStore(file: string): TokenStore {
  let memory: string | null = null;
  const secure = (): boolean => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  return {
    load: () => {
      if (memory) return memory;
      try {
        if (secure() && existsSync(file)) memory = safeStorage.decryptString(readFileSync(file));
      } catch {
        memory = null;
      }
      return memory;
    },
    save: (token) => {
      memory = token;
      if (!secure()) return;
      try {
        writeFileSync(file, safeStorage.encryptString(token), { mode: 0o600 });
      } catch {
        // Memory only for this session.
      }
    },
    clear: () => {
      memory = null;
      rmSync(file, { force: true });
    },
  };
}

/**
 * Spotify now-playing + lyrics, published to both windows. `broadcast` sends
 * to the control and output windows and replays the latest value whenever one
 * of them (re)loads.
 */
export class NowPlayingService {
  private readonly spotify: SpotifyClient;
  private readonly lyrics: LyricsService;
  private readonly lyricsDir = join(dataDir(), 'lyrics');
  private track: TrackInfo | null = null;
  private current: TrackLyrics = { ...EMPTY_LYRICS };
  private sentArt: string | undefined;

  constructor(
    private readonly store: SettingsStore,
    private readonly broadcast: (channel: string, value: unknown, replay?: unknown) => void,
  ) {
    this.lyrics = new LyricsService({
      fetch: (...a) => fetch(...a),
      now: () => Date.now(),
      lyricsDir: this.lyricsDir,
      cacheDir: join(dataDir(), 'lyrics-cache'),
      baseUrl: env('BOOFVIZ_LRCLIB_URL', 'https://lrclib.net/api'),
      online: () => this.store.get().lyrics.online,
    });
    this.spotify = new SpotifyClient({
      fetch: (...a) => fetch(...a),
      now: () => Date.now(),
      accountsUrl: env('BOOFVIZ_SPOTIFY_ACCOUNTS_URL', 'https://accounts.spotify.com'),
      apiUrl: env('BOOFVIZ_SPOTIFY_API_URL', 'https://api.spotify.com/v1'),
      clientId: () => this.store.get().spotify.clientId,
      tokens: secureTokenStore(join(dataDir(), 'spotify-token.bin')),
      openExternal: async (url) => {
        // Test hook: follow the authorize redirect ourselves instead of opening a browser.
        if (process.env.BOOFVIZ_OPEN_EXTERNAL === 'fetch') void fetch(url).then((r) => r.text()).catch(() => undefined);
        else await shell.openExternal(url);
      },
      publish: (s) => this.publish(s),
      onTrack: (t) => {
        this.track = t && { id: t.id, title: t.title, artists: t.artists, album: t.album, durationMs: t.durationMs };
        void this.loadLyrics();
      },
    });
    let online = this.store.get().lyrics.online;
    this.store.onChange((s) => {
      // Turning online search back on retries a track that had nothing.
      if (s.lyrics.online && !online && this.current.source === 'none') void this.loadLyrics();
      online = s.lyrics.online;
    });
  }

  start(): void {
    this.spotify.start();
  }

  private publish(s: NowPlaying): void {
    // Album art goes out once per track (and in every replay to a reloading window).
    const art = s.artDataUrl !== this.sentArt ? s.artDataUrl : undefined;
    this.sentArt = s.artDataUrl;
    this.broadcast(IPC.nowPlaying, { ...s, artDataUrl: art }, s);
  }

  private setLyrics(l: TrackLyrics): void {
    this.current = l;
    this.broadcast(IPC.lyrics, l);
  }

  private async loadLyrics(): Promise<void> {
    const track = this.track;
    if (!track) return this.setLyrics({ ...EMPTY_LYRICS });
    this.setLyrics({ ...EMPTY_LYRICS, trackId: track.id, loading: true });
    const result = await this.lyrics.lookup(track).catch(() => ({ ...EMPTY_LYRICS, trackId: track.id }));
    if (this.track?.id === track.id) this.setLyrics(result);
  }

  connect(): Promise<void> {
    return this.spotify.connect();
  }

  disconnect(): void {
    this.spotify.disconnect();
  }

  control(cmd: SpotifyCommand): Promise<string | null> {
    return this.spotify.control(cmd);
  }

  snapshot(): { nowPlaying: NowPlaying; lyrics: TrackLyrics } {
    return { nowPlaying: this.spotify.state, lyrics: this.current };
  }

  async openLyricsFolder(): Promise<void> {
    mkdirSync(this.lyricsDir, { recursive: true });
    await shell.openPath(this.lyricsDir);
  }

  /** Attach dropped .lrc text to the current track. Resolves to an error message, or null. */
  async saveLrc(text: string): Promise<string | null> {
    const track = this.track;
    if (!track) return 'Nothing is playing: start a track in Spotify first.';
    if (text.length > 512 * 1024) return 'That file is too large for an .lrc.';
    const l = await this.lyrics.saveLrc(track, text);
    if (!l.synced && !l.plain) return 'No lyrics found in that file.';
    if (this.track?.id === track.id) this.setLyrics(l);
    return null;
  }

  dispose(): void {
    this.spotify.dispose();
  }
}
