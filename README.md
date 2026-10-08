# BOOFVIZ

Real-time audio visualizer and auto-VJ for Windows (macOS second). It listens to anything playing on the computer (Serato, Rekordbox, Traktor, Spotify, YouTube, DAWs) and renders beat-locked visuals to a clean output window for a projector, LED wall or second screen.

> **Status: Phase 6 (Performance layer) complete.** Over 200 built-in looks, synced lyrics from Spotify, archive footage, and clips cut to the beat. See [Roadmap](#roadmap).

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
| `npm test` | Unit tests: DSP (FFT, loudness, onsets, BPM, phase lock, drops) and engine (every preset valid and lossless through JSON, macros, modulation, palette cycling) |
| `npm run smoke` | End-to-end test: launches the built app, plays a synthetic 128 BPM track, checks tempo lock and output sync, then drives the UI (load a preset, right-click → Modulate by → Bass, drag a macro, undo, Save as) |
| `npm run lyrics:e2e` | End-to-end test of Spotify login, now playing and synced lyrics against local mock services (`scripts/mock-services.mjs`) |
| `npm run lyrics:smtc:e2e` | The same with a mock Windows media session (`BOOFVIZ_SMTC_URL`): hybrid mode, request counts against polling, a rate limit, Spotify closing and reopening |
| `npm run tour` | Loads every preset and template in the running app and screenshots the output window into `test-output/tour/` (`npm run tour -- lyrics` tours only matching presets) |
| `npm run presets:format` | Rewrites every file in `presets/` in canonical form (`presets:check` only reports) |
| `npm run typecheck` | TypeScript checks for the main and renderer code |
| `npm run dist:win` | Build a Windows installer into `release/` |

### Audio sources

* **System Audio (Windows):** WASAPI loopback of the *default output device*. No drivers are needed. If your DJ controller's sound card isn't the Windows default output, either make it the default or use one of the options below.
* **Input device:** any mic, line-in, audio interface or DJ mixer USB input. For interfaces with more than 2 channels you pick the stereo pair.
* **Virtual cable:** VB-Audio Cable, VoiceMeeter and BlackHole (macOS) are detected and badged. Use the in-app **Routing guide** to isolate the DJ software from system sounds.
* **Local file:** drop an MP3, WAV or FLAC anywhere on the control window.

### Building looks

* **Library (left):** search, category and tag filters. Click a preset to make it live. `Tab` / `Shift+Tab` step through the filtered list. Drop `.json` preset files anywhere on the window to import them.
* **Layers (right):** scene palette, palette cycling (beat / bar / phrase / drop / energy) and hue rotation; up to 8 layers with blend mode, opacity and a luma or shape mask; per-layer generator parameters and FX chain (feedback trails, bloom, mirror, kaleidoscope, RGB split, gradient map, grade, vignette, grain).
* **Right-click any parameter:** *Modulate by…* (audio bands, onsets, beat/bar/phrase waves, LFO, envelopes, random) or *Assign to macro*. Modulated sliders show a live meter of where the value actually is.
* **Macros (bottom):** 8 knobs per preset. Drag, use the mouse wheel, or Shift-drag for fine control; double-click resets. Right-click a knob to edit its targets and ranges.
* **Save** (`Ctrl+S`) writes a user copy (built-ins are read-only). *Save as*, *Template* (keeps layers and routing, clears colours) and *Export* are next to it. Everything is undoable (`Ctrl+Z`, `Ctrl+Shift+Z`), and the working look is restored on the next launch.

User presets live in `%APPDATA%/BOOFVIZ/presets` (templates in `…/templates`) as plain JSON.

### Lyrics & Spotify now playing

BOOFVIZ can show the synced lyrics of whatever is playing, either as a look of its own (the **Lyrics** category) or over every look while presets change and shuffle. The audio still comes from System Audio (or any input) as usual; the player only tells BOOFVIZ *which* track is playing and where.

**On Windows there's nothing to set up.** BOOFVIZ follows whatever is playing through Windows (the media session behind the volume flyout): Spotify (Free or Premium), TIDAL, Apple Music, Deezer, or YouTube and SoundCloud in a browser. Spotify is preferred when it's playing. The song, its position, play / pause and the album cover come from there, the Lyrics tab's Prev / Play / Next buttons control the player through Windows (no Premium needed), and browser titles like "Artist - Title (Official Video)" are tidied so lyrics are found. Logging in to Spotify is optional: it gives exact song names and positions, and the steps are below.

* **Album cover colours** (Master tab): every look takes the main colours of the playing song's cover, easing over as songs change.
* **Automatic timing** (Lyrics tab, on by default): at the start of each song played from the top, BOOFVIZ measures how late it is heard against what the player reports and moves the lyrics to match (the median of the last few songs). Speaker or Bluetooth delay after the system mix isn't visible to System Audio capture: use the Offset slider for that.

To log in to Spotify (optional on Windows, needed on macOS):

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), add the redirect URI `http://127.0.0.1:43821/callback` (exactly, Spotify rejects `localhost`) and tick **Web API**.
2. In BOOFVIZ open the **Lyrics** tab (left panel), paste the app's **Client ID** and click **Connect**. Your browser asks you to log in to Spotify once; after that BOOFVIZ remembers the session (the refresh token is encrypted with the OS keychain; without one it is kept in memory only). **Disconnect** deletes it.
3. Turn on **Show lyrics over every look**, or load a preset from the **Lyrics** category. The lyrics generator (karaoke sweep, punch-in lines or typewriter) can also be added as a layer to any look.

