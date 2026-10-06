import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { InputDevice } from '@/audio/AudioEngine';
import { engine } from '../runtime';
import { useControl } from '../store';
import { useTicker } from '../hooks';
import { Button, Section } from './ui';

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a|aac|aiff?)$/i;

export function useSourceActions() {
  const update = useControl((s) => s.update);
  const set = useControl((s) => s.set);

  const selectLoopback = useCallback(async () => {
    update({ input: { kind: 'loopback', channelPair: 0 } });
    set({ fileName: null });
    await engine.setInput({ kind: 'loopback', channelPair: 0 });
  }, [update, set]);

  const selectDevice = useCallback(
    async (dev: InputDevice, channelPair = 0) => {
      update({ input: { kind: 'device', deviceId: dev.deviceId, deviceLabel: dev.label, channelPair } });
      set({ fileName: null });
      await engine.setInput({ kind: 'device', deviceId: dev.deviceId, deviceLabel: dev.label, channelPair });
    },
    [update, set],
  );

  const loadFile = useCallback(
    async (file: File) => {
      update({ input: { kind: 'file' } });
      set({ fileName: file.name });
      await engine.loadFile(file);
    },
    [update, set],
  );

  const refreshDevices = useCallback(async () => {
    set({ devices: await engine.listDevices() });
  }, [set]);

  return { selectLoopback, selectDevice, loadFile, refreshDevices };
}

/** Accept audio files dropped anywhere on the control window. */
export function useFileDrop() {
  const { loadFile } = useSourceActions();
  return {
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      const file = Array.from(e.dataTransfer.files).find((f) => AUDIO_EXT.test(f.name));
      if (!file) return;
      e.preventDefault();
      void loadFile(file);
    },
  };
}

