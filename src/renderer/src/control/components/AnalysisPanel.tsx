import { useState } from 'react';
import { BAND_NAMES, DEFAULT_ANALYSIS_SETTINGS, type BandName } from '@shared/types/audio';
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

      <GlobalsSection />
    </div>
  );
}

function GlobalsSection() {
  const g = useControl((s) => s.globals);
  const setGlobals = useControl((s) => s.setGlobals);
  const scale = useControl((s) => s.settings.output.renderScale);
  const update = useControl((s) => s.update);
  return (
    <Section title="Master">
      <Slider label="Brightness" value={g.brightness} min={0} max={2} defaultValue={1} onChange={(v) => setGlobals({ brightness: v })} />
      <Slider label="Reactivity" value={g.reactivity} min={0.25} max={2} defaultValue={1} onChange={(v) => setGlobals({ reactivity: v })} />
      <Slider label="Saturation" value={g.saturation} min={0} max={2} defaultValue={1} onChange={(v) => setGlobals({ saturation: v })} />
      <Slider label="Hue shift" value={g.hueShift} min={-180} max={180} step={1} unit="°" defaultValue={0} onChange={(v) => setGlobals({ hueShift: v })} />
      <Slider label="Output scale" value={scale} min={0.5} max={2} step={0.05} defaultValue={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ output: { renderScale: v } })} />
    </Section>
  );
}