How lyrics are found, in order: your own `.lrc` files in the lyrics folder (`%APPDATA%/BOOFVIZ/lyrics`; **Open lyrics folder**, or drop an `.lrc` on the Lyrics tab to attach it to the playing track), then a local cache, then [LRCLIB](https://lrclib.net) (free, community-made synced lyrics). Files in the folder (and its subfolders) are matched by name (`Artist - Title`, `Title - Artist`, `01. Title`, the Spotify track id, or just the title when only one file has it) or by the `[ar:]` / `[ti:]` tags inside them, and a file saved while a song plays (by hand or by another program) is used straight away. With no lyrics, looks show the song's name; with no song, they show no words at all. Titles like "Song - 2011 Remaster" or "Song (feat. X)" are cleaned up for the search. Turn off **Search lyrics online** to stay offline.

On Windows, BOOFVIZ follows the Spotify desktop app through the Windows media session (the one behind the volume flyout): track changes, play / pause and seeks arrive at once, and the Spotify Web API is only asked to name each new song and to check the position now and then (a few requests a minute instead of one every few seconds), which keeps clear of Spotify's rate limit. If Spotify does rate-limit BOOFVIZ anyway, songs and lyrics keep coming from the media session. Without the desktop app (Spotify on another device, macOS) BOOFVIZ asks the Web API every few seconds instead. A small background PowerShell process reads the media session; set `BOOFVIZ_SMTC=off` to turn it off.

If lines land early or late, use the **Offset** slider (±2 s, +100 ms steps; + shows lines earlier). Spotify's reported position, your audio output latency and the projector all add a little delay, and the right offset depends on your setup.

Limits and caveats:

* A Spotify app in *development mode* works for up to 5 users you add in the dashboard, and the app owner needs Spotify Premium. Play / pause / next / previous from BOOFVIZ also need Premium; showing what is playing does not.
* **Lyrics are copyrighted.** Showing them at home or for personal use is one thing; displaying them at a public or commercial event needs a licence from the rights holders (e.g. via Musixmatch or LyricFind). LRCLIB provides no licence.
* **Spotify's Developer Policy restricts synchronizing Spotify content with visual media.** BOOFVIZ only reads now-playing metadata (title, artist, position, album art) and never touches Spotify audio, which comes from system capture like any other source. Still, review the policy before any commercial release or public use of this feature.

### Keyboard

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Next / previous preset in the library view |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+S` | Save preset |
| `T` | Tap tempo (switches the tempo source to Tap) |
| `[` / `]` | Nudge the beat by 1/16 |
| `Enter` | Resync the downbeat (the nearest beat becomes bar 1 / phrase start) |
| `F` | Fullscreen output (opens it if it's closed) |
| `O` | Open or close the output window |
| `B` | Blackout |
| `C` | Cue mode on/off (looks load into the preview only) |
| `G` | GO: the cued look goes to the screen on the next bar |
| `D` | Toggle the debug HUD (preview only, never in the output) |
| `H` | Hide UI (preview fills the window) |

Settings are saved to `%APPDATA%/BOOFVIZ/settings.json`.

### Performing live (Perform tab)

* **Cue and GO:** with Cue mode on, looks you pick load into the preview only, so you can tweak the next one while the screen keeps the current one; GO sends it on the next bar (or beat / phrase, per the launch setting) with its transition. Autopilot waits while you cue.
* **Live buttons:** blackout, strobe while held, and freeze (the screen holds its last frame while the preview keeps running).
* **Sets:** a pool of looks played in order (choose the pool as the shuffle pool and set the order to In order); autopilot walks through it, or step through it from MIDI.
* **MIDI learn:** any controller (a DJ controller works alongside your DJ software). Press **Learn** next to a function, then press the pad or move the knob: GO, cue, next / previous look, browse with an endless knob, set steps, shuffle, autopilot, starred looks 1–9, macros 1–8, blackout, strobe, freeze, brightness, speed, reactivity, saturation, hue, trails, tap tempo, downbeat and nudges. Mappings are saved. If your DJ software has the controller open and BOOFVIZ doesn't see it, Windows is letting one app use it at a time; an up-to-date Windows 11 shares it between apps.

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
        registry.ts                   every generator / effect parameter, declared once as data
        modulation.ts                 modulator evaluation (deterministic across windows)
        scenePlan.ts                  macros applied + modulators compiled; per-frame resolve, no allocation
        palettes.ts                   palette packs, cycling and hue rotation
        presetIO.ts                   normalize / serialize / template (lossless round-trip)
        library.ts                    built-in presets bundled from presets/
        three/ThreeRenderer.ts        WebGL2 backend (compositor → ACES → sRGB + dither)
        three/Compositor.ts           layers → FX chain → blend + mask, in linear HDR
        three/StrokeBatch.ts          anti-aliased glowing polylines (scopes, line work)
        fx/effects.ts                 feedback, bloom, mirror, kaleidoscope, RGB split, gradient map, grade, vignette, grain
        generators/                   12 generators (EQs, radial, 3D bar city, spectrogram, scope, lines,
                                      shape play, Swiss grid, tiles, Memphis, kinetic type, background)
      control/                        React UI, debug HUD, store
      output/                         output window entry
presets/                built-in presets and templates (canonical JSON, shipped with the app)
tests/                  vitest DSP + engine tests, synthetic signal generators
scripts/                smoke test, preset tour, preset formatter, test-track synthesizer
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
* **`Modulator`**: audio, tempo, LFO, envelope or random sources, with amount, offset, curve, clamp and invert. Several can be summed per parameter. `amount` is a fraction of the target parameter's range (1.0 sweeps it fully), so modulators behave the same on any parameter. Random and tempo sources derive from the shared beat clock, so the preview and the output always agree.
* **`Preset`**: versioned JSON (`schema: 1`) with layers, camera, macros and transition-in. Templates are the same shape with `isTemplate`.
* **`Renderer`**: a backend-agnostic `init / setScene / resize / render / dispose`. `ThreeRenderer` is the WebGL2 implementation, and a WebGPU backend can implement the same contract.

## Roadmap

1. **Foundation**: done ✅
2. **Engine core**: done ✅. Compositor, modulation, macros, palettes, preset save/load
3. **Beat engine**: done ✅. Stronger beat tracker, Ableton Link, MIDI Clock in, beat-quantized changes
4. **3D, techniques and looks**: done ✅. 3D scenes, raymarching, SDF text, particles, post-FX, and the era looks (Real 90s, Y2K, Lost Media, Retro TV, Brutalist, Neo 90s, Vintage, Lyrics)
5. **Clip engine**: done ✅. Clips cut to the beat from the archive or your own videos folder (the next clip cued before its cut), beat-synced stutter, reverse, scratch and freeze, and music-video mode: your own video for the playing song (named "Artist - Title" in the videos folder), in time with the song
6. **Performance layer**: done ✅. Cue and GO, MIDI learn for any controller, sets played in order, blackout / strobe / freeze, on top of the beat-quantized launches and 9 transition types
7. Output pro: Spout, recording, keystone, auto-quality, photosensitivity limiter
8. Polish: onboarding, packs, more Trippy, Mellow and 3D Worlds looks
