import { useEffect, type ReactNode } from 'react';
import { useShow } from '../show';
import { useControl } from '../store';
import { cueGo, setCue } from '../launcher';
import { describeMapping, MIDI_TARGETS } from '../midiCore';
import { learn, unmap } from '../midiMap';
import { Button, Kbd, Section , Segmented } from './ui';
import { LYRICS_MODES, type LyricsMode } from '@shared/lyricRouter';
import { setLyricsMode, stepTreatment } from '../lyricsMode';

/** A button that is on only while it is held down (strobe, freeze). */
function HoldButton({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onPointerDown={() => set(true)}
      onPointerUp={() => set(false)}
      onPointerLeave={() => on && set(false)}
      className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${on ? 'border-accent bg-accent/40 text-ink-100' : 'border-ink-600 bg-ink-800 text-ink-200 hover:bg-ink-700'}`}
    >
      {label}
    </button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-snug text-ink-400">{children}</p>;
}

/** Live performance: cue and GO, live buttons, sets, and MIDI learn. */
export function PerformPanel() {
  const lyricsMode = useControl((s) => s.settings.lyrics.mode);
  const cue = useControl((s) => s.cue);
  const liveName = useControl((s) => s.liveName);
  const globals = useControl((s) => s.globals);
  const setGlobals = useControl((s) => s.setGlobals);
  const midi = useControl((s) => s.midi);
  const learning = useControl((s) => s.midiLearn);
  const seen = useControl((s) => s.midiSeen);
  const mappings = useControl((s) => s.settings.midiMap.mappings);
  const docName = useShow((s) => s.doc.name);

  // Escape stops learning.
  useEffect(() => {
    if (!learning) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') learn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [learning]);

  const groups = [...new Set(MIDI_TARGETS.map((t) => t.group))];
  return (
    <div className="h-full overflow-y-auto">
      <Section title="Cue" right={<Kbd>C</Kbd>}>
        <div className="flex gap-2">
          <Button active={cue} onClick={() => setCue(!cue)} className="flex-1">
            {cue ? 'Cue mode on' : 'Cue mode off'}
          </Button>
          <button
            type="button"
            disabled={!cue}
            onClick={cueGo}
            className={`flex-1 rounded border py-1 text-[13px] font-bold tracking-wider transition-colors ${cue ? 'border-ok bg-ok/30 text-ink-100 hover:bg-ok/45' : 'border-ink-700 bg-ink-800 text-ink-500'}`}
          >
            GO
          </button>
        </div>
        {cue ? (
          <Hint>
            On screen: <span className="text-ink-200">{liveName || '—'}</span> · In the preview: <span className="text-ink-200">{docName}</span>. Pick and tweak looks here, then GO (<Kbd>G</Kbd>) sends this one on the next bar with its transition. Autopilot waits while you cue.
          </Hint>
        ) : (
          <Hint>Turn on to load looks into the preview first, without the screen changing.</Hint>
        )}
      </Section>

      <Section title="Live">
        <div className="flex flex-wrap gap-2">
          <Button tone="danger" active={globals.blackout} onClick={() => setGlobals({ blackout: !globals.blackout })}>
            Blackout
          </Button>
          <HoldButton label="Strobe (hold)" on={globals.strobe} set={(v) => setGlobals({ strobe: v })} />
          <Button active={globals.freeze} onClick={() => setGlobals({ freeze: !globals.freeze })}>
            {globals.freeze ? 'Frozen' : 'Freeze'}
          </Button>
        </div>
        <Hint>Freeze holds the last frame on the screen; the preview keeps running.</Hint>
      </Section>

      <Section title="Lyrics" right={<Kbd>L</Kbd>}>
        <Segmented<LyricsMode> value={lyricsMode} onChange={setLyricsMode} options={LYRICS_MODES.map((m) => ({ value: m.id, label: m.label }))} />
        <div className="flex gap-2">
          <Button onClick={() => stepTreatment(-1)}>◀ Style</Button>
          <Button onClick={() => stepTreatment(1)}>Style ▶</Button>
        </div>
        <Hint>Everywhere gives every look lyrics: its own when it has them, else its theme&apos;s style. Shift+L steps the style.</Hint>
      </Section>

      <Section title="Sets">
        <Hint>
          A set is a pool of looks played in order: make a pool in the Library, choose it as the shuffle pool, and set the order to In order. Autopilot then walks through it, and the MIDI functions Next / Previous look in the set step through it by hand.
        </Hint>
      </Section>

      <Section title="MIDI" right={<span className="text-[10px] text-ink-400">{midi.supported ? `${midi.inputs.length} controller${midi.inputs.length === 1 ? '' : 's'}` : 'not supported'}</span>}>
        {midi.inputs.length ? (
          <Hint>
            Connected: <span className="text-ink-200">{midi.inputs.map((i) => i.name).join(', ')}</span>
            {seen && (
              <>
                <br />
                Last: <span className="font-mono text-ink-300">{seen}</span>
              </>
            )}
          </Hint>
        ) : (
          <Hint>No controller found. Plug it in (it shows up here on its own). If your DJ software already has it open and it doesn&apos;t appear, Windows is letting only one app use it: an up-to-date Windows 11 shares it between apps.</Hint>
        )}
        <Hint>Press Learn next to a function, then press the pad or move the knob on your controller. Esc cancels.</Hint>
        {groups.map((g) => (
          <div key={g} className="pt-1">
            <div className="mb-1 text-[10px] font-semibold tracking-wider text-ink-500 uppercase">{g}</div>
            {MIDI_TARGETS.filter((t) => t.group === g).map((t) => {
              const m = mappings.find((x) => x.target === t.id);
              const isLearning = learning === t.id;
              return (
                <div key={t.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-ink-200" title={t.label}>{t.label}</span>
                  {(isLearning || m) && (
                    <span className="max-w-24 shrink-0 truncate text-right font-mono text-[10px] text-ink-400" title={m?.input}>
                      {isLearning ? 'move a control…' : m ? describeMapping(m) : ''}
                    </span>
                  )}
                  <Button active={isLearning} onClick={() => learn(isLearning ? null : t.id)}>
                    {isLearning ? 'Cancel' : 'Learn'}
                  </Button>
                  {m && (
                    <button type="button" title="Remove" onClick={() => unmap(t.id)} className="text-ink-500 hover:text-bad">
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </Section>
    </div>
  );
}
