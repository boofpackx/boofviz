import type { LinkState } from '@shared/ipc';
import type { TempoSourceKind } from '@shared/types/audio';
import { MidiClockTracker } from '@/audio/tempo/midiClock';
import { epochNow } from '@/audio/frameBuilder';
import { engine } from './runtime';
import { useControl } from './store';

/**
 * External tempo sources for the control window:
 *  - Ableton Link snapshots arrive from the main process (native add-on).
 *  - MIDI Clock comes straight from Web MIDI.
 * Both are forwarded to the analysis worker, which anchors the beat clock.
 */
let midiAccess: MIDIAccess | null = null;
let midiInput: MIDIInput | null = null;
const clock = new MidiClockTracker();
let midiTimer = 0;

function onLinkState(s: LinkState): void {
  useControl.getState().set({ link: s });
  // With no peers Link only knows its own default tempo; let the clock flywheel instead.
  if (s.enabled && s.peers > 0 && useControl.getState().settings.analysis.tempoSource === 'link') {
    engine.external('link', s.tempo, s.beat, s.epochMs);
  }
}

function onMidiMessage(e: MIDIMessageEvent): void {
  if (!e.data) return;
  // Web MIDI timestamps share the page's performance clock.
  clock.message(e.data, performance.timeOrigin + e.timeStamp);
}

async function ensureMidi(): Promise<MIDIAccess | null> {
  if (midiAccess || !('requestMIDIAccess' in navigator)) return midiAccess;
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    const refresh = (): void => {
      const inputs = Array.from(midiAccess!.inputs.values()).map((i) => ({ id: i.id, name: i.name ?? i.id }));
      useControl.getState().set({ midi: { ...useControl.getState().midi, inputs } });
    };
    midiAccess.onstatechange = refresh;
    refresh();
  } catch {
    midiAccess = null;
  }
  return midiAccess;
}

async function selectMidiInput(id: string | undefined): Promise<void> {
  const access = await ensureMidi();
  if (midiInput) midiInput.onmidimessage = null;
  midiInput = null;
  if (!access) return;
  const inputs = Array.from(access.inputs.values());
  midiInput = (id && inputs.find((i) => i.id === id)) || inputs[0] || null;
  if (midiInput) midiInput.onmidimessage = onMidiMessage;
}

function startMidiPump(): void {
  window.clearInterval(midiTimer);
  midiTimer = window.setInterval(() => {
    const r = clock.reading();
    const receiving = clock.silenceMs(epochNow()) < 1000;
    const st = useControl.getState();
    if (r && receiving) engine.external('midiClock', r.bpm, r.beat, r.epochMs);
    if (st.midi.receiving !== receiving || Math.abs(st.midi.bpm - (r?.bpm ?? 0)) > 0.05 || st.midi.running !== (r?.running ?? false)) {
      st.set({ midi: { ...st.midi, receiving, bpm: r?.bpm ?? 0, running: r?.running ?? false } });
    }
  }, 50);
}

/** Turn sources on/off to match the selected tempo source. */
export async function applyTempoSource(source: TempoSourceKind, midiInputId?: string): Promise<void> {
  const link = await window.boofviz.setLinkEnabled(source === 'link');
  useControl.getState().set({ link });
  if (source === 'midiClock') {
    await selectMidiInput(midiInputId);
    startMidiPump();
  } else {
    window.clearInterval(midiTimer);
    if (midiInput) midiInput.onmidimessage = null;
    midiInput = null;
  }
}

export function initExternalTempo(): () => void {
  void ensureMidi();
  return window.boofviz.onLinkState(onLinkState);
}
