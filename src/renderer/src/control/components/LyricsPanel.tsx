import { measuredDelayMs } from '@shared/settings';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { positionAt, SPOTIFY_REDIRECT_URI, type SpotifyCommand } from '@shared/lyrics';
import { lyricAt } from '@/engine/lyricsFeed';
import { useControl } from '../store';
import { useTicker } from '../hooks';
import { Button, Section, Slider, Toggle } from './ui';
import { ModeSection, StyleSection, ThemesSection, ThisLookSection } from './LyricStyles';
import { currentRouted } from '../lyricsMode';

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SOURCE_LABEL = { file: 'your .lrc file', cache: 'LRCLIB (cached)', lrclib: 'LRCLIB', none: 'not found' } as const;

const JUMPS: Array<[string, string]> = [
  ['ly-mode', 'Mode'],
  ['ly-style', 'Style'],
  ['ly-themes', 'Themes'],
  ['ly-look', 'This look'],
  ['ly-timing', 'Timing'],
  ['ly-sources', 'Sources'],
  ['ly-music', 'Music'],
];

/** Lyrics mode and styles, timing, sources, and the music being followed. */
export function LyricsPanel() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <nav className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-ink-700/70 bg-ink-900/95 px-3 py-1.5">
        {JUMPS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-ink-100"
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {label}
          </button>
        ))}
      </nav>
      <div id="ly-mode">
        <ModeSection />
      </div>
      <div id="ly-style">
        <StyleSection />
      </div>
      <div id="ly-themes">
        <ThemesSection />
      </div>
      <div id="ly-look">
        <ThisLookSection />
      </div>
      <LyricsSection />
      <div id="ly-music">
        <SpotifySection />
        <NowPlayingSection />
      </div>
    </div>
  );
}

