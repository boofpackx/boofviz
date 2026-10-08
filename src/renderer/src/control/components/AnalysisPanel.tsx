import { useState } from 'react';
import { BAND_NAMES, DEFAULT_ANALYSIS_SETTINGS, type BandName } from '@shared/types/audio';
import type { LostMediaSettings, NeoFlatSettings, RetroTvSettings } from '@shared/settings';
import { useControl } from '../store';
import { Section, Segmented, Slider, Toggle } from './ui';

const BAND_LABEL: Record<BandName, string> = { sub: 'Sub', bass: 'Bass', lowMid: 'Low mid', mid: 'Mid', highMid: 'High mid', presence: 'Presence', air: 'Air' };

export function AnalysisPanel() {
  const a = useControl((s) => s.settings.analysis);
  const update = useControl((s) => s.update);
  const d = DEFAULT_ANALYSIS_SETTINGS;
  const [showBands, setShowBands] = useState(false);
  const patch = (p: Partial<typeof a>): void => update({ analysis: p });

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Input">
        <Slider label="Gain" value={a.gainDb} min={-24} max={24} step={0.5} unit=" dB" defaultValue={d.gainDb} onChange={(v) => patch({ gainDb: v })} />
        <Slider label="Noise gate" value={a.gateDb} min={-90} max={-20} step={1} unit=" dB" defaultValue={d.gateDb} onChange={(v) => patch({ gateDb: v })} />
        <Toggle label="Auto-gain (normalize quiet sources)" checked={a.autoGain} onChange={(v) => patch({ autoGain: v })} />
        <Slider
          label="Latency offset"
          value={a.latencyMs}
          min={-200}
          max={200}
          step={1}
          defaultValue={0}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} ms`}
          onChange={(v) => patch({ latencyMs: v })}
        />
        <p className="text-[11px] leading-snug text-ink-400">Positive delays visuals to match speakers or a slow projector. Negative pulls beat-locked events earlier.</p>
      </Section>

      <Section title="Onsets">
        <Slider label="Kick" value={a.onsetSensitivity.kick} min={0} max={1} defaultValue={d.onsetSensitivity.kick} onChange={(v) => patch({ onsetSensitivity: { ...a.onsetSensitivity, kick: v } })} />
        <Slider label="Snare" value={a.onsetSensitivity.snare} min={0} max={1} defaultValue={d.onsetSensitivity.snare} onChange={(v) => patch({ onsetSensitivity: { ...a.onsetSensitivity, snare: v } })} />
        <Slider label="Hat" value={a.onsetSensitivity.hat} min={0} max={1} defaultValue={d.onsetSensitivity.hat} onChange={(v) => patch({ onsetSensitivity: { ...a.onsetSensitivity, hat: v } })} />
      </Section>

      <Section title="Tempo">
        <div className="grid grid-cols-[84px_1fr] items-center gap-2">
          <span className="text-ink-300">Phrase (beats)</span>
          <Segmented<8 | 16 | 32>
            value={a.beatsPerPhrase}
            onChange={(v) => patch({ beatsPerPhrase: v })}
            options={[
              { value: 8, label: '8' },
              { value: 16, label: '16' },
              { value: 32, label: '32' },
            ]}
          />
        </div>
        <Slider label="BPM min" value={a.bpmRange[0]} min={50} max={140} step={1} defaultValue={d.bpmRange[0]} onChange={(v) => patch({ bpmRange: [Math.min(v, a.bpmRange[1] - 20), a.bpmRange[1]] })} />
        <Slider label="BPM max" value={a.bpmRange[1]} min={90} max={220} step={1} defaultValue={d.bpmRange[1]} onChange={(v) => patch({ bpmRange: [a.bpmRange[0], Math.max(v, a.bpmRange[0] + 20)] })} />
        <p className="text-[11px] leading-snug text-ink-400">Detected tempos outside the range are folded by half/double time (e.g. 87 → 174 for DnB with 120–190).</p>
      </Section>

      <ExternalTempoSection />

      <Section
        title="Smoothing"
        right={
          <button type="button" className="text-[10px] text-ink-400 hover:text-ink-200" onClick={() => setShowBands(!showBands)}>
            {showBands ? 'Hide bands' : 'Per band'}
          </button>
        }
      >
        <Slider label="Spectrum atk" value={a.spectrumSmoothing.attackMs} min={0} max={200} step={1} unit=" ms" defaultValue={d.spectrumSmoothing.attackMs} onChange={(v) => patch({ spectrumSmoothing: { ...a.spectrumSmoothing, attackMs: v } })} />
        <Slider label="Spectrum rel" value={a.spectrumSmoothing.releaseMs} min={10} max={1000} step={5} unit=" ms" defaultValue={d.spectrumSmoothing.releaseMs} onChange={(v) => patch({ spectrumSmoothing: { ...a.spectrumSmoothing, releaseMs: v } })} />
        {showBands &&
          BAND_NAMES.map((b) => (
            <div key={b} className="space-y-1 rounded border border-ink-700/60 p-2">
              <div className="text-[10px] font-semibold tracking-wider text-ink-400 uppercase">{BAND_LABEL[b]}</div>
              <Slider label="Attack" value={a.bandSmoothing[b].attackMs} min={0} max={200} step={1} unit=" ms" defaultValue={d.bandSmoothing[b].attackMs} onChange={(v) => patch({ bandSmoothing: { ...a.bandSmoothing, [b]: { ...a.bandSmoothing[b], attackMs: v } } })} />
              <Slider label="Release" value={a.bandSmoothing[b].releaseMs} min={10} max={2000} step={5} unit=" ms" defaultValue={d.bandSmoothing[b].releaseMs} onChange={(v) => patch({ bandSmoothing: { ...a.bandSmoothing, [b]: { ...a.bandSmoothing[b], releaseMs: v } } })} />
            </div>
          ))}
      </Section>

    </div>
  );
}

function ExternalTempoSection() {
  const a = useControl((s) => s.settings.analysis);
  const update = useControl((s) => s.update);
  const link = useControl((s) => s.link);
  const midi = useControl((s) => s.midi);
  const patch = (p: Partial<typeof a>): void => update({ analysis: p });
  return (
    <Section title="Sync (Link / MIDI Clock)">
      <Segmented
        value={a.tempoSource}
        onChange={(v) => patch({ tempoSource: v })}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'tap', label: 'Tap' },
          { value: 'link', label: 'Link', disabled: !link.available },
          { value: 'midiClock', label: 'MIDI Clock', disabled: !midi.supported },
        ]}
      />
      {!link.available && (
        <p className="text-[11px] leading-snug text-ink-400">
          Ableton Link needs a one-time build: run <span className="font-mono text-ink-200">npm run link:build</span> (needs Visual Studio Build Tools on Windows), then restart BOOFVIZ.
        </p>
      )}
      {a.tempoSource === 'link' && (
        <p className="text-[11px] leading-snug text-ink-400">
          Turn on <b className="text-ink-200">Link</b> in Rekordbox (Performance mode, LINK button) or Serato (Setup → Ableton Link). {link.peers > 0 ? `Connected to ${link.peers} peer${link.peers > 1 ? 's' : ''} at ${link.tempo.toFixed(2)} BPM.` : 'Waiting for peers…'}
        </p>
      )}
      {a.tempoSource === 'midiClock' && (
        <div className="grid grid-cols-[84px_1fr] items-center gap-2">
          <span className="text-ink-300">MIDI input</span>
          <select value={a.midiInputId ?? ''} onChange={(e) => patch({ midiInputId: e.target.value || undefined })}>
            <option value="">First available</option>
            {midi.inputs.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {(a.tempoSource === 'link' || a.tempoSource === 'midiClock') && (
        <>
          <Slider
            label="Sync offset"
            value={a.externalOffsetMs}
            min={-100}
            max={100}
            step={1}
            defaultValue={0}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} ms`}
            onChange={(v) => patch({ externalOffsetMs: v })}
          />
          <p className="text-[11px] leading-snug text-ink-400">Positive moves beat-locked motion earlier to cover projector / LED processor delay. The audio latency offset doesn&apos;t apply to Link or clock timing.</p>
        </>
      )}
    </Section>
  );
}

