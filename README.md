# BOOFVIZ

Real-time audio visualizer and auto-VJ for Windows (macOS second). It listens to anything playing on the computer (Serato, Rekordbox, Traktor, Spotify, YouTube, DAWs) and renders beat-locked visuals to a clean output window for a projector, LED wall or second screen.

> **Status: Phase 1 (Foundation) complete.** The Electron shell, control and output windows, WASAPI loopback capture, AudioWorklet analysis with a full `AudioFrame`, a basic auto-BPM and tap tempo, the debug HUD, and a spectrum-bar EQ. See [Roadmap](#roadmap).

## Run it (Windows)

Requirements: **Node.js 22.12+** and Git.

```powershell
git clone https://github.com/boofpackx/boofviz.git
cd boofviz
git checkout claude/serene-mccarthy-4ikjfy
npm install
npm run dev
```

The control window and the output window open together. On Windows, BOOFVIZ starts **System Audio** right away. Play a track in Serato, Rekordbox or Spotify and the EQ reacts within a few seconds. Press **F** to fullscreen the output, and pick its display from the top bar.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run build` then `npm start` | Production build, then run it |
| `npm test` | DSP unit tests (FFT, loudness, onsets, BPM, phase lock, drop detection) |
| `npm run smoke` | End-to-end test: launches the built app, plays a synthetic 128 BPM track, checks tempo lock and output sync, saves screenshots to `test-output/` |
| `npm run typecheck` | TypeScript checks for the main and renderer code |
| `npm run dist:win` | Build a Windows installer into `release/` |

### Audio sources

* **System Audio (Windows):** WASAPI loopback of the *default output device*. No drivers are needed. If your DJ controller's sound card isn't the Windows default output, either make it the default or use one of the options below.
* **Input device:** any mic, line-in, audio interface or DJ mixer USB input. For interfaces with more than 2 channels you pick the stereo pair.
* **Virtual cable:** VB-Audio Cable, VoiceMeeter and BlackHole (macOS) are detected and badged. Use the in-app **Routing guide** to isolate the DJ software from system sounds.
* **Local file:** drop an MP3, WAV or FLAC anywhere on the control window.

### Keyboard

| Key | Action |
| --- | --- |
| `T` | Tap tempo (switches the tempo source to Tap) |
| `[` / `]` | Nudge the beat by 1/16 |
| `Enter` | Resync the downbeat (the nearest beat becomes bar 1 / phrase start) |
| `F` | Fullscreen output (opens it if it's closed) |
| `O` | Open or close the output window |
| `B` | Blackout |
| `D` | Toggle the debug HUD (preview only, never in the output) |
| `H` | Hide UI (preview fills the window) |

Settings are saved to `%APPDATA%/BOOFVIZ/settings.json`.

## Architecture

```
src/
  main/                 Electron main process
    index.ts            app bootstrap, IPC, throttling switches
    windows.ts          control + clean output windows, display memory, analysis port wiring
    audioCapture.ts     permissions + getDisplayMedia → WASAPI loopback handler
    settingsStore.ts    %APPDATA%/BOOFVIZ/settings.json (debounced, atomic writes)
  preload/              contextBridge API (window.boofviz), MessagePort hand-off
  shared/
    types/audio.ts      AudioFrame, AnalysisSettings, worklet/worker wire protocol
    types/engine.ts     Layer, Scene, Modulator, Macro, Preset, Renderer
    settings.ts ipc.ts  persisted settings schema, IPC channel contracts
  renderer/
    control.html        control window (React + Zustand + Tailwind)
    output.html         clean output window (no React, no UI, no cursor)
    src/
      audio/
        worklet/analyzer.worklet.ts   audio thread: gain, auto-gain, FFTs, onset flux, LUFS
        analysis.worker.ts            worker: bands, onsets, energy, drops, BPM + beat clock
        dsp/                          pure, unit-tested DSP (fft, spectrum, onset, loudness…)
        tempo/                        autocorrelation BPM estimator, PLL beat clock, tap tempo
        frameBuilder.ts               per-frame AudioFrame assembly, latency offset, event latching
        AudioEngine.ts                sources → worklet → worker → consumer ports
      engine/
        three/ThreeRenderer.ts        WebGL2 backend (HDR linear target → ACES → sRGB + dither)
        generators/SpectrumBars.ts    Phase 1 generator
        shaders/                      raw GLSL passes
        palettes.ts                   curated 5-colour palette packs (linear-light)
      control/                        React UI, debug HUD, store
      output/                         output window entry
tests/                  vitest DSP tests + synthetic signal generators
scripts/                smoke test + test-track synthesizer
```

### Data flow

```
 capture (loopback / device / file)
        │  Web Audio graph (control window)
        ▼
 AudioWorklet ── RawHop every 512 samples (pooled buffers, zero steady-state allocation)
        │  MessagePort
        ▼
 Analysis Worker ── AnalysisPacket (~94/s): spectrum, bands, onsets, energy, drop, tempo state, clock sync
        │                                  │
        ▼ MessagePort                      ▼ MessagePort (direct renderer↔renderer, via main)
 Control window                      Output window
 AudioFrameBuilder → preview + HUD   AudioFrameBuilder → clean output
```

Both windows receive identical packets. Each one rebuilds the same `AudioFrame` every render frame and extrapolates the beat clock from a shared audio-clock↔epoch mapping, so they agree on beat phase (measured at 0.00 ms difference in the smoke test). The output renders independently, so UI work in the control window can't drop output frames.

### Core interfaces

* **`AudioFrame`** (`src/shared/types/audio.ts`) is the single object every visual reads: the 2048-bin log spectrum, 7 auto-normalized bands with per-band attack/release, `bands32`, waveform and stereo, RMS/peak/LUFS, energy and its trend, one-frame onsets (kick/snare/hat/any), BPM, a continuous beat counter, beat/bar/phrase phase, downbeat and phrase-start flags, brightness, flux, drop and silence.
* **`Layer` / `Scene`**: up to 8 layers, each with a source (generator, clip, text, logo or camera), an FX chain, a blend mode, opacity, an optional mask, and modulators.
* **`Modulator`**: audio, tempo, LFO, envelope or random sources, with amount, offset, curve, clamp and invert. Several can be summed per parameter.
* **`Preset`**: versioned JSON (`schema: 1`) with layers, camera, macros and transition-in. Templates are the same shape with `isTemplate`.
* **`Renderer`**: a backend-agnostic `init / setScene / resize / render / dispose`. `ThreeRenderer` is the WebGL2 implementation, and a WebGPU backend can implement the same contract.

## Roadmap

1. **Foundation**: done ✅
2. Engine core: compositor, modulation, macros, palettes, preset save/load, and the Equalizers + 2D categories
3. Beat engine: a stronger beat tracker, Ableton Link, MIDI Clock in, beat-quantized events
4. 3D and techniques: terrain, camera, particles, raymarching, post-FX, and the 3D / Trippy / Mellow categories
5. Clip engine
6. Performance layer: autopilot, transitions, cue, MIDI learn, sets
7. Output pro: Spout, recording, keystone, auto-quality, photosensitivity limiter
8. Polish: 100+ presets, onboarding, packs