export function SourcePanel() {
  const settings = useControl((s) => s.settings);
  const devices = useControl((s) => s.devices);
  const status = useControl((s) => s.engineStatus);
  const fileName = useControl((s) => s.fileName);
  const showGuide = useControl((s) => s.showGuide);
  const set = useControl((s) => s.set);
  const { selectLoopback, selectDevice, loadFile, refreshDevices } = useSourceActions();
  const fileInput = useRef<HTMLInputElement>(null);
  const platform = window.boofviz.platform;

  useEffect(() => {
    void refreshDevices();
    const onChange = (): void => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  if (showGuide) return <RoutingGuide onClose={() => set({ showGuide: false })} />;

  const input = settings.input;
  const running = status.state === 'running';
  const channels = status.state === 'running' ? status.channels : 2;
  const virtual = devices.filter((d) => d.isVirtualCable);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Audio input">
        <SourceRow
          active={input.kind === 'loopback'}
          running={running && input.kind === 'loopback'}
          title="System Audio"
          subtitle={platform === 'win32' ? 'Loopback of the Windows default output — catches Serato, Rekordbox, anything playing there' : 'Windows only — use a virtual cable on this OS'}
          disabled={platform !== 'win32'}
          onClick={() => void selectLoopback()}
        />
        {devices.map((d) => (
          <SourceRow
            key={d.deviceId}
            active={input.kind === 'device' && input.deviceId === d.deviceId}
            running={running && input.kind === 'device' && input.deviceId === d.deviceId}
            title={d.label}
            subtitle={d.isVirtualCable ? 'Virtual cable' : 'Input device'}
            badge={d.isVirtualCable ? 'CABLE' : undefined}
            onClick={() => void selectDevice(d, 0)}
          />
        ))}
        {input.kind === 'device' && channels > 2 && (
          <div className="flex items-center justify-between pl-2 text-ink-300">
            <span>Channel pair</span>
            <select
              value={input.channelPair}
              onChange={(e) => {
                const dev = devices.find((d) => d.deviceId === input.deviceId);
                if (dev) void selectDevice(dev, Number(e.target.value));
              }}
            >
              {Array.from({ length: Math.floor(channels / 2) }, (_, i) => (
                <option key={i} value={i * 2}>
                  {i * 2 + 1}/{i * 2 + 2}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button onClick={() => void refreshDevices()} title="Rescan audio devices">
            Rescan
          </Button>
          <Button onClick={() => set({ showGuide: true })}>Routing guide</Button>
        </div>
        {virtual.length === 0 && (
          <p className="text-[11px] leading-snug text-ink-400">
            Want visuals from the DJ software only (no notification sounds)? Route its master out to a virtual cable — see the routing guide.
          </p>
        )}
      </Section>

      <Section title="Local file">
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
          className={`cursor-pointer rounded border border-dashed px-3 py-4 text-center transition-colors ${
            input.kind === 'file' ? 'border-accent/70 bg-accent/5' : 'border-ink-600 hover:border-ink-400'
          }`}
        >
          <div className="text-ink-200">{fileName ?? 'Drop MP3 / WAV / FLAC'}</div>
          <div className="text-[11px] text-ink-400">{fileName ? 'Looping · click to replace' : 'or click to browse'}</div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.flac"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = '';
          }}
        />
        {input.kind === 'file' && running && <FileTransport />}
      </Section>
    </div>
  );
}

function SourceRow({ active, running, title, subtitle, badge, disabled, onClick }: { active: boolean; running: boolean; title: string; subtitle: string; badge?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-accent/60 bg-accent/10' : 'border-ink-700 bg-ink-850 hover:border-ink-500'
      }`}
    >
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${running ? 'bg-ok shadow-[0_0_6px_#3ddc84]' : active ? 'bg-warn' : 'bg-ink-600'}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-ink-100">{title}</span>
          {badge && <span className="rounded bg-accent-2/20 px-1 text-[9px] font-semibold text-accent-2">{badge}</span>}
        </span>
        <span className="block text-[11px] leading-snug text-ink-400">{subtitle}</span>
      </span>
    </button>
  );
}

function FileTransport() {
  useTicker(4);
  const el = engine.filePlayer;
  const [, bump] = useState(0);
  if (!el) return null;
  const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={() => {
          if (el.paused) void el.play();
          else el.pause();
          bump((x) => x + 1);
        }}
      >
        {el.paused ? 'Play' : 'Pause'}
      </Button>
      <input
        type="range"
        min={0}
        max={el.duration || 0}
        step={0.1}
        value={el.currentTime}
        onChange={(e) => {
          el.currentTime = Number(e.target.value);
        }}
      />
      <span className="font-mono text-[11px] text-ink-300 tabular-nums">{fmt(el.currentTime)}</span>
    </div>
  );
}

function RoutingGuide({ onClose }: { onClose: () => void }) {
  const mac = window.boofviz.platform === 'darwin';
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Routing guide" right={<Button onClick={onClose}>Back</Button>}>
        <div className="space-y-3 text-[12px] leading-relaxed text-ink-300">
          <div>
            <div className="mb-1 font-semibold text-ink-100">Easiest: System Audio {mac ? '(Windows only)' : ''}</div>
            <p>BOOFVIZ listens to everything playing on the Windows <b>default output device</b>. Start Serato or Rekordbox, pick System Audio, done. If your controller&apos;s sound card isn&apos;t the default output, make it the default (Settings → Sound → Output) or use one of the options below. Notification sounds will also react.</p>
          </div>
          <div>
            <div className="mb-1 font-semibold text-ink-100">Isolate the DJ software with a virtual cable</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>{mac ? <>Install <b>BlackHole 2ch</b> (free).</> : <>Install <b>VB-Audio Cable</b> or <b>VoiceMeeter</b> (free).</>}</li>
              <li>
                {mac ? (
                  <>
                    In Audio MIDI Setup, create a <b>Multi-Output Device</b> with your speakers/interface + BlackHole, and set the DJ software&apos;s output to it so you still hear the mix.
                  </>
                ) : (
                  <>
                    <b>VB-Cable:</b> set the DJ software&apos;s output to <b>CABLE Input</b>, then in Windows Sound → Recording → CABLE Output → Properties → Listen, tick “Listen to this device” and pick your speakers so you still hear the mix. <b>VoiceMeeter:</b> send the DJ software to a VoiceMeeter input; it feeds both your speakers and its own output.
                  </>
                )}
              </li>
              <li>
                <b>Serato / Rekordbox:</b> in the audio setup, pick that cable as the output device. If you play through a controller&apos;s built-in sound card, keep it as the output and use System Audio or the controller&apos;s own input instead.
              </li>
              <li>
                Back here, choose <b>{mac ? 'BlackHole 2ch' : 'CABLE Output'}</b> as the input. It shows a <span className="text-accent-2">CABLE</span> badge.
              </li>
            </ol>
          </div>
          <div>
            <div className="mb-1 font-semibold text-ink-100">DJ mixer / controller line-in</div>
            <p>Many mixers (DJM, DDJ) appear as an audio input. Pick it, then choose the channel pair carrying the master or booth signal.</p>
          </div>
          <div>
            <div className="mb-1 font-semibold text-ink-100">Lining up with the speakers</div>
            <p>If visuals feel early or late, adjust Latency offset in the Analysis panel (positive delays the visuals).</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
