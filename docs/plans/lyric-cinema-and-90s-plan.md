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

Many of these share the Lost Media engine in section C.

---

## C. Lost Media: real vintage found footage

The goal: footage that feels like it came off a real tape found in an attic, not
a cheap "VHS filter". Real lost media convinces because of **layered,
physically correct damage**, **broadcast and recording details**, and **events**
(the tape switching, getting recorded over, losing signal). All of it is
procedural and deterministic: the damage is seeded by song position, so preview
and output match exactly.

### C1. The engine: four building blocks

| Block | What it simulates |
|---|---|
| **Tape stack** (`tapeStack` effect) | Real VHS / Betamax / Hi8 physics: chroma bleed and delay, luma noise, head-switching noise bar at the bottom, tracking wobble, dropouts (white streaks), edge ringing, interlace combing, a crushed colour gamut, and **generation loss** (1st copy is clean, 6th copy is soup). |
| **Film stock** (`filmStock` effect) | Super 8, 16 mm and archive nitrate: gate weave, grain per stock, dust, hair in the gate, vertical scratches, lamp flicker, sprocket holes, splice bumps, colour fade (magenta-shifted), nitrate decay blooms and burn-through. |
| **Digital rot** (`digitalRot` effect) | Early digital: macroblocking, datamosh smears on cuts, low-bitrate colour banding, buffering stalls, a frozen frame with live audio, 240p letterboxing. |
| **Broadcast layer** (`broadcast` overlay) | Everything printed on top: camcorder REC dot, battery icon and date stamp, timecode, channel bug, lower thirds, closed-caption boxes, "PLEASE STAND BY" slates, test cards, countdown leaders, sign-off cards and a handwritten tape label on the intro. |

### C2. Tape events (what makes it feel found)

Events trigger on the music, so they look intentional:
- **Recorded over**: a previous recording bleeds through for a few bars (two looks mixed, with tracking noise at the seam). Uses the dual compositor.
- **Rewind / fast-forward**: the scene scrubs backwards with horizontal noise bands on a breakdown, and fast-forwards into the drop.
- **Pause jitter**: on held notes the frame freezes and shakes, like a paused VCR.
- **Signal loss**: a cut to blue screen or snow, then a hard return on the downbeat.
- **Tape eat**: the picture stretches and warps, then snaps back.
- **Camcorder moments**: auto-focus hunting, iris pumping and a zoom rocker push-in.
- **Splice / missing frames**: jump cuts with a leader flash (film stocks only).

Each has a frequency slider and an on/off switch, so it can range from rare and subtle to full chaos.

### C3. Options on every lost-media look

- **Era**: 70s film, 80s broadcast, 90s camcorder, 2000s early digital.
- **Format**: Super 8, 16 mm, VHS, Betamax, Hi8, cable TV, low-bitrate web video.
- **Generation**: copies deep, from 1 to 8.
- **Damage**: amount of wear (clean → barely watchable).
- **Mood**: cozy and nostalgic → eerie. Eerie tints colours cold, slows events and adds subliminal frames, but stays tasteful.
- **Custom text**: date stamp, channel bug, tape label and station name. This is the spot for your own trademark or brand.
- **Lyrics as**: closed captions, teletext subtitles, karaoke-tape colour wipe, handwritten slate, or off.
- **"Make it lost media"**: a one-click toggle that runs *any* look (and later your own clips from Phase 5) through the tape stack.

### C4. Themes (16 lost-media looks)

1. **Birthday Tape '94**: camcorder home video, date stamp, a cake-candle glow scene.
2. **Public Access Midnight**: a cable-access show set with a cheap chroma-key backdrop and a call-in number bug.
3. **Station Sign-Off**: an anthem-style flag-free sign-off with a tower silhouette, then test card, then snow.
4. **Overnight Forecast**: a local weather channel with a smooth-jazz feel, a scrolling city list and a retro radar map.
5. **The Pilot That Never Aired**: a kids'-show set made of primitive puppet shapes and a wobbly logo (eerie mood available).
6. **Mall CCTV**: a four-camera split screen, timestamp, fish-eye and a dead-mall fountain.
7. **Super 8 Summer**: a family-reel colour fade, light leaks, sprockets and a lake scene.
8. **Orientation Video**: a corporate training tape with title cards, a dissolving logo and a "Module 3" slate.
9. **Karaoke Tape**: a karaoke-bar video with the lyric wipe, generic scenic backdrops and a song-number bug.
10. **Recorded Over**: two shows fighting for the tape all song long.
11. **Numbers Station**: a shortwave oscilloscope, spoken-number cards and a frequency dial.
12. **Archive Reel 1931**: nitrate film, a decayed silent-era intertitle and burn-through.
13. **Shareware Demo**: a lost CD-ROM attract loop with dithered video in a small window.
14. **Buffering…**: early web video, macroblocks, a progress bar and stalls on the drop.
15. **Music TV Dedication**: a late-night video show with a lower third that shows the real song title and artist from Spotify, plus a dedication ticker.
16. **Emergency Test Pattern**: colour bars, a 1 kHz-tone feel and a "this is only a test" card (generic, no real alert logos).

A **Lost media** playlist and a `lost media` tag hook all of these into shuffle and auto-play.

### C5. Real archive footage (built)

The `archiveFootage` layer pulls random **real** films and TV from before 2003
from the Internet Archive:
- **Collections:** ads, educational and industrial films; newsreels; classic TV; cartoons; government films; space age; home movies; TV commercials; or your own search.
- **Main process:** searches, downloads each clip once into a 3 GB disk cache, and streams it to both windows over `boofviz-archive://`.
- **Sync:** the same slot gives the same clip and a beat-derived position, so preview and output match.
- **Timing:** a new film every N bars, optional jump cuts every N beats, and a "Next clip" macro.
- **Looks:** 8 archive looks, each with a tape or film treatment, a catalogue card, lyrics as captions, teletext, karaoke or slate, and a **Lyrics on** macro to switch them off.
- **Rights:** collections default to public-domain sources; the TV commercials collection is marked "check rights".

---

## Build order

1. **Lyric Cinema engine + 6 styles**: song map, hero words, camera and materials, then styles 1–6.
2. **Real 90s batch A**: about 12 looks (screensavers, console, demoscene, camcorder, Web 1.0).
3. **Lost Media**: tape stack, film stock, digital rot, broadcast layer and events, then the 16 themes and the "make it lost media" toggle.
4. **Lyric styles 7–12** (they reuse the Lost Media materials).
5. **Neo-90s + vintage batch**: about 12 looks, bringing the 90s share past 40%.

Each batch ships with tour screenshots, tests and its own commit.

Also still owed: rebuild **Two-Step Platinum** and **Vital Signs Monitor**.
