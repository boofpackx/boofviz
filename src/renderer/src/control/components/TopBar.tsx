import { useEffect, useRef } from 'react';
import type { TempoSourceKind } from '@shared/types/audio';
import { engine } from '../runtime';
import { useControl } from '../store';
import { previewStats, useCanvasLoop, useTicker } from '../hooks';
import { useSourceActions } from './SourcePanel';
import { Button, Segmented } from './ui';

export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-900 px-3">
      <div className="flex items-baseline gap-1 pr-1">
        <span className="text-[15px] font-black tracking-[0.18em] text-ink-100">BOOF</span>
        <span className="text-[15px] font-black tracking-[0.18em] text-accent">VIZ</span>
      </div>
      <InputPicker />
      <LevelMeter />
      <Divider />
      <TempoDisplay />
      <Divider />
      <div className="flex-1" />
      <Stats />
      <OutputControls />
    </header>
  );
}

function Divider() {
  return <div className="h-6 w-px bg-ink-700" />;
}

function InputPicker() {
  const input = useControl((s) => s.settings.input);
  const devices = useControl((s) => s.devices);
  const status = useControl((s) => s.engineStatus);
  const fileName = useControl((s) => s.fileName);
  const { selectLoopback, selectDevice } = useSourceActions();
  const value = input.kind === 'loopback' ? 'loopback' : input.kind === 'file' ? 'file' : `dev:${input.deviceId}`;
  const dot = status.state === 'running' ? 'bg-ok' : status.state === 'error' ? 'bg-bad' : status.state === 'starting' ? 'bg-warn' : 'bg-ink-500';
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} title={status.state === 'error' ? status.message : status.state} />
      <select
        className="max-w-52"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'loopback') void selectLoopback();
          else if (v.startsWith('dev:')) {
            const d = devices.find((x) => `dev:${x.deviceId}` === v);
            if (d) void selectDevice(d, 0);
          }
        }}
      >
        <option value="loopback" disabled={window.boofviz.platform !== 'win32'}>
          System Audio (loopback)
        </option>
        {devices.map((d) => (
          <option key={d.deviceId} value={`dev:${d.deviceId}`}>
            {d.isVirtualCable ? '⇄ ' : ''}
            {d.label}
          </option>
        ))}
        <option value="file" disabled>
          {fileName ? `File: ${fileName}` : 'Local file (drop to load)'}
        </option>
      </select>
    </div>
  );
}

/** Real input level (before auto-gain) with peak hold and the gate threshold marked. */
function LevelMeter() {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ level: -90, hold: -90, holdT: 0 });
  useCanvasLoop(ref, (ctx, w, h, dt) => {
    const p = engine.builder.latest;
    const s = state.current;
    const db = p && engine.builder.connected ? p.inputLevelDb : -90;
    s.level = db > s.level ? db : s.level + (db - s.level) * (1 - Math.exp(-dt / 0.25));
    if (db >= s.hold) {
      s.hold = db;
      s.holdT = 1.2;
    } else if ((s.holdT -= dt) < 0) s.hold -= 20 * dt;
    const x = (d: number): number => Math.max(0, Math.min(1, (d + 60) / 60)) * w;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#18181f';
    ctx.fillRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#2a8f5c');
    grad.addColorStop(0.75, '#3ddc84');
    grad.addColorStop(0.9, '#ffb020');
    grad.addColorStop(1, '#ff4d4f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, x(s.level), h);
    ctx.fillStyle = '#ececf2';
    ctx.fillRect(Math.max(0, x(s.hold) - 1), 0, 2, h);
    const gate = useControl.getState().settings.analysis.gateDb;
    ctx.fillStyle = 'rgba(255,77,79,0.8)';
    ctx.fillRect(x(gate), 0, 1, h);
  });
  return <canvas ref={ref} className="h-2 w-32 rounded-sm" title="Input level (dBFS, before auto-gain). Red tick = noise gate." />;
}

