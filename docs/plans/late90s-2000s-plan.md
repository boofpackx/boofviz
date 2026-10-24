# Plan: late 90s and early 2000s, the real thing

New looks built around the most recognisable things people saw between
about 1997 and 2005, plus effects for the screens they saw them on. The
rules from Real 80s stand:

- **Visuals, not objects.** Each look is a phenomenon, a rendering style or
  a material of the era, never a detailed model of a gadget.
- **Recognised by likeness only.** No product, film, game, band or brand
  names anywhere a user sees them.
- **Every look follows the colour scheme** and ships a palette of its
  authentic colours.

Not in this plan because the app already has them: the screensavers (pipes,
maze, flying disks, bouncing lines, starfield, bouncing logo), code rain,
the 32-bit console canyon, the megademo, pager, virtual pet, homemade web
page, error boxes, fax, teletext, handheld LCD, the vector web cartoon,
liquid chrome, the glass meadow, holo foil, lava lamp, glow stars,
stereograms, the dance-arrow and guitar games, the music channel, dial-up,
early web video and the MP3 player skin.

---

## Part 1: how the quality is ensured

Every look goes through the same seven gates, in order. A look that fails a
gate goes back, it does not move on. Each batch is shown to you as a
contact sheet and a short score card before anything is merged.

### Gate 1: the reference brief (before any code)
A written brief per look, kept in `docs/plans/briefs/<look>.md`:
- **The tells:** the 8-12 details that make people say "that's it" (the
  exact colours, the motion, the artefacts, the timing). Example for the
  fractal flame: log-density "smoke" falloff, white-hot folds, slow morph
  between shapes, colour that follows the fold, grain in the dark.
- **The anti-tells:** what would make it fake or generic (for this era:
  vaporwave pastels, synthwave sunsets, modern flat design, clean 4K
  smoothness where the original was soft).
- **The music map:** what happens on every musical event: kick, snare,
  hats, bass, vocals, each bar, each phrase, the build, the drop, the
  breakdown, silence.
- **The variety plan:** what changes every bar, every phrase and every
  couple of minutes, so it still surprises at minute five.

### Gate 2: the thumbnail test (a still, before animation)
One still frame is built first and judged at **320 pixels wide for one
second**: if it doesn't read as the thing that small, the idea or the
composition is wrong, and it is fixed before any animation work. Most
of the recognition is decided here.

### Gate 3: the music test (real musical situations)
The single synthetic test track is not enough. A small test-audio set is
built first (`scripts/make-test-suite.mjs`), all synthetic, all in the repo:
- 128 BPM four-on-the-floor with a 16-bar build, a drop and a breakdown
- 85 BPM half-time groove with a sung-like melody line (vocal detection)
- 174 BPM breakbeat (fast, busy hats)
- a quiet intro and a hard stop (silence handling)

Each look is captured on all four at fixed beats: a contact sheet every
half beat across two phrases, plus the bar before the drop, the drop, the
breakdown and silence. Every row of the music map from Gate 1 must be
visible on the sheet.

### Gate 4: the long-run test (does it stay interesting?)
A three-minute capture, one frame every ten seconds, on the 128 BPM track.
No two frames in a row may look alike; if the look settles into a loop,
the variety plan is not working.

### Gate 5: the screen test
- **Aspect ratios:** 16:9, 4:3, 21:9 and a tall 9:16 LED strip. Nothing
  important cut off, nothing stretched.
- **Resolution:** sharp at 4K, still right at 720p.
- **Palettes:** its own palette, plus a dark, a pastel and a mono palette,
  palette cycling and album-cover colours. It must still look good, not
  just change colour.
- **Preview and output** windows show the same frame (everything driven by
  the shared beat clock, no free-running randomness).

### Gate 6: the safety and performance test
- **Photosensitivity:** no full-screen flash more than three times a
  second, including fireworks, glitches and drops.
- **Performance:** each look's frame time is measured in the app against
  the existing looks; heavy looks (fractal flame, bullet time) scale their
  point counts and resolution to keep the frame rate.
- **Leaks:** the existing soak test runs each new look for ten minutes;
  GPU memory and programs must stay flat.

### Gate 7: the score card
Each look is scored 1-5 on six things, and **nothing ships with a score
under 4**:

| | What it means |
|---|---|
| Recognisable | People who were there name it in seconds |
| Musical | You can see the song: beats, sections, drops |
| Beautiful | A frame grab would make a good poster |
| Fresh | Nothing else in the app looks like it |
| Alive | Still surprising after five minutes |
| Solid | Every screen, palette and machine; no errors |

