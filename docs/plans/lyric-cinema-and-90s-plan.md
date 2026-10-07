# Lyric Cinema + the 90s library — plan

Two goals:

1. Lyric-only looks that feel like a real **music video**, where the words are the
   whole show and are staged differently from one look to the next.
2. At least **40% of the library** should be real 90s, neo-90s or vintage-90s,
   with every "asset" original and procedural. No third-party names or logos,
   just the likeness.

Today: 91 looks. 17 are strictly Real 90s or Retro Type, and 29 fall in the
"90s night" playlist (about 32%).

---

## A. Lyric Cinema (dramatic lyric videos)

The current `lyricVideo` animates every line the same way at the same scale.
Real lyric videos are *directed*: calm verses, huge choruses, one word owning
the screen, and a camera that moves through the words. These are the engine
pieces needed, all deterministic (a function of beat, time and the lyrics feed):

| Piece | What it does |
|---|---|
| **Song map** | Lines that repeat in the synced lyrics are marked as chorus. Verse is calm, chorus is big, a drop (from `dropCount`) is explosive, and a breakdown (low energy) is intimate. Each section picks its own staging. |
| **Hero words** | Repeated, long or downbeat-landing words get pulled out and fill the frame, while the rest of the line stays small around them. |
| **Director camera** | The camera follows a path *through* the words: dolly-in, whip-pan on the bar line, rack-focus (depth-of-field blur on the inactive words) and a slow orbit on held notes. |
| **Text materials** | Chrome bevel, neon tube (with flicker), paper cutout, LED dot, CRT phosphor (with persistence trails) and film-burn. These are shader modes on the existing SDF letters. |
| **Exits** | Words shatter into particles, melt, burn away or get scanned out. |
| **Scene props** | Simple procedural sets behind the words: road, rain-soaked street, smoke and lasers, a TV studio. |

### 12 new lyric-video styles (most with 90s character)

1. **Word Highway**: words painted on the road and on billboards, racing-game camera.
2. **Credits Roll**: film-projector credits with gate weave, dust and a flickering lamp.
3. **Infomercial Super**: chrome-bevel supers, star wipes, "CALL NOW" energy.
4. **Ransom Cutout**: every letter cut from a different magazine, taped down on the beat.
5. **Teletext Story**: the lyrics as a page-flipping teletext service.
6. **Screensaver Text**: chrome 3D words tumbling and bouncing off the screen edges.
7. **Neon Alley**: neon-tube words buzzing on, with reflections in a wet street.
8. **Cassette J-Card**: handwritten marker on a tape insert, with a pen drawing the strokes.
9. **Chorus Explosion**: verses whispered small, then the chorus detonates to full screen.
10. **Shatter Drop**: the line holds, then on the drop every letter shatters into particles.
11. **Laser Show**: vector-beam words drawn on stage smoke.
12. **High-Score Entry**: arcade name-entry letters spinning and locking in.

Each one gets a preset in `Lyrics` plus a `textLooks` variant, so any look can swap
in themed lyrics.

---

## B. 40% 90s library

Target: about 150 looks with about 60 of them 90s, so roughly **30–35 new looks**
(plus the 12 lyric styles above, most of which count).

**Real 90s** (looks like it's running on the actual hardware):
- Desktop screensaver scenes: 3D pipes, a maze walk, flying objects, starfield (generic, no names)
- 32-bit console low-poly: wobbly vertices, affine textures, fog
- Demoscene parts: copper bars, plasma, rotozoomer, scroller
- SGI-style chrome workstation logos and reflective floors
- Music-TV idents: bumpers with a station bug in the corner
- Camcorder: REC dot, date stamp, auto-focus hunting
- Web 1.0: under-construction banners, hit counters, marquees, tiled backgrounds
- LCD pets and pagers: chunky segment displays
- Rave flyers: smart-drug neon, smiley-likeness, fractal backdrops
- Platinum-era desktop windows popping up on the beat

**Neo-90s** (modern rendering of 90s ideas):
- Liquid chrome blobs, holographic foil, glossy 3D icons, clean pixel art at 4K

**Vintage 90s** (analog and personal):
- Home video, disposable-camera flash, photo-booth strips, instant-photo stacks,
  cassette decks, CD-ROM menus

These overlap with the proposed **found-footage / lost-media** pack (tape damage,
timecode, "do not erase" labels), so they can share effects.

---

## Build order

1. **Lyric Cinema engine + 6 styles**: song map, hero words, camera and materials, then styles 1–6.
2. **Real 90s batch A**: about 12 looks (screensavers, console, demoscene, camcorder, Web 1.0).
3. **Lyric styles 7–12 + found-footage effects**.
4. **Neo-90s + vintage batch**: about 12 looks, bringing the 90s share past 40%.

Each batch ships with tour screenshots, tests and its own commit.

Also still owed: rebuild **Two-Step Platinum** and **Vital Signs Monitor**.
