# Phase 7 plan: Output pro

Phase 7 in the roadmap is "Output pro: Spout, recording, keystone,
auto-quality, photosensitivity limiter". It is about the screen people
actually watch: that it is safe, that it never stutters, that it fits the
projector, and that it can be sent to other apps or kept as a video.

The five parts ship in this order, safest and smallest first. Each one is a
release on its own.

| # | Part | Why this order |
|---|---|---|
| 1 | Flash safety (photosensitivity limiter), and a master Strobe that works | Safety before anyone shows BOOFVIZ in public; small; touches only the output pass |
| 2 | Auto-quality | Keeps shows smooth on any laptop; the hooks (`renderScale`, `stats`) are already there |
| 3 | Recording | Clips for socials and demos; pure Electron/browser APIs, no native code |
| 4 | Keystone | Corner-pin for angled projectors; one more fullscreen pass |
| 5 | Spout | The biggest job: a native Windows module, like `native/link` |

## Found while planning: the master Strobe does nothing
The Perform panel's **Strobe (hold)** button and the MIDI *Strobe (while
held)* mapping set `globals.strobe`, but no window draws it: the compositor,
the output pass and `ThreeRenderer` never read it (blackout and freeze do
work). The README lists strobe as done. Part 1 fixes it, because a master
strobe is exactly what the limiter has to govern.

## 1. Flash safety

### The rule
The broadcast guideline (ITU-R BT.1702, the Harding test and the WCAG
"three flashes" rule): no more than **3 flashes in any 1 second**, where a
flash is a pair of opposite changes in brightness of at least 10% of full
brightness, the darker state below 80%, over at least a quarter of the
screen. Saturated red flashes count with a lower threshold.

### How
All on the GPU, in the output window and the preview alike, after
tonemapping (the limiter judges what the viewer sees, in display light):

1. **Measure.** The output pass writes the frame to an LDR target instead of
   the screen. A small pass averages it into a 16×9 grid of cell luminance
   (and a "red" value per cell: red minus the other two).
2. **Detect.** A 16×9 state texture, ping-ponged, keeps per cell the last
   turning point of brightness and a decaying count of transitions in the
   last second. A transition is a change of ≥ 0.1 from the last turning
   point. The frame's flash rate is the rate over the cells that changed
   together, counted only when they cover ≥ 25% of the screen (the grid
   makes the area rule cheap).
3. **Limit.** While the rate would pass 3 per second, the final pass blends
   each pixel toward the previous displayed frame (a full-res history
   target), with a strength that eases in over a few frames and back out
   when the flashing stops. Strong enough that a 10 Hz white strobe shows as
   a steady glow under the 0.1 swing; off entirely for normal looks, so kick
   pulses and cuts keep their punch.
4. **Master Strobe.** Implemented in the output pass on the beat clock (on
   16ths while held, as the flash count allows), so it always goes through
   the limiter and agrees between windows.

### Settings and UI
- `settings.safety.flashLimit: 'off' | 'standard' | 'strict'`, **standard by
  default**. Strict also limits red flashes and lowers the area to 10%.
- A "Flash safety" row in the Output tab, and a small shield in the HUD that
  lights while the limiter is working.
- Turning it off asks once ("Only for private use, never for an audience").

### Proof
- Unit tests for the detector on synthetic luminance traces: a 10 Hz strobe,
  a 2 Hz pulse (allowed), a cut, a strobe on 20% of the screen (allowed in
  standard).
- An e2e capture (like `fret:capture`): render the hardest looks (the
  strobe-heavy looks, flash transitions, master Strobe held) through the built app, read
  back the grid, and fail if any 1-second window has more than 3 flashes.
- Cost: the measure and detect passes are tiny; the history blend is one
  fullscreen pass. Budget: under 0.3 ms at 1080p.

## 2. Auto-quality
- Watch `RenderStats.frameMs` against the output display's refresh rate
  (the main process already lists it per display; send it to the output
  window). If frames run over budget for ~2 s, step
  `renderScale` down (1 → 0.85 → 0.7 → 0.5); when they run well under for
  ~10 s, step back up. Steps land on a bar line so nobody sees them as a
  glitch.
- Next, the costly effects get a quality knob (bloom taps, raymarch steps,
  particle counts), read from one `quality` level in `RenderContext`.
- Setting: Auto (default) / fixed. The HUD shows the current level.

## 3. Recording
- Record the output window's canvas: `canvas.captureStream(fps)` and
  `MediaRecorder` (H.264 in MP4 where Chromium supports it, else VP9 in
  WebM), with the app's audio from the same capture BOOFVIZ already listens
  to, so picture and sound stay in sync.
- Files are streamed to disk from the main process
  (`Videos/BOOFVIZ/<date> <song>.mp4`), so long sets don't fill memory.
- Record / stop on a button, a key and MIDI. Optional: start at the next bar,
  or record one song.

## 4. Keystone
- A corner-pin (homography) in the final pass, per output display, saved in
  `settings.output.keystone`. Edit mode shows a grid and four handles on the
  projector; arrow keys nudge.
- Optional soft edge and a mask for odd screen shapes come after.

## 5. Spout (Windows)
- A native module in `native/spout` (built like `native/link`) that shares
  the output's texture with OBS, Resolume, TouchDesigner and others, without
  a screen capture.
- Electron's offscreen rendering with shared textures, or a readback into
  the Spout sender as a fallback. A spike first decides which, with a latency
  and frame-time measurement.
- Syphon on macOS later, behind the same interface.

## Done means
Each part: typecheck and tests green, the e2e or smoke test for it, a line in
the README (and the roadmap tick when all five are in), and release notes in
`docs/releases/`.
