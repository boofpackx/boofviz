# Phase 4 plan: 3D, techniques and new looks

Phase 4 in the original build order is "3D and techniques: terrain, camera moves, particles, raymarching and the post-FX chain; ship 3D Worlds, Trippy and Mellow". This plan delivers that engine work through era-authentic looks: real 90s, Y2K, glossy aero, tile motion, 2000s kids-TV gloss and UK garage (concept set "eras", full detail in `phase4-concepts-eras.json`), plus the engine stack that makes them look premium.

★ = flagship look. Every look is beat-locked and renders identically in the preview and output windows.

## The looks

### Real 90s
| Look | What you see | What the beat does |
|---|---|---|
| ★ Copperline Megademo | A 4:3 demoscene "megademo" at true 320×256 with 32 colours: rainbow copper bars in the borders, plasma with real colour cycling, rotozoomer, textured tunnel, shaded vector balls, a sine scroller | Kick jolts the copper bars; the palette cycles a notch per beat; vector balls morph on the bar; the next demo part wipes in on every phrase; drop shakes the playfield and explodes the balls |
| ★ Haunted Polygon Keep | First-person walk through a gothic keep drawn like a 1997 console: wobbling low-poly arches, warping stone textures, torchlight, fog | The camera takes one step per beat; torches flare on the kick; candles flicker on hats; new rooms on the phrase |
| ★ Suburban Night Tape | Camcorder footage from a passenger window: sodium streetlights as soft bokeh, lit suburban windows, an all-night store, tape grain and date stamp | One streetlight passes centre-frame exactly on each beat; kick blooms it; tape tracking wobbles on the drop |
| Checkerfloor Raytrace Reel | An early-90s raytrace demo: chrome and glass spheres over an infinite oxblood/cream chequerboard under a cobalt sky | Spheres hop in a 1-3-2-4 pattern on the beat, squashing on landing; camera dips on the kick |
| Rave Flyer Systems | A strict mid-90s techno poster grid: giant cropped BPM numerals, tiny technical labels with the live bar and phase, isometric objects | A new module slams into the grid each beat; digits tick on hats; the big numeral jumps on the kick |
| Station Ident '93 | Your text or logo, extruded in gold or chrome, over a navy gradient with a wireframe globe and tinted glass rings | Rings tick round on the beat; the logo pushes on the kick; a light sweep crosses on every bar |

### Y2K
| Look | What you see | What the beat does |
|---|---|---|
| ★ Jelly Plastic Twist Cube | A 3×3 twisting puzzle cube in translucent candy jelly plastic, with the inner mechanism showing through, in a bright studio | One face turn per beat (clicks into place on the beat); the whole cube tumbles on the bar; it scrambles through the phrase and is solved exactly on the next phrase; it explodes into 27 pieces on the drop and re-forms |
| ★ Liquid Chrome Coalesce | Liquid-mercury blobs merging and splitting in an icy lilac studio, with rainbow thin-film at the edges and a mirror floor | Main blob jelly-pulses on the kick and sheds a droplet every second kick; ripples on the snare |
| Inflatable Bubble Type | Your words as huge inflated holographic-vinyl balloon letters on a glossy floor | A bounce wave runs across the letters each beat (stretch, squash, wobble); the whole word squashes on the kick; on the drop the letters pop into chrome confetti |

### Glossy aero (2004–2012)
| Look | What you see | What the beat does |
|---|---|---|
| ★ Morning Glass Meadow | A vivid green hill of swaying grass under a saturated blue sky with a lens flare, glass orbs drifting up and refracting the world | A big orb bounces up on each downbeat; the grass sways a notch on the kick; bubbles twinkle on hats |
| Koi Glass Pond | Top-down crystal pond: glossy koi gliding over pebbles under dancing caustics, lily pads, drifting petals | A ripple ring spawns on each kick; the nearest koi darts on the snare |
| Liquid Gel Meters | An equalizer of glass gel capsules filled with glowing liquid on a mirror-black floor | Liquid sloshes on the kick in a wave; bubbles rise on hats |

### Tile motion, kids-TV gloss, UK garage
| Look | What you see | What the beat does |
|---|---|---|
| Flat Tile Hub | A wide panorama of flat coloured tiles on black with giant thin lowercase headings, gliding sideways | Tiles flip to their next face on the beat; small "peek" nudges on hats |
| Glitter Wand Bumper | A glossy magenta-to-cyan swirl crossed by a sparkle wand that trails a glitter ribbon and taps your logo | One wand stroke per bar, landing on the downbeat with a starburst |
| ★ Two-Step Platinum | Your name in heavy bevelled platinum chrome on velvet purple, with spinning chrome rings, club beams and diamond glints | Everything swings on the two-step groove: glints fire on the garage accent pattern, not on every kick |
| Rooftop Pirate Signal | A night skyline of tower blocks and a rooftop transmitter mast, sodium haze, signal rings radiating | Transmitter rings pulse on the swung pattern; windows switch on and off in a shuffle |