export function MasterPanel() {
  const g = useControl((s) => s.globals);
  const setGlobals = useControl((s) => s.setGlobals);
  const scale = useControl((s) => s.settings.output.renderScale);
  const update = useControl((s) => s.update);
  return (
    <div className="h-full overflow-y-auto">
      <Section title="Master (over any preset)">
        <Slider label="Brightness" value={g.brightness} min={0} max={2} defaultValue={1} onChange={(v) => setGlobals({ brightness: v })} />
        <Slider label="Reactivity" value={g.reactivity} min={0.25} max={2} defaultValue={1} onChange={(v) => setGlobals({ reactivity: v })} />
        <Slider label="Speed" value={g.speed} min={0.25} max={4} step={0.25} defaultValue={1} format={(v) => `×${v}`} onChange={(v) => setGlobals({ speed: v })} />
        <Slider label="Trails" value={g.trails} min={0} max={0.95} defaultValue={0} onChange={(v) => setGlobals({ trails: v })} />
        <Slider label="Saturation" value={g.saturation} min={0} max={2} defaultValue={1} onChange={(v) => setGlobals({ saturation: v })} />
        <Slider label="Hue shift" value={g.hueShift} min={-180} max={180} step={1} unit="°" defaultValue={0} onChange={(v) => setGlobals({ hueShift: v })} />
        <p className="text-[11px] leading-snug text-ink-400">Double-click a slider to reset it. Speed scales every beat-synced motion (×0.25 to ×4 of the BPM).</p>
      </Section>
      <LostMediaSection />
      <RetroTvSection />
      <CoverColorsSection />
      <NeoFlatSection />
      <Section title="Output">
        <Slider label="Render scale" value={scale} min={0.5} max={2} step={0.05} defaultValue={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ output: { renderScale: v } })} />
      </Section>
    </div>
  );
}

