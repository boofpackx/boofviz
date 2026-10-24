# Plan: late 90s and early 2000s, the real thing

Twelve new looks, each built around one thing people actually saw between
about 1997 and 2005, plus two effects for the screens they saw it on. Same
rules as Real 80s:

- **Visuals, not objects.** Each look is a phenomenon, a rendering style or
  a material of the era, never a model of a gadget.
- **Recognised by likeness only.** No product, film, game, band or brand
  names anywhere a user sees them (the trademark test gets the era's names).
- **Every look follows the colour scheme** (palette, cycling, cover colours)
  and ships a palette of its authentic colours.
- **Quality bar:** a reference list of the details that make it real, then
  build, then at least three screenshot rounds across the beat, a drop, a
  breakdown and a phrase change before it ships. At least two presets each.

Already in the app, so not in this plan: the screensavers (pipes, maze,
flying disks, bouncing lines), the 32-bit console canyon, the demoscene
megademo, pager, virtual pet, homemade web page, error boxes, fax,
teletext, handheld LCD, the vector-animation web cartoon, liquid chrome,
the glass meadow, holo foil, lava lamp, stereograms, the dance-arrow and
guitar games, the music channel, early web video and the MP3 player skin.

## Category

A new **Real 2000s** category for the 2000-2005 looks; the late-90s ones
join **Real 90s**. Autopilot gets a *2000s night* playlist.

## The looks

### Batch A: signature visuals

**1. Plugin Era** (media-player visualizer plugins, 1999-2004)
The visualizer everyone left running at parties: the whole frame warps
through a feedback mesh (zoom, rotate, swirl and ripple fields, the motion
smeared into trails) while waveforms, rings and dots are drawn on top, then
"darken centre", "video echo" and colour inversion flicker in on the beat.
Every phrase it blends smoothly into the next preset.
- *Music:* bass drives zoom and warp strength, the kick flashes the custom
  waves, the hats add sparkle dots, the drop triggers a hard preset cut.
- *Real details:* the mesh warp (a 32×24 grid of per-vertex motion, not
  per-pixel), the slight blur of a 512-pixel buffer stretched to the
  screen, the preset crossfade, the occasional garish full inversion.
- *Build:* a warp-mesh feedback generator with a small library of preset
  "recipes" (warp fields + wave shapes + post switches) and a blend between
  two recipes. Presets: *Plugin Party*, *Plugin Ambient*, *Plugin Hard Cuts*.

**2. Fractal Flame** (the distributed fractal screensaver, 1999)
Silky, glowing fractal flames, like smoke made of light, slowly morphing
from one shape into the next, the brightest folds burning white.
- *Music:* each phrase morphs to a new flame; the bass breathes the
  transform weights, the kick flares the brightest density, the drop
  shatters the flame into its sparks and lets it re-form.
- *Real details:* log-density tone mapping (the "smoke" look), per-
  variation colour indices, the slow morph between genomes, film grain in
  the dark.
- *Build:* GPU chaos game: a few hundred thousand points iterated in the
  vertex shader, splatted additively into an HDR buffer, then log-density
  tone mapped and coloured through the palette. A genome library of
  hand-picked variation mixes (linear, sinusoidal, spherical, swirl,
  horseshoe, julia, …). Presets: *Fractal Flame*, *Flame Embers*.

**3. Synesthesia Rail** (the trance rail shooter, 2001)
Flying through a wireframe data space where every shot, lock-on and burst
lands exactly on the music: targets drift in, get locked with a bracket on
the 16ths and burst into particles on the next beat, the space pulses with
the kick and the whole world changes form every phrase (grid ocean, tunnel,
lattice, open void).
- *Music:* lock-ons come from the note grid (kick, snare, hat, tones), so
  the visual literally plays the rhythm; the drop clears the screen.
- *Real details:* translucent glowing wireframe with additive bloom, the
  "quantised" feel (nothing happens off the grid), particle bursts in
  complementary colours, the thin lock-on brackets.
- *Build:* StrokeBatch for wireframe and brackets, a particle pool, the
  note grid for timing. Presets: *Rail Trance*, *Rail Ocean*.

**4. Trance Swoosh** (2000s trance compilation art)
Electric-blue light swooshes arcing around a glowing core, lens streaks,
star-bursts, thin orbit rings and hexagon grids fading in and out: the
look of every trance CD and club flyer around 2001.
- *Music:* swooshes launch on the kick and sweep for a bar, the core
  pulses with the bass, a big star-burst and anamorphic streak on the drop.
- *Real details:* the anamorphic horizontal lens streak, the soft cyan-to-
  white gradients, the over-the-top glow, the hairline orbit rings.
- *Build:* a shader generator (swoosh ribbons as SDF arcs, flare
  elements) with the existing bloom. Presets: *Trance Swoosh*,
  *Sunrise Set* (warm palette).

### Batch B: moments and materials

**5. Bullet Time** (the 1999 frozen-moment film effect)
A burst of glass shards, water droplets and dust hanging frozen in the air
while the camera swings round them in a smooth arc, ripples of displaced
air trailing behind; time un-freezes, everything flies, and freezes again.
- *Music:* the phrase is the shot: the burst on the downbeat, the freeze
  and orbit through the build, time snapping back on the drop. The orbit
  speed follows the energy.
- *Real details:* the green-tinted, high-contrast grade of the era, the
  slight camera-array stutter in the orbit (it was dozens of stills),
  motion-blurred streaks only while time runs.
- *Build:* instanced shards and droplets (refractive droplets, mirror
  shards) in a 3D scene with a scripted time curve. Presets: *Bullet Time*,
  *Frozen Rain*.

**6. Y2K Rollover** (New Year's Eve 1999)
A huge digital countdown to the end of each phrase; at zero, fireworks
burst, and then the bug bites: the date rolls over to 1900, digits corrupt,
the screen glitches for a bar before the next countdown begins.
- *Music:* the countdown lands exactly on the phrase downbeat (the beat
  clock knows where it is), fireworks fire on the kicks after midnight, the
  glitch length follows the energy.
- *Real details:* segment digits like the big public countdown clocks,
  fireworks with trailing sparks and gravity, the TV-broadcast feel
  (station bug in the corner, slight interlace).
- *Build:* a canvas look (digits, glitch) plus a GPU particle layer for
  fireworks. Presets: *Y2K Rollover*, *Millennium Fireworks*.

**7. Aqua Gel** (the glossy gel interface material, 2000-2003)
A spectrum made of translucent candy gel capsules standing on fine
pinstripes: each capsule has the bright glossy top highlight, the glowing
bottom and a coloured caustic shadow; they wobble like jelly when they jump.
- *Music:* bands drive capsule heights; the kick wobbles them; the drop
  pops them into gel bubbles that float up.
- *Real details:* the two-part highlight, the inner glow at the bottom,
  the soft drop shadow tinted by the gel, the pinstripes behind.
- *Build:* SDF capsules in a shader with refraction of the stripes behind.
  Presets: *Aqua Gel*, *Graphite Gel*.

**8. Burn Disc** (the CD-R mix era, 1998-2005)
A spinning recordable disc filling the screen: the dye layer's green, blue
or gold, rainbow diffraction sweeping across as the light moves, and the
burned area growing ring by ring through the song, darker where data is
written.
- *Music:* rotation speed follows the tempo, the diffraction flashes on the
  kick, each phrase burns another band of track rings; the drop spins the
  light round.
- *Real details:* the diffraction rainbow that moves opposite the light,
  the visible boundary between burned and unburned dye, the clear inner hub
  ring, the fine track grooves.
- *Build:* one shader (anisotropic diffraction from groove direction).
  Presets: *Burn Disc*, *Gold Master*.

### Batch C: rendering styles of the era

**9. Cel-Shade** (the cel-shaded console era, 2000-2003)
Blobby 3D shapes and swooping ribbons rendered like a cartoon: flat two-tone
shading, thick ink outlines, a halftone sky, speed lines when things move
fast.
- *Music:* forms squash and stretch on the kick, speed lines on the build,
  ink splats on the drop.
- *Real details:* constant-width black outlines (edge detection on depth
  and normals), hard shadow terminator, saturated "blue sky" palette.
- *Build:* raymarched forms with toon shading and an outline pass.
  Presets: *Cel-Shade*, *Ink Rush*.

**10. Accelerator Demo** (3D card tech demos, 1998-2001)
The demo that showed off your new 3D card: a bump-mapped planet with
coloured lights sweeping across it, environment-mapped chrome rings
orbiting, lens flares, fog, all in 16-bit colour with its banding and
dither.
- *Music:* lights sweep on the beat, the rings change orbit on each bar,
  the flare blooms on the kick.
- *Real details:* 16-bit (565) colour quantisation with ordered dither,
  the multi-element lens flare, the overdone specular on the bump map.
- *Build:* shader generator plus a 16-bit quantise step. Presets:
  *Accelerator Demo*, *Fog Benchmark*.

**11. Skate Fisheye** (late-90s skate video)
Not a look but an effect for any look: the extreme fisheye of the
late-90s camcorder lens, with the black lens-hood corners, chromatic
fringing at the edges and slightly crushed DV colour. Presets pair it with
the clip looks and the vector/raytrace looks.

**12. Flash Intro** (the "skip intro" web, 2000)
A preloader counting up to 100 % on the beat, then panels sliding in on a
grid, glowing thin lines drawing themselves, pixel-font labels, an orb
pulsing: the animated intro every site had.
- *Music:* the percentage hits 100 on the phrase downbeat, panels wipe on
  the bar, lines draw on the hats.
- *Build:* canvas look. Presets: *Skip Intro*, *Loading 99*.

## The screens they saw it on (effects)

- **DV interlace:** the 2000s camcorder and TV-capture look: field
  combing on motion, DV block dropouts, a slight 4:1:1 colour smear.
- **Early LCD:** the first flat panels: motion ghosting, a visible pixel
  grid, washed blacks and the colour shift at an angle.

These do for the 2000s what the tube and tape effects do for older looks.

## Order and size

| Batch | Looks | Why first |
|---|---|---|
| A | Plugin Era, Fractal Flame, Synesthesia Rail, Trance Swoosh | The biggest "wow", all pure visuals, most of the reuse (feedback, StrokeBatch, bloom) |
| B | Bullet Time, Y2K Rollover, Aqua Gel, Burn Disc | Each nails one specific moment or material |
| C | Cel-Shade, Accelerator Demo, Skate Fisheye, Flash Intro, the two effects | Rendering styles and screens |

Each batch ships as its own push with screenshots, tests and README.

## Risks

- **Fractal Flame performance:** the point count adapts to the frame time;
  the flame renders at reduced resolution and upscales.
- **Bullet Time** is the one closest to "objects": shards and droplets stay
  simple shapes, the drama comes from the time curve and the camera.
- **Plugin Era** must not look like the existing feedback effect: the mesh
  warp and preset blending are what make it.