### Requested extra
| Look | What you see | What the beat does |
|---|---|---|
| Vital Signs Monitor | A real bedside medical monitor: ECG trace with sweep bar and phosphor persistence, pleth wave, numeric readouts (the heart rate is the live BPM) | One heartbeat per beat; alarm colours and a flatline-and-restart on the drop |

## Engine stack that makes it premium (build in this order)
| # | Capability | Unlocks | Size |
|---|---|---|---|
| 1 | Determinism fixes in existing generators (Tiles counts onsets since creation, Warp integrates speed per window, BarCity samples spectrum per window, KineticType bounce flash uses dt) | Preview and output always match | S |
| 2 | Beat choreography helpers: step/hold/overshoot moves, closed-form springs and bounces on the beat grid, swing grid for two-step | Cube, Bubble Type, Platinum, Gel Meters, every bouncy look | S |
| 3 | Procedural studio environment and materials: chrome, glass, thin-film iridescence, translucent jelly plastic | Liquid Chrome, Twist Cube, Bubble Type, Platinum, Gel Meters, Meadow | M |
| 4 | 3D scene framework (generalising BarCity): beat-synced camera moves (orbit/dolly/crane/spline on bars), instancing, contact shadows | Twist Cube, Haunted Keep, Station Ident, Tile Hub, 3D Worlds | M |
| 5 | Raymarch/raytrace framework: shared march loop, soft shadows, AO, reflections, smooth blending, quality tiers | Liquid Chrome, Raytrace Reel, Trippy | M |
| 6 | SDF text and logo atlas (bevel, chrome and inflate shading; SVG logos for your trademarks) | Bubble Type, Platinum, Station Ident, Glitter Wand | M |
| 7 | Deterministic GPU particles seeded by beat index (glitter, bubbles, embers, glints, rain) | Glitter Wand, Meadow, Koi, Platinum | M |
| 8 | Low-fi pipeline: fixed low internal resolution, palette quantise + Bayer dither, vertex snap and affine texture warp | Megademo, Haunted Keep | S |
| 9 | New post-FX: VHS/camcorder, star-filter glints and anamorphic streaks, lens flare, depth of field, god rays and fog, film flicker and dust | Night Tape, Platinum, Meadow, Mellow | M |
| 10 | Auto-quality: per-look cost tiers, dynamic render scale, quality knobs for march steps and particles | 60 fps on integrated graphics (also needed by Phase 7) | S |
| 11 | Terrain/topography and the original 3D Worlds, Trippy and Mellow categories built on 3–10 | Phase 4 scope | M |

Upgrades to existing looks: real panel content for LED Pyramid, raymarched lensing for Event Horizon, cleaner glow for the arcade games, deterministic Warp jumps.

## Build order
1. **Foundations** (steps 1–3, 10): see Liquid Gel Meters and Liquid Chrome Coalesce.
2. **3D framework + cube engine** (4): see the Twist Cube, Flat Tile Hub and Station Ident.
3. **Type, logos and particles** (6–7): see Bubble Type, Two-Step Platinum and Glitter Wand.
4. **Low-fi and post-FX** (8–9): see Megademo, Haunted Keep, Night Tape and Rave Flyer.
5. **Aero, garage and the Phase 4 originals** (5, 11): see Meadow, Koi, Pirate Signal, Raytrace Reel, the Vital Signs Monitor, plus 3D Worlds, Trippy and Mellow.

Every milestone passes: the preset tour (screenshots, no errors, output matches preview), 60 fps at 1080p on an RTX 3060-class GPU with auto-quality on integrated graphics, the photosensitivity cap, and the trademark guard test, extended with: rubik, frutiger, disney, metro (as a brand), windows/vista/xp, wii, imac, playstation, milkdrop, and every band and song title from the playlist.

## Naming and IP
- Preset names are original and descriptive. Likeness is the goal; logos, characters, sprites and artwork are never copied.
- The cube is a generic twisting puzzle cube: no brand name, logo or branded centre sticker.
- Text-based looks (Station Ident, Bubble Type, Platinum, Glitter Wand) use your own words or logos, which is where your trademarks can be featured.
- Fonts: ship open-licence fonts or system fallbacks, and never name a commercial typeface.

## Not in this plan
Concept sets for signature objects, dark fantasy and per-song playlist themes were not used. Haunted Polygon Keep, Suburban Night Tape and Rooftop Pirate Signal carry some of that mood, and the heart monitor was added on request.
