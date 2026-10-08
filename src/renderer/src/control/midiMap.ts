import type { MidiMapping } from '@shared/settings';
import { engine } from './runtime';
import { useShow } from './show';
import { useControl } from './store';
import { cueGo, favoriteEntries, launchQuantized, setCue, shuffleNow, stepPool, stepPreset, toggleAuto } from './launcher';
import { stepTreatment, toggleLyrics } from './lyricsMode';
import { controlKey, describeMapping, interpret, matches, parseMidi, targetById, type MidiEffect, type MidiMsg } from './midiCore';

/**
 * MIDI learn, the live part: listens to every connected controller (next to
 * the MIDI clock input, never instead of it), records a control for the
 * function being learned, and runs mapped functions.
 */

const down = new Map<string, boolean>();
let access: MIDIAccess | null = null;
const listening = new WeakSet<MIDIInput>();

const RANGES: Record<string, [number, number]> = {
  brightness: [0, 2],
  speed: [0.25, 2],
  reactivity: [0.25, 2],
  saturation: [0, 2],
  hueShift: [-180, 180],
  trails: [0, 0.95],
};

function run(target: string, fx: MidiEffect): void {
  const st = useControl.getState();
  const show = useShow.getState();
  const press = !!fx.press;
  if (target.startsWith('fav:')) {
    if (press) {
      const fav = favoriteEntries()[Number(target.slice(4)) - 1];
      if (fav) launchQuantized(fav);
    }
    return;
  }
  if (target.startsWith('macro:')) {
    if (fx.value !== undefined) show.setMacro(Number(target.slice(6)) - 1, fx.value);
    return;
  }
  const range = RANGES[target];
  if (range) {
    if (fx.value !== undefined) st.setGlobals({ [target]: range[0] + (range[1] - range[0]) * fx.value });
    return;
  }
  switch (target) {
    case 'go':
      if (press) {
        if (st.cue) cueGo();
        else show.notify('GO sends a cued look: turn on Cue mode first');
      }
      break;
    case 'cue':
      if (press) setCue(!st.cue);
      break;
    case 'next':
    case 'prev':
      if (press) stepPreset(target === 'next' ? 1 : -1);
      break;
    case 'browse':
      if (fx.steps) stepPreset(fx.steps > 0 ? 1 : -1);
      break;
    case 'setNext':
    case 'setPrev':
      if (press) stepPool(target === 'setNext' ? 1 : -1);
      break;
    case 'shuffle':
      if (press) shuffleNow();
      break;
    case 'auto':
      if (press) toggleAuto();
      break;
    case 'cancel':
      if (press) show.cancelQueued();
      break;
    case 'lyricsMode':
      if (press) toggleLyrics();
      break;
    case 'lyricsNext':
    case 'lyricsPrev':
      if (press) stepTreatment(target === 'lyricsNext' ? 1 : -1);
      break;
    case 'blackout':
      if (press) st.setGlobals({ blackout: !st.globals.blackout });
      break;
    case 'strobe':
    case 'freeze':
      if (press || fx.release) st.setGlobals({ [target]: press });
      break;
    case 'freezeLatch':
      if (press) st.setGlobals({ freeze: !st.globals.freeze });
      break;
    case 'tap':
      if (press) {
        engine.tempo({ cmd: 'tap' });
        if (st.settings.analysis.tempoSource !== 'tap') st.update({ analysis: { tempoSource: 'tap' } });
      }
      break;
    case 'resync':
      if (press) engine.tempo({ cmd: 'resyncDownbeat' });
      break;
    case 'nudgeBack':
    case 'nudgeFwd':
      if (press) engine.tempo({ cmd: 'nudge', beats: target === 'nudgeFwd' ? 1 / 16 : -1 / 16 });
      break;
  }
}

function onMessage(input: string, m: MidiMsg): void {
  const st = useControl.getState();
  const key = controlKey(input, m);
  const wasOn = down.get(key) ?? false;
  down.set(key, m.value >= 64 || (m.type === 'note' && m.value > 0));
  const seen = `${input}: ${m.type === 'cc' ? 'CC' : 'Note'} ${m.number} · ch ${m.channel + 1} = ${m.value}`;
  if (st.midiSeen !== seen) st.set({ midiSeen: seen });
  // Learning: the first control moved (a note pressed, a CC turned) becomes the function's control.
  if (st.midiLearn) {
    if (m.type === 'note' && m.value === 0) return;
    const target = st.midiLearn;
    const mapping: MidiMapping = { target, input, type: m.type, channel: m.channel, number: m.number };
    const rest = st.settings.midiMap.mappings.filter((x) => x.target !== target && !matches(x, input, m));
    st.update({ midiMap: { mappings: [...rest, mapping] } });
    st.set({ midiLearn: null });
    useShow.getState().notify(`${targetById(target)?.label ?? target} ← ${describeMapping(mapping)}`);
    return;
  }
  for (const map of st.settings.midiMap.mappings) {
    if (!matches(map, input, m)) continue;
    const target = targetById(map.target);
    if (target) run(map.target, interpret(target.kind, m, wasOn));
  }
}

function listen(inputs: Iterable<MIDIInput>): void {
  for (const input of inputs) {
    if (listening.has(input)) continue;
    listening.add(input);
    // addEventListener, so the MIDI clock's onmidimessage on the same port keeps working.
    input.addEventListener('midimessage', (e) => {
      const m = parseMidi((e as MIDIMessageEvent).data ?? []);
      if (m) onMessage(input.name ?? input.id, m);
    });
  }
}

/** Start listening to every MIDI controller (and ones plugged in later). */
export async function startMidiMap(): Promise<void> {
  if (access || typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) return;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    access = null;
    return;
  }
  const refresh = (): void => {
    if (!access) return;
    listen(access.inputs.values());
    const inputs = Array.from(access.inputs.values()).map((i) => ({ id: i.id, name: i.name ?? i.id }));
    useControl.getState().set({ midi: { ...useControl.getState().midi, inputs } });
  };
  access.addEventListener('statechange', refresh);
  refresh();
}

export function learn(target: string | null): void {
  useControl.getState().set({ midiLearn: target });
}

export function unmap(target: string): void {
  const st = useControl.getState();
  st.update({ midiMap: { mappings: st.settings.midiMap.mappings.filter((x) => x.target !== target) } });
}
