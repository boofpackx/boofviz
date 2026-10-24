# Real 80s: things you actually saw in the 80s

A set of looks built from the visuals of the 80s, shown the way people saw
them: on a tube, off a cassette, through a camcorder. The aim is cool things
to watch, not models of objects: no recreated gadgets, dashboards or toys.
Homages by likeness only: no product, game, film or brand names (the
trademark test in `tests/engine.test.ts` guards this).

## Generators
- **`vector80` Vector arcade.** Glowing beam lines drawn with `StrokeBatch`,
  brighter dots where the beam lingers on a corner, a little beam jitter, and
  persistence from the look's feedback effect. Modes: `rocks`, `web` (lanes
  lit by the spectrum, a new tube shape every phrase), `tank`, `trench`
  (catwalks placed in beats, so they pass the camera on the beat) and `laser`
  (beams through haze, a Lissajous figure pushed by the stereo signal).
- **`loader8` Tape loader.** Drawn into a pixel buffer at the machine's own
  resolution and shown with nearest filtering. `micro48`: pilot and data
  stripes as tape pulses whose bits are read off the waveform, the screen
  loading in the machine's memory order (thirds, then a line of every
  character row), then attributes; pictures converted with two colours per
  8×8 cell and ordered dither. `micro64`: boot, LOAD, turbo stripes, a
  multicolour picture (background plus three colours per 4×8 cell), then the
  lyric loop or the one-line maze.
- **`demo80` 80s computer demo.** One fat-pixel shader: `lightSynth`
  (stateless: each burst is a function of its beat, folded for 4- or 8-way
  symmetry) and `boing` (the checkered ball, landing on the beat).
- **`hifi80` VFD analyzer.** A canvas look: VFD segment columns with ghost
  segments, amber/red tops, peak hold, mesh and filaments, and 14-segment
  text (`vfd.ts`).

- **`raytrace80` Raytrace reel.** One shader, Whitted-style: ellipsoid
  spheres (squashed on landing), a chequered floor, reflection, refraction
  and hard shadows over up to five bounces, coarse un-smoothed pixels, a new
  camera every phrase revealed by a scanline sweep.
- **`dots80` Dot demo.** Point sprites shaded as balls, drawn into a
  low-resolution target with depth and upscaled with sharp pixels; shapes
  are functions of the dot index, morphed per dot with a stagger.
- **`vsynth80` Video synth.** Its own feedback buffers at reduced
  resolution: the waveform seeded as a line or ring, zoomed and turned each
  frame, then posterised into palette bands with contour lines.
- `vector80` also has `fractal` (ridged value-noise terrain in wireframe),
  laser routines per phrase, and a tinted overlay multiplied over white beams.

## Looks (category Real 80s)
Rock Field, Tube Web, Tank Sight, Trench Run, Fractal Flight, Laser Show,
Overlay Rocks, Overlay Battle, Tape Loading, Press Play on Tape, One-Line
Maze, Raytrace Reel, Chrome Night, Glass Row, Dot Morph, Dot Tunnel,
Light Synth 84, Checkered Ball, Video Synth, Colourizer Mirror,
VFD Analyzer, VFD Mirror.