function SpotifySection() {
  const clientId = useControl((s) => s.settings.spotify.clientId);
  const np = useControl((s) => s.nowPlaying);
  const update = useControl((s) => s.update);
  const [draft, setDraft] = useState(clientId);
  const [copied, setCopied] = useState(false);
  useEffect(() => setDraft(clientId), [clientId]);
  const commit = (): void => {
    if (draft.trim() !== clientId) update({ spotify: { clientId: draft.trim() } });
  };
  const windows = window.boofviz.platform === 'win32';
  // Following the player through Windows alone (no login) counts as connected, but isn't a Spotify login.
  const loggedIn = np.connected && np.source !== 'media';
  const status = loggedIn ? 'Logged in to Spotify' : np.connecting ? 'Waiting for the browser login…' : np.connected ? `Following ${np.player || 'your player'}` : windows ? 'Waiting for music' : 'Not connected';

  const login = (
    <>
      <p className="text-[11px] leading-snug text-ink-400">
        Create an app at developer.spotify.com/dashboard, add this redirect URI, select Web API, then paste its Client ID here.
      </p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded border border-ink-700 bg-ink-850 px-1.5 py-1 font-mono text-[10px] text-ink-200">{SPOTIFY_REDIRECT_URI}</code>
        <Button
          title="Copy the redirect URI"
          onClick={() => {
            void navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <input
        type="text"
        spellCheck={false}
        placeholder="Spotify Client ID"
        value={draft}
        disabled={loggedIn}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="w-full rounded border border-ink-600 bg-ink-850 px-2 py-1 font-mono text-[11px] text-ink-100 placeholder:text-ink-500 disabled:opacity-50"
      />
      <div className="flex gap-2">
        {loggedIn ? (
          <Button onClick={() => void window.boofviz.spotifyDisconnect()}>Disconnect</Button>
        ) : (
          <Button
            tone="accent"
            onClick={() => {
              commit();
              void window.boofviz.spotifyConnect();
            }}
          >
            {np.connecting ? 'Retry' : 'Connect'}
          </Button>
        )}
      </div>
      {np.error && <p className="text-[11px] leading-snug text-bad">{np.error}</p>}
    </>
  );

  return (
    <Section title="Music" right={<span className={`text-[10px] ${np.connected ? 'text-ok' : 'text-ink-400'}`}>{status}</span>}>
      {windows && !loggedIn ? (
        <>
          <p className="text-[11px] leading-snug text-ink-400">
            BOOFVIZ follows whatever is playing (Spotify, TIDAL, Apple Music, a browser…) through Windows: no login needed. Song, position, cover and play / pause / skip all work, with Spotify Free too.
          </p>
          <details className="text-[11px] text-ink-400">
            <summary className="cursor-pointer select-none text-ink-300">Optional: log in to Spotify for exact song names and timing</summary>
            <div className="mt-2 space-y-2">{login}</div>
          </details>
        </>
      ) : (
        login
      )}
    </Section>
  );
}

function NowPlayingSection() {
  useTicker(4);
  const np = useControl((s) => s.nowPlaying);
  const [err, setErr] = useState<string | null>(null);
  if (!np.connected) return null;
  const pos = positionAt(np, Date.now());
  const send = (cmd: SpotifyCommand): void => {
    void window.boofviz.spotifyControl(cmd).then(setErr);
  };
  return (
    <Section title="Now playing">
      {np.title ? (
        <div className="flex gap-2">
          {np.artDataUrl ? <img src={np.artDataUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" /> : <div className="h-14 w-14 shrink-0 rounded bg-ink-800" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-ink-100" title={np.title}>
              {np.title}
            </div>
            <div className="truncate text-[11px] text-ink-300">{np.artists.join(', ')}</div>
            <div className="truncate text-[11px] text-ink-400">
              {np.album}
              {np.source === 'media' && np.player ? <span className="text-ink-500">{np.album ? ' · ' : ''}via {np.player}</span> : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-ink-400">Nothing playing.</p>
      )}
      {np.durationMs > 0 && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-400 tabular-nums">{fmt(pos)}</span>
          <div className="h-1 flex-1 overflow-hidden rounded bg-ink-700">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, (pos / np.durationMs) * 100)}%` }} />
          </div>
          <span className="font-mono text-[10px] text-ink-400 tabular-nums">{fmt(np.durationMs)}</span>
        </div>
      )}
      <div className="flex gap-1">
        <Button className="flex-1" title="Previous track" onClick={() => send('previous')}>
          Prev
        </Button>
        <Button className="flex-1" title={np.playing ? 'Pause' : 'Resume'} onClick={() => send(np.playing ? 'pause' : 'play')}>
          {np.playing ? 'Pause' : 'Play'}
        </Button>
        <Button className="flex-1" title="Next track" onClick={() => send('next')}>
          Next
        </Button>
      </div>
      {err && <p className="text-[11px] leading-snug text-warn">{err}</p>}
    </Section>
  );
}

function LyricsSection() {
  useTicker(8);
  const np = useControl((s) => s.nowPlaying);
  const lyrics = useControl((s) => s.trackLyrics);
  const settings = useControl((s) => s.settings.lyrics);
  const update = useControl((s) => s.update);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const routedLead = currentRouted().scene.lyricOverlay?.lead;
  const lead = typeof routedLead === 'number' ? routedLead : 150;
  const cur = lyricAt(Date.now(), lead);
  const forTrack = !!np.trackId && lyrics.trackId === np.trackId;
  const status = !np.trackId
    ? 'No track'
    : !forTrack || lyrics.loading
      ? 'Searching…'
      : lyrics.synced
        ? `Synced · ${SOURCE_LABEL[lyrics.source]}`
        : lyrics.instrumental
          ? 'Instrumental'
          : lyrics.plain
            ? `No timestamps, timing estimated · ${SOURCE_LABEL[lyrics.source]}`
            : 'No lyrics found';

  const attach = (file: File | undefined): void => {
    if (!file) return;
    if (!/\.lrc$/i.test(file.name) || file.size > 512 * 1024) {
      setDropMsg('Drop an .lrc file.');
      return;
    }
    void file
      .text()
      .then((text) => window.boofviz.saveLyricsForCurrentTrack(text))
      .then((e) => setDropMsg(e ?? `Attached ${file.name}`));
  };
  const offset = (v: number): void => update({ lyrics: { offsetMs: Math.max(-10000, Math.min(10000, Math.round(v))) } });

  return (
    <>
      <div id="ly-timing">
        <Section title="Timing" right={<span className="text-[10px] text-ink-400">{status}</span>}>
          <div className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
            <div className="min-h-[16px] truncate text-ink-100" data-testid="lyrics-current">
              {cur.text || (forTrack && (lyrics.synced || lyrics.plain) ? '♪' : '—')}
            </div>
            <div className="min-h-[14px] truncate text-[11px] text-ink-400">{cur.next}</div>
          </div>
          <Slider label="Offset" value={settings.offsetMs} min={-10000} max={10000} step={50} defaultValue={0} format={(v) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(2)} s`} onChange={offset} />
          <div className="flex items-center gap-1">
            <Button onClick={() => offset(settings.offsetMs - 1000)} title="Lyrics 1 s later">
              −1 s
            </Button>
            <Button onClick={() => offset(settings.offsetMs - 100)} title="Lyrics 0.1 s later">
              −0.1
            </Button>
            <Button onClick={() => offset(settings.offsetMs + 100)} title="Lyrics 0.1 s earlier">
              +0.1
            </Button>
            <Button onClick={() => offset(settings.offsetMs + 1000)} title="Lyrics 1 s earlier">
              +1 s
            </Button>
            <span className="ml-1 text-[10px] leading-tight text-ink-400">− = later (more delay)</span>
          </div>
          <Toggle
            label="Automatic timing"
            hint="Measures, at the start of each song, how late it's heard compared with what the player says, and moves the lyrics to match (the offset above fine-tunes on top)"
            checked={settings.autoTiming}
            onChange={(autoTiming) => update({ lyrics: { autoTiming } })}
          />
          {settings.autoTiming && (
            <div className="flex items-center gap-2 text-[11px] text-ink-400">
              <span className="flex-1">
                {settings.timing.length >= 3
                  ? `Songs are heard ${(Math.abs(measuredDelayMs(settings.timing)) / 1000).toFixed(2)} s ${measuredDelayMs(settings.timing) >= 0 ? 'after' : 'before'} the player says (${settings.timing.length} songs)`
                  : `Measuring: ${settings.timing.length} of 3 songs (each song played from the start counts)`}
              </span>
              {settings.timing.length > 0 && <Button onClick={() => update({ lyrics: { timing: [] } })}>Reset</Button>}
            </div>
          )}
        </Section>
      </div>
      <div id="ly-sources">
        <Section title="Sources">
          <Toggle label="Search lyrics online" hint="Look up synced lyrics on LRCLIB when there's no local .lrc" checked={settings.online} onChange={(online) => update({ lyrics: { online } })} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
            onDragOver={(e: DragEvent) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              e.stopPropagation();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(false);
              attach(e.dataTransfer.files[0]);
            }}
            className={`cursor-pointer rounded border border-dashed px-3 py-2 text-center text-[11px] transition-colors ${over ? 'border-accent/70 bg-accent/5 text-ink-200' : 'border-ink-600 text-ink-400 hover:border-ink-400'}`}
          >
            Drop an .lrc file to attach it to this track
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".lrc"
            className="hidden"
            onChange={(e) => {
              attach(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {dropMsg && <p className="text-[11px] text-ink-300">{dropMsg}</p>}
          <Button onClick={() => void window.boofviz.openLyricsFolder()} title='Your own lyrics: "Artist - Title.lrc" files win over online results'>
            Open lyrics folder
          </Button>
        </Section>
      </div>
    </>
  );
}