Then the usual: typecheck, all tests, preset formatting, the trademark
test (extended with the era's names) and a tour of every preset in the app.

### What you see
For each batch: the contact sheets, the score card and a one-line note on
anything I wasn't sure of. You say what to change before it is merged.

---

## Part 2: the looks, most iconic first

Ranked by how instantly people recognise them. Each has the tells, the
music map and the build in short; the full brief comes at Gate 1.

### Batch A: the instantly iconic

**1. Silhouette Dance** (the 2003 music-player ads)
Flat, loud single-colour backgrounds (lime, hot pink, electric blue,
orange) switching every bar, pure black dancing silhouettes, and the thin
white earphone cords whipping with every move.
- *Tells:* totally flat colour, no shading, silhouettes with no detail,
  the white cords as the only other element, hard cuts on the bar.
- *Music:* moves land on the beat (a library of dance poses blended on the
  beat clock), cords whip on the snare, colour cut every bar, two dancers
  on the drop.
- *Build:* silhouettes from a small stick skeleton with thick rounded
  limbs (capsules), so no detail is needed: the silhouette hides it.
  Highest recognition, but the riskiest: **it gets a Gate 2 prototype
  first, and it is dropped if the dancers don't move convincingly.**

**2. Plugin Era** (media-player visualizer plugins, 1999-2004)
The visualizer everyone left running at parties: the whole frame warping
through a feedback mesh while waveforms and rings are drawn on top, with
"video echo", centre darkening and the odd garish inversion; it blends into
a new preset every phrase.
- *Tells:* per-vertex mesh warp (not per-pixel), the soft blur of a small
  buffer stretched to the screen, smooth preset crossfades.
- *Music:* bass drives zoom and warp, kick flashes the waves, hats spark,
  the drop forces a hard preset cut.

**3. Bullet Time** (the 1999 frozen-moment shot)
Glass shards, droplets and dust frozen in the air while the camera swings
round them; time snaps back and everything flies, then freezes again. The
green-tinted, high-contrast grade of that film.
- *Tells:* the slight stutter of the orbit (it was dozens of stills), the
  air ripples trailing the shards, motion streaks only while time runs.
- *Music:* the burst on the phrase downbeat, frozen orbit through the
  build, time back on the drop.

**4. Y2K Rollover** (New Year's Eve 1999)
A huge countdown to the end of each phrase, fireworks at zero, and then the
bug: the date rolls over to 1900, digits corrupt, and the screen falls into
a blue fatal-error page for a bar before the next countdown.
- *Music:* zero lands exactly on the phrase downbeat; fireworks on the
  kicks after midnight; the glitch length follows the energy.

**5. Glowstick Rave** (late-90s raves)
Neon glowstick trails in total darkness: long-exposure loops and figure
eights swung to the beat, liquid "gloving" patterns, the haze lit green
and magenta.
- *Tells:* the soft-core, hard-edge glow of chemical light, the dark room,
  trails that fade over a bar, the classic green, magenta, blue, yellow.
- *Music:* every stick swings on the beat grid; patterns change on the
  bar; on the drop the sticks are thrown up and spin.

**6. Fractal Flame** (the 1999 distributed screensaver)
Silky fractal flames like smoke made of light, morphing into a new shape
every phrase, folds burning white.
- *Build:* GPU chaos game into an HDR buffer with log-density tone mapping;
  a library of hand-picked flame shapes.

### Batch B: the bedroom and the club

**7. Plasma Globe** (the novelty lamp)
Violet lightning tendrils crawling out from the bright core to the glass,
splitting and flickering, gathering to one point on the kick, the whole
sphere crackling on the drop.
- *Tells:* the pink-violet tendrils with white-hot cores, the branching,
  the glow on the glass where a tendril lands. A sphere of light, not an
  object.

**8. Fiber Optic Lamp** (the novelty lamp)
A spray of glowing fibre tips fanning out of darkness, the colour wheel
turning through them, the tips swaying.
- *Music:* the colour wheel turns a notch every beat, the spray breathes
  with the bass, sparkles on the hats.

**9. Synesthesia Rail** (the 2001 trance rail shooter)
A wireframe data space where every lock-on and particle burst lands on the
song's real rhythm (from the note grid), the world changing form every
phrase.

**10. Trance Swoosh** (2000s trance compilation art)
Electric-blue swooshes arcing round a glowing core, anamorphic lens
streaks, star-bursts and hairline orbit rings.

### Batch C: materials and moments

**11. Console Boot Fog** (the 2000 console start-up)
Translucent towers rising out of a deep blue fog, light motes drifting,
a slow camera glide, the towers growing with the spectrum: the most
remembered boot screen of the decade, by mood alone.

**12. Aqua Gel** (the glossy gel interface material, 2000-2003)
A spectrum of translucent candy-gel capsules on pinstripes, glossy top
highlight, glowing bottom, coloured caustic shadow, jelly wobble on the
kick.

**13. Burn Disc** (the CD-R mix era)
A recordable disc spinning close-up, rainbow diffraction sweeping as the
light moves, the burned area growing ring by ring through the song.

### Batch D: rendering styles and screens

**14. Cel-Shade** (the cel-shaded console era): blobby forms and
ribbons in flat two-tone shading with thick ink outlines and a halftone
sky.

**15. Accelerator Demo** (3D card tech demos): a bump-mapped planet,
chrome rings and lens flares in 16-bit colour with its banding and dither.

**Effects for the era's screens:** *Skate Fisheye* (the late-90s
camcorder fisheye with black lens-hood corners), *DV interlace* (field
combing, DV dropouts) and *Early LCD* (ghosting, visible pixel grid,
washed blacks).

---

## Category and order

A new **Real 2000s** category for 2000-2005; the late-90s looks join
**Real 90s**; autopilot gets a *2000s night* playlist.

Before Batch A: the test-audio set and the capture script (Gate 3 and 4
tooling), so every look is judged the same way.

| Batch | Looks |
|---|---|
| Tooling | Test-audio set, contact-sheet and long-run capture scripts |
| A | Silhouette Dance (prototype gate), Plugin Era, Bullet Time, Y2K Rollover, Glowstick Rave, Fractal Flame |
| B | Plasma Globe, Fiber Optic Lamp, Synesthesia Rail, Trance Swoosh |
| C | Console Boot Fog, Aqua Gel, Burn Disc |
| D | Cel-Shade, Accelerator Demo, the three screen effects |

## Risks

- **Silhouette Dance** depends on convincing motion: prototype first,
  dropped rather than shipped weak.
- **Fractal Flame and Bullet Time** are the heaviest: adaptive point
  counts and reduced-resolution rendering.
- **Plugin Era** must not look like the existing feedback effect: the mesh
  warp and preset blending are what make it.