function TempoDisplay() {
  useTicker(20);
  const f = engine.builder.frame;
  const source = useControl((s) => s.settings.analysis.tempoSource);
  const update = useControl((s) => s.update);
  const conf = f.bpmConfidence;
  const beatInBar = Math.floor(f.barPhase * f.beatsPerBar);
  const setSource = (v: TempoSourceKind): void => update({ analysis: { tempoSource: v } });
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => {
          engine.tempo({ cmd: 'tap' });
          if (source !== 'tap') setSource('tap');
        }}
        title="Click to tap tempo (T)"
        className="flex min-w-[78px] flex-col items-start rounded px-1.5 py-0.5 hover:bg-ink-800"
      >
        <span className="font-mono text-[18px] leading-none font-semibold text-ink-100 tabular-nums">{f.bpm.toFixed(1)}</span>
        <span className="flex items-center gap-1 text-[9px] tracking-widest text-ink-400">
          <span className={`h-1.5 w-1.5 rounded-full ${conf > 0.5 ? 'bg-ok' : conf > 0.25 ? 'bg-warn' : 'bg-bad'}`} />
          BPM · {f.tempoSource.toUpperCase()}
        </span>
      </button>
      <div className="flex gap-1" title="Beat in bar">
        {Array.from({ length: f.beatsPerBar }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-sm transition-opacity ${i === 0 ? 'bg-accent' : 'bg-accent-2'}`}
            style={{ opacity: i === beatInBar ? 0.4 + 0.6 * (1 - f.beatPhase) : 0.12 }}
          />
        ))}
      </div>
      <Segmented<TempoSourceKind>
        value={source}
        onChange={setSource}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'tap', label: 'Tap' },
          { value: 'link', label: 'Link', disabled: true, title: 'Ableton Link — arrives with the beat engine (Phase 3)' },
          { value: 'midiClock', label: 'MIDI', disabled: true, title: 'MIDI Clock in — arrives with the beat engine (Phase 3)' },
        ]}
      />
      <div className="flex gap-0.5">
        <Button title="Half time" onClick={() => engine.tempo({ cmd: 'half' })}>
          ½
        </Button>
        <Button title="Double time" onClick={() => engine.tempo({ cmd: 'double' })}>
          ×2
        </Button>
        <Button title="Nudge back 1/16 beat ([)" onClick={() => engine.tempo({ cmd: 'nudge', beats: -1 / 16 })}>
          ◀
        </Button>
        <Button title="Nudge forward 1/16 beat (])" onClick={() => engine.tempo({ cmd: 'nudge', beats: 1 / 16 })}>
          ▶
        </Button>
        <Button title="Resync downbeat: the nearest beat becomes bar 1 / phrase start (Enter)" onClick={() => engine.tempo({ cmd: 'resyncDownbeat' })}>
          1
        </Button>
      </div>
    </div>
  );
}

function Stats() {
  useTicker(2);
  const output = useControl((s) => s.output);
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] whitespace-nowrap text-ink-400 tabular-nums">
      <span title="Preview frame rate">PRV {previewStats.fps.toFixed(0)}fps</span>
      {output.open && (
        <span title="Output frame rate">
          OUT {output.fps}fps · {output.width}×{output.height}
        </span>
      )}
    </div>
  );
}

function OutputControls() {
  const output = useControl((s) => s.output);
  const displays = useControl((s) => s.displays);
  const hud = useControl((s) => s.hud);
  const blackout = useControl((s) => s.globals.blackout);
  const set = useControl((s) => s.set);
  const update = useControl((s) => s.update);
  const setGlobals = useControl((s) => s.setGlobals);

  useEffect(() => {
    void window.boofviz.listDisplays().then((d) => set({ displays: d }));
  }, [output.open, set]);

  return (
    <div className="flex items-center gap-2">
      <Button
        active={hud}
        title="Debug HUD (D)"
        onClick={() => {
          set({ hud: !hud });
          update({ ui: { showHud: !hud } });
        }}
      >
        HUD
      </Button>
      <Button tone="danger" active={blackout} title="Blackout (B)" onClick={() => setGlobals({ blackout: !blackout })}>
        Blackout
      </Button>
      <div className="flex items-center gap-1.5 rounded border border-ink-700 bg-ink-850 px-2 py-1">
        <span className={`h-2 w-2 rounded-full ${output.open ? 'bg-ok' : 'bg-ink-500'}`} />
        <span className="text-ink-300">Output</span>
        <select
          value={output.displayId ?? ''}
          onChange={(e) => void window.boofviz.openOutput(Number(e.target.value))}
          title="Output display"
          className="max-w-40"
        >
          {!output.open && <option value="">—</option>}
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} {d.width}×{d.height}
              {d.primary ? ' (main)' : ''}
            </option>
          ))}
        </select>
        {output.open ? (
          <>
            <Button active={output.fullscreen} title="Fullscreen output (F)" onClick={() => void window.boofviz.toggleOutputFullscreen()}>
              Full
            </Button>
            <Button title="Close output window" onClick={() => void window.boofviz.closeOutput()}>
              ✕
            </Button>
          </>
        ) : (
          <Button tone="accent" title="Open output window (O)" onClick={() => void window.boofviz.openOutput()}>
            Open
          </Button>
        )}
      </div>
    </div>
  );
}