const LOST_STYLES: Array<{ value: LostMediaSettings['style']; label: string; title: string }> = [
  { value: 'camcorder', label: 'Camcorder', title: 'Home video: REC, date stamp, focus hunting' },
  { value: 'vhs', label: 'VHS', title: 'A worn rental tape with the VCR display' },
  { value: 'broadcast', label: 'TV', title: 'Off-air recording with a channel bug and lower third' },
  { value: 'super8', label: 'Super 8', title: 'Home movie film: 18 fps, dust, light leaks' },
  { value: 'archive', label: 'Archive', title: 'Decaying nitrate reel, sepia or black and white' },
  { value: 'web', label: 'Web', title: 'Early internet video: tiny, blocky, buffering' },
];

function LostMediaSection() {
  const lm = useControl((s) => s.settings.lostMedia);
  const update = useControl((s) => s.update);
  const set = (patch: Partial<LostMediaSettings>): void => update({ lostMedia: patch });
  return (
    <Section title="Lost media (over any look)">
      <Toggle label="Make it lost media" checked={lm.enabled} onChange={(v) => set({ enabled: v })} hint="Runs whatever is playing (and the lyrics) through an old tape, film reel or early web video" />
      <div className="grid grid-cols-3 gap-1">
        {LOST_STYLES.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => set({ style: o.value, enabled: true })}
            className={`rounded border px-1 py-0.5 text-[10px] ${lm.style === o.value ? 'border-accent-2 bg-ink-600 text-ink-100' : 'border-ink-600 text-ink-400 hover:text-ink-200'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Slider label="Wear" value={lm.wear} min={0} max={2} defaultValue={1} onChange={(v) => set({ wear: v })} />
      <Slider label="Tape events" value={lm.events} min={0} max={1} defaultValue={0.3} onChange={(v) => set({ events: v })} />
      <Slider label="Mood" value={lm.mood} min={0} max={1} defaultValue={0.3} format={(v) => (v < 0.35 ? 'cozy' : v > 0.65 ? 'eerie' : 'neutral')} onChange={(v) => set({ mood: v })} />
      <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-ink-300">
        Date stamp
        <input className="rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-ink-100" value={lm.date} onChange={(e) => set({ date: e.target.value })} />
      </label>
      <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-ink-300">
        Station / brand
        <input className="rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-ink-100" value={lm.station} onChange={(e) => set({ station: e.target.value })} />
      </label>
    </Section>
  );
}

const TV_SETS: Array<{ value: RetroTvSettings['set']; label: string; title: string }> = [
  { value: 'screen', label: 'Screen', title: 'Just the old curved screen, filling the frame' },
  { value: 'console60', label: '60s', title: 'Wood console with brass trim and knobs' },
  { value: 'portable70', label: '70s', title: 'Orange portable with a carry handle and a dial' },
  { value: 'woodgrain80', label: '80s', title: 'Woodgrain set with a silver button panel' },
  { value: 'black90', label: '90s', title: 'Black set with a green power light' },
];

function RetroTvSection() {
  const tv = useControl((s) => s.settings.retroTv);
  const update = useControl((s) => s.update);
  const set = (patch: Partial<RetroTvSettings>): void => update({ retroTv: patch });
  return (
    <Section title="Old TV screen (over any look)">
      <Toggle label="Old TV screen" checked={tv.enabled} onChange={(v) => set({ enabled: v })} hint="Every look plays on old curved glass; pick a decade to show the whole set" />
      <div className="grid grid-cols-5 gap-1">
        {TV_SETS.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => set({ set: o.value, enabled: true })}
            className={`rounded border px-1 py-0.5 text-[10px] ${tv.set === o.value ? 'border-accent-2 bg-ink-600 text-ink-100' : 'border-ink-600 text-ink-400 hover:text-ink-200'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {tv.set !== 'screen' && <Slider label="Zoom in" value={tv.zoom} min={0} max={1} defaultValue={0.1} onChange={(v) => set({ zoom: v })} />}
      <Toggle label="Tube switch-off on blackout" checked={tv.powerFx} onChange={(v) => set({ powerFx: v })} hint="Blackout collapses the picture to a line and a dot before going dark" />
      <button
        type="button"
        className="mt-1 w-full rounded border border-ink-600 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
        title="Drop your own music videos or clips (mp4 / webm) here; looks set to 'My videos' play them through the retro filters"
        onClick={() => void window.boofviz.openVideosFolder()}
      >
        Open my videos folder
      </button>
    </Section>
  );
}

function CoverColorsSection() {
  const cover = useControl((s) => s.settings.coverColors);
  const update = useControl((s) => s.update);
  return (
    <Section title="Album cover colours">
      <Toggle label="Looks take the song's cover colours" checked={cover.enabled} onChange={(v) => update({ coverColors: { enabled: v } })} hint="Every song recolours whatever look is playing with the main colours of its album cover" />
      <Slider label="Amount" value={cover.amount} min={0} max={1} defaultValue={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ coverColors: { amount: v, enabled: true } })} />
    </Section>
  );
}

function NeoFlatSection() {
  const neo = useControl((s) => s.settings.neoFlat);
  const update = useControl((s) => s.update);
  const set = (patch: Partial<NeoFlatSettings>): void => update({ neoFlat: patch });
  return (
    <Section title="Neo-brutal flat (over any look)">
      <Toggle label="Flat colour, outlines, hard shadows" checked={neo.enabled} onChange={(v) => set({ enabled: v })} hint="Turns whatever is playing into flat neo-brutal graphics" />
      <Segmented
        value={neo.colours}
        onChange={(colours) => set({ colours, enabled: true })}
        options={[
          { value: 'neo', label: 'Loud colours' },
          { value: 'look', label: 'The look\u2019s colours' },
        ]}
      />
      <Slider label="Outline" value={neo.outline} min={0} max={16} step={0.5} defaultValue={4} onChange={(v) => set({ outline: v })} />
      <Slider label="Shadow" value={neo.shadow} min={0} max={40} step={0.5} defaultValue={12} onChange={(v) => set({ shadow: v })} />
    </Section>
  );
}
