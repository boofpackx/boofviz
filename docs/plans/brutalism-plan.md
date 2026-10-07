# Brutalism: two plans

Two takes on the same idea: raw materials and structure shown honestly, nothing
decorative that isn't doing a job.

- **Concrete Age** is vintage: the 60s–70s concrete buildings, the print and
  photography of that era, and the cold-wave and post-punk mood of the playlist
  (panel blocks at night, black-and-white grain).
- **Neo-Brutal** is modern: the loud 2020s graphic and web style of thick black
  borders, hard offset shadows, flat acid colours, giant type and raw UI.

Everything is procedural and original: no real buildings, logos or political symbols.

---

## A. Concrete Age (vintage brutalism)

### Look and feel
- **Materials:** raw board-formed concrete (wood-grain imprint, aggregate,
  rain staining), Corten steel, wired glass, sodium-orange and flickering
  fluorescent light.
- **Image:** black-and-white or faded colour film, hard architectural
  photography (deep shadows, strong verticals), slide projectors, blueprints.
- **Print:** heavy grotesk and stencil type, rub-down transfer letters,
  mimeograph purple, misregistered two-colour posters.
- **Motion:** slow and heavy. Long dollies along facades, lights clicking on
  floor by floor, slabs sliding into place on the downbeat. Big moments are
  shown by scale, not speed.

### Engine pieces
| Piece | What it does |
|---|---|
| **Concrete raymarcher** | A building kit of slabs, piers, ramps, cantilevers, waffle ceilings and repeated facade modules, with long soft shadows and fog. |
| **Board-form concrete material** | Plank grain, form-tie holes, aggregate speckle and water stains, all procedural. |
| **Window grid** | A facade of windows that light up to the music: a floor per beat, a column per bar, everything on a drop. |
| **Lyric materials** | **Stencil** (spray overspray on concrete) and **Rub-down** (cracked transfer letters). |
| **Print effect** | Two-colour misregistration and halftone. |
| **Projector** | Slide-advance with a clunk, keystone and dust (built on the old-film effect). |

### Looks (10)
1. **Panel Blocks at Night:** prefab apartment blocks in snow under sodium lamps; windows light up with the beat, and a whole block lights at once on the drop. Built for the cold-wave and post-punk tracks.
2. **Monolith:** one enormous concrete form in fog, with the camera creeping along its face and light slits opening on the kick.
3. **Parking Spiral:** driving down a concrete ramp under flickering tubes, with level numbers stencilled on the pillars counting the bars.
4. **Streets in the Sky:** deck-access walkways stacked into the distance, figures as tiny silhouettes and doors lighting in sequence.
5. **Stencil Lyrics:** each sung line sprayed onto raw concrete through a stencil, dripping, then painted over grey.
6. **Concrete Poster:** a two-colour print poster with a huge grotesk hero word, on a strict grid, misregistered and halftoned.
7. **Architecture Slides:** a carousel projector clicking through black-and-white "photos" of procedural buildings, one per bar, dust in the beam.
8. **Section Drawing:** the track drawn as an architect's section, with floors extruding as blue lines on a blueprint.
9. **Mimeograph Manifesto:** the lyrics as a purple ditto-machine handout, with a fading, uneven ink roll per line.
10. **Water Tower Dusk:** a lone concrete tower against a cold-wave sky, its beacon pulsing on the beat (grainy black and white).

---

## B. Neo-Brutal (modern brutalism)

### Look and feel
- **Shapes:** flat cards with thick black borders and hard offset shadows (no
  blur), visible grids, oversized buttons, toggles and sliders, sticker shapes.
- **Colour:** flat and loud: acid green, hot pink, cobalt, safety yellow and
  orange, on off-white or black. No gradients.
- **Type:** giant grotesk next to monospace, plus raw "unstyled" system defaults (blue underlined links, grey buttons) used on purpose.
- **Motion:** snappy. Hard cuts, step and overshoot moves locked to the beat
  grid, cards that slam and stack, layouts that reshuffle on the bar.

### Engine pieces
| Piece | What it does |
|---|---|
| **Flat-layout generator** | Cards, borders, hard shadows, grids, pills and stickers, with a beat-locked layout solver that reshuffles on the bar and slams on the kick. |
| **Hard shadow effect** | An offset silhouette shadow for any look (and a "flatten" palette lock). |
| **UI kit** | Buttons that press on the beat, toggles that flip on snares, and sliders that are real EQ bands. |
| **New lyric styles** | **Cards** (each word on its own bordered card that slams into a stack) and **Grid** (words snapped into a Swiss grid, the hero word spanning columns). |
| **Data type** | The live BPM, beat counter, timecode and band levels as big numerals and tables. |

### Looks (10)
1. **Card Stack:** lyric words on bordered cards that slam down and stack, with hard shadows and colours flipping on the bar.
2. **Raw HTML:** an unstyled page (default serif, blue links, grey buttons) that breaks apart and re-flows on the beat, with the lyrics as the page text.
3. **Big Numbers:** BPM, bar, beat and timecode as giant grotesk numerals on a grid, flipping like a split-flap board.
4. **Sticker Bomb:** flat stickers (stars, arrows, blobs, badges) slapped down on the kicks until the screen is full, then peeled off.
5. **EQ Controls:** an oversized mixer UI where the sliders are the real frequency bands and the buttons press on the beat.
6. **Data Dump:** monospace tables of the live analysis scrolling in columns, with highlighted rows on hits.
7. **Modern Concrete:** clean concrete shapes with flat colour accent planes under hard sun shadows, rotating a quarter turn per bar.
8. **Marquee Wall:** stacked full-width marquees in alternating loud colours, each carrying a lyric line.
9. **Grid Lyrics:** the sung line snapped into a Swiss grid, with the hero word spanning six columns.
10. **Hard Shadow Everything:** a global switch (like Old TV screen) that flattens any look's palette and gives it a hard offset shadow.

---

## Shared
- New category **Brutalist** (tagged vintage or modern) and a **Brutalist** playlist.
- Both directions use the Lyric Cinema engine (hero words, song shape) with the new Stencil, Cards and Grid styles.
- Each look ships with tests, tour screenshots and its own commit.

## Build order
1. Concrete raymarcher and concrete material, then looks 1–5 (Panel Blocks first, for the playlist).
2. Flat-layout generator and hard shadow, then Neo-Brutal looks 1–5.
3. Print, projector and data-type pieces, then the remaining looks from both sets.
