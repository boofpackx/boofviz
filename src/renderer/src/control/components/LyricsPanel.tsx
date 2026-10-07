import { useEffect, useRef, useState, type DragEvent } from 'react';
import { positionAt, SPOTIFY_REDIRECT_URI, type SpotifyCommand } from '@shared/lyrics';
import { lyricAt } from '@/engine/lyricsFeed';
import { useControl } from '../store';
import { useTicker } from '../hooks';
import { Button, Section, Segmented, Slider, Toggle } from './ui';

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SOURCE_LABEL = { file: 'your .lrc file', cache: 'LRCLIB (cached)', lrclib: 'LRCLIB', none: 'not found' } as const;

/** Spotify connection, now playing, lyrics source / offset and the lyrics-over-every-look overlay. */
export function LyricsPanel() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SpotifySection />
      <NowPlayingSection />
      <LyricsSection />
      <OverlaySection />
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
  const status = np.connected ? 'Connected' : np.connecting ? 'Waiting for the browser login…' : 'Not connected';

  return (
    <Section title="Spotify" right={<span className={`text-[10px] ${np.connected ? 'text-ok' : 'text-ink-400'}`}>{status}</span>}>
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
        disabled={np.connected}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="w-full rounded border border-ink-600 bg-ink-850 px-2 py-1 font-mono text-[11px] text-ink-100 placeholder:text-ink-500 disabled:opacity-50"
      />
      <div className="flex gap-2">
        {np.connected ? (
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
            <div className="truncate text-[11px] text-ink-400">{np.album}</div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-ink-400">Nothing playing in Spotify.</p>
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
        <Button className="flex-1" title={np.playing ? 'Pause Spotify' : 'Resume Spotify'} onClick={() => send(np.playing ? 'pause' : 'play')}>
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
  const lead = typeof settings.overlay.params.lead === 'number' ? settings.overlay.params.lead : 150;
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
            ? `Unsynced only · ${SOURCE_LABEL[lyrics.source]}`
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
    <Section title="Lyrics" right={<span className="text-[10px] text-ink-400">{status}</span>}>
      <div className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
        <div className="min-h-[16px] truncate text-ink-100" data-testid="lyrics-current">
          {cur.text || (forTrack && lyrics.synced ? '♪' : '—')}
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
  );
}

const VIDEO_STYLES: Array<[string, string]> = [
  ['auto', 'Auto (matches the look)'],
  ['drop', 'Drop: words fall into place'],
  ['slam', 'Slam: huge, then snap to size'],
  ['pop', 'Pop: big then small'],
  ['shuffle', 'Shuffle: letters fly into order'],
  ['flip', 'Flip: letters flip up in 3D'],
  ['spin3d', 'Spin: words turn in like cards'],
  ['zoomthrough', 'Zoom: words fly through you'],
  ['stack', 'Stack: big/small word stack'],
  ['wave', 'Wave: letters ride the beat'],
  ['glitch', 'Glitch: jittery arrival'],
  ['scatter', 'Scatter: words thrown around'],
  ['orbit3d', 'Orbit: words circle in 3D'],
  ['highway', 'Highway: words on the road ahead'],
  ['credits', 'Credits: lines roll up like end credits'],
  ['infomercial', 'Infomercial: chrome words swoosh in'],
  ['ransom', 'Ransom note: cut-out letters'],
  ['teletext', 'Teletext: a page of coloured rows'],
  ['screensaver', 'Screensaver: the line tumbles and bounces'],
  ['neonalley', 'Neon alley: neon words buzz on over a wet street'],
  ['jcard', 'J-card: handwritten in marker'],
  ['laser', 'Laser show: beams trace the words'],
  ['highscore', 'High score: letters spin and lock in'],
  ['explosion', 'Chorus explosion: small verses, huge chorus'],
  ['shatterdrop', 'Shatter drop: the drop breaks the line'],
];

const MATERIALS: Array<[string, string]> = [
  ['auto', 'Auto (suits the style)'],
  ['plain', 'Plain'],
  ['chrome', 'Chrome'],
  ['neon', 'Neon tube'],
  ['paper', 'Paper'],
  ['led', 'LED sign'],
  ['phosphor', 'CRT phosphor'],
  ['stencil', 'Spray stencil'],
  ['mimeo', 'Mimeograph ink'],
  ['rubdown', 'Rub-down letters'],
  ['laser', 'Laser beam'],
];

function OverlaySection() {
  const overlay = useControl((s) => s.settings.lyrics.overlay);
  const textLooks = useControl((s) => s.settings.lyrics.textLooks);
  const update = useControl((s) => s.update);
  const p = overlay.params;
  const video = p.kind === 'lyricVideo';
  const set = (params: Record<string, string | number>): void => update({ lyrics: { overlay: { params } } });
  return (
    <Section title="Overlay">
      <Toggle label="Show lyrics over every look" hint="Lyrics stay on top while presets change or shuffle" checked={overlay.enabled} onChange={(enabled) => update({ lyrics: { overlay: { enabled } } })} />
      <Toggle
        label="Put lyrics into text looks"
        hint="Looks built from text (crawl, terminal, neon titles, word punches…) sing along in their own style; they show the song title before the first line and their own words when nothing is playing"
        checked={textLooks}
        onChange={(textLooks) => update({ lyrics: { textLooks } })}
      />
      <Segmented
        value={video ? 'lyricVideo' : 'lyrics'}
        onChange={(kind) => set({ kind })}
        options={[
          { value: 'lyricVideo', label: 'Music video' },
          { value: 'lyrics', label: 'Classic' },
        ]}
      />
      {video ? (
        <>
          <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
            <span>Style</span>
            <select className="rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100" value={String(p.style ?? 'auto')} onChange={(e) => set({ style: e.target.value })}>
              {VIDEO_STYLES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
            <span>Colour</span>
            <select className="rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100" value={String(p.colorMode ?? 'palette')} onChange={(e) => set({ colorMode: e.target.value })}>
              <option value="palette">From the look</option>
              <option value="gradient">Gradient</option>
              <option value="white">White</option>
              <option value="rainbow">Rainbow</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
            <span>Letters made of</span>
            <select className="rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100" value={String(p.material ?? 'auto')} onChange={(e) => set({ material: e.target.value })}>
              {MATERIALS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-ink-300">
            <span>Lines leave by</span>
            <select className="rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[11px] text-ink-100" value={String(p.exit ?? 'auto')} onChange={(e) => set({ exit: e.target.value })}>
              <option value="auto">Auto (shatter on big choruses)</option>
              <option value="style">The style&apos;s own exit</option>
              <option value="fade">Fading</option>
              <option value="shatter">Shattering</option>
              <option value="burn">Burning away</option>
            </select>
          </label>
          <Slider label="3D depth" value={typeof p.depth === 'number' ? p.depth : 0.5} min={0} max={1} defaultValue={0.5} onChange={(depth) => set({ depth })} />
          <Slider label="Hero word" value={typeof p.hero === 'number' ? p.hero : 0.6} min={0} max={1} defaultValue={0.6} onChange={(hero) => set({ hero })} />
          <Slider label="Camera moves" value={typeof p.camera === 'number' ? p.camera : 0.5} min={0} max={1} defaultValue={0.5} onChange={(camera) => set({ camera })} />
          <Slider label="Song shape" value={typeof p.drama === 'number' ? p.drama : 0.7} min={0} max={1} defaultValue={0.7} onChange={(drama) => set({ drama })} />
        </>
      ) : (
        <Segmented
          value={String(p.mode ?? 'karaoke')}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'karaoke', label: 'Karaoke' },
            { value: 'punch', label: 'Punch' },
            { value: 'typewriter', label: 'Typewriter' },
          ]}
        />
      )}
      <Slider label="Size" value={typeof p.size === 'number' ? p.size : 0.8} min={0.3} max={video ? 2.5 : 1.6} defaultValue={video ? 1 : 0.7} onChange={(size) => set({ size })} />
      <Segmented
        value={String(p.position ?? 'lower')}
        onChange={(position) => set({ position })}
        options={[
          { value: 'upper', label: 'Top' },
          { value: 'center', label: 'Center' },
          { value: 'lower', label: 'Bottom' },
        ]}
      />
    </Section>
  );
}
