# Hero lyric visuals: a higher quality bar, graded by agents

Four new lyric looks, each with its own mechanics and a new way of putting the
words on screen, built to a quality bar above everything in the library today,
and checked by a grading lab (automatic measurements plus a panel of grader
agents) before they ship. Alongside them, one lyrics switch that does the right
thing for every look, and lyric settings that are easy to find, browse and
control.

All four are original work: likeness of the era and the reference, never its
names, logos, characters or artwork. Words on screen follow the house rule: the
sung line, else the song's name, else nothing.

---

## 1. The quality bar ("better than the originals")

What holds the current looks back, and what the new ones must do instead:

| Today | New bar |
|---|---|
| Several looks draw on a 960-px canvas that is scaled up (soft at 1080p, blurry at 4K) | Everything drawn at output resolution: shaders, signed-distance vector shapes and text. Clean at 4K. |
| System fonts, which differ from PC to PC (and fall back to Arial) | Bundled open-licence fonts (SIL OFL) turned into multi-channel distance-field atlases at build time: sharp corners at any size, real kerning, Latin and Cyrillic on every machine. |
| Flat or simple lighting in 3D looks | Physically based materials, soft shadows, ambient occlusion and a consistent tone curve; dithering so gradients never band. |
| Motion mostly "ease in, ease out" | Designed motion: anticipation, overshoot, follow-through and settling, with a song shape (verse < chorus < drop) and words landing within one frame of being sung. |
| Long lines can crowd or clip | A layout pass for every line: balanced breaks, fit to a title-safe area, tested with very long, one-word and Cyrillic lines. |
| No check on flashing | A flash limit: no more than three large brightness flashes a second. |

Every new look must also: run at 1080p60 on a mid-range graphics card (with
auto-quality tiers for laptops), show the same frame in the preview and the
output, and have no console or shader errors.

### Engine work this needs (built once, shared by all four)
| # | Piece | Used by |
|---|---|---|
| F1 | **Font pipeline**: bundled OFL fonts with their licences, a build-time distance-field atlas generator, kerning, per-glyph fallback, and a coverage test (Latin + Cyrillic). | All |
| F2 | **Vector kit**: crisp signed-distance shapes, strokes and rounded panels at native resolution, with pixel-aligned 1 px lines for UI chrome. | Keyframes, Step Chart |
| F3 | **Type in 3D**: raymarched extrusion of distance-field text with soft shadows and occlusion; embossed and debossed shading for print. | Poured, Hot Metal |
| F4 | **Lyric timing v2**: syllables from vowel groups, mouth shapes from letters, a word's rhythmic position (quarter, eighth, sixteenth), and audio onsets lined up with word starts. | All |
| F5 | **Test song**: the synthetic 128 BPM track with an original test lyric sheet (short, long, very long, one-word, repeated chorus, Cyrillic, an instrumental gap) played through the mock now-playing services. Test text exists only in the test kit, never in the app. | Lab |

---

## 2. The grading lab

### Capture (automatic)
A script runs the built app with the test song and captures, for each look:
- a **contact sheet** of 16 frames at musical moments (line start, mid, end; chorus; drop; gap; no lyrics; no song);
- **detail crops** of the lyric area at 100 % at 1080p and 4K (sharpness);
- **frame strips**: 12 frames at 10 fps around a line change, a chorus hit and the drop (graders judge motion from these);
- the **same frames from the preview** (must match the output);
- the same captures for the closest existing looks, as the **baseline**.

### Measurements (automatic, pass or fail)
| Check | Pass |
|---|---|
| Readability: OCR of settled lines against the expected words | ≥ 95 % of words, also at 720p |
| Timing: frame a word appears against its timestamp | within 1 frame |
| Title-safe: lyric bounds inside 90 % of the frame | always |
| Sharpness: text-edge contrast at 4K against 1080p | no upscaling blur |
| Flashing: large brightness swings | ≤ 3 per second |
| Preview against output | < 2 % of pixels differ |
| Errors | none |

The cloud machine renders in software, so real frame rates are checked on your
PC with the frame counter; the lab tracks relative cost (shader steps, texture
reads) to catch regressions.

### Grader agents (one round = five graders in parallel)
Each grader gets the concept brief, the rubric, the captures and the baseline,
and returns scores (1–10) with the frame that shows each point and its top three
fixes.

| Grader | Judges |
|---|---|
| **Art director** | Era authenticity and detail, composition, colour, lighting, faithful likeness without copying anything. |
| **Lyric critic** | Readability, hierarchy (hero words), how the words arrive and leave, whether the display mechanic is new and works with long, short and repeated lines. |
| **Motion critic** | Hitting the beat, the song shape (verse, chorus, drop), smoothness, nothing popping. |
| **Technical QA** | Aliasing, banding, artefacts, overflow, the stress lines, the measurements. |
| **Red team** | Hunts the single worst frame and the failure case, and must name the frame. |

**Blind comparison:** graders also see new and old looks as unlabelled A/B
pairs and pick the better craft, so "better than the originals" is judged
without knowing which is which.

**Pass bar:** every grader ≥ 8, average ≥ 8.5, the new look preferred in at
least 4 of 5 blind pairs, no blocking finding from the red team, and every
measurement passing.

**Rubric anchors** (so scores mean the same each round): 5 = works but generic;
7 = good and clearly on theme; 9 = would pass for a professional piece of the
era. The panel is calibrated first on three existing looks.

### The loop
Build → capture → measure → grade → fix the top findings → again, up to three
rounds per look. A concept still failing after three rounds is swapped for one
from the bench. Last gate: you watch a short recorded demo of each look and
approve it.

**Cost:** a full run is up to 5 graders × 3 rounds × 4 looks = 60 grader runs.
**Lean mode** uses 3 graders (art + lyrics, motion + technical, red team) and 2
rounds: 24 runs, about a third of the cost.

---

## 3. The four looks

### A. Keyframes: late-90s / early-2000s web animation
**Reference:** the vector animation tool behind most early web cartoons and
music videos around 2001–2004: grey panels, a timeline of frame cells, onion
skinning, motion and shape tweens, symbols with blue selection handles, thick
outlines and flat fills, the "loading 87 %" bar and the Skip Intro button.

**How the lyrics show (new):**
- **Words are keyframes.** The timeline runs with the song; each word drops a
  keyframe on the lyrics layer at the playhead.
- **Onion-skinned tweens.** On the stage each word slides in as a motion tween,
  with its earlier positions ghosted behind it in onion-skin tints, and the
  cursor sometimes drags a word into place.
- **Shape tweens.** At the end of a line the last word morphs, outline by
  outline, into the first word of the next line.
- **Test movie on the chorus or drop.** The tool's panels vanish and the
  "published" movie plays: a loader bar, then our own vector character singing
  the words. Its mouth shapes come from the letters being sung (open vowels,
  closed m/b/p, f/v, l, rest), with big bubbly outlined words tweening around
  it. Motion steps at 12 fps "on twos", like the cartoons of the time.

**Variants:** Studio (editing view), Test Movie (the cartoon only), Onion Skin
(heavy ghosting).
**Built on:** F1, F2, F4. **Baseline:** 90s desktop (web page, pop-ups),
Screensaver Words.

### B. Step Chart: arcade dance game
**Reference:** the late-90s / early-2000s arcade dance game: four arrow lanes,
receptors at the top, scrolling notes, judgments, a combo counter, a life bar,
and loud background videos.

**How the lyrics show (new):**
- **Every sung word is a step note.** It scrolls up its lane and reaches the
  receptor exactly when it's sung. The same word always gets the same arrow, so
  a chorus repeats its pattern.
- **Note colour follows rhythm**, as in the real games: words on the beat,
  between beats and in between those get their own colours.
- **Held words become freeze arrows** as long as the word is sung.
- **Judgments from the real music:** PERFECT when a kick, snare or hat lines up
  with the word, GREAT otherwise. The words you've "danced" collect into the
  line at the side.
- **Chorus fever:** faster scroll, the background flips, rainbow notes. In
  instrumental gaps: steps on the beat with no words, then READY… GO before the
  next line.
- With no song, the stage idles with no words or judgments.

**Variants:** Single (4 lanes), Double (8 lanes across the screen), Reverse
(scroll down).
**Built on:** F1, F2, F4. **Baseline:** Word Highway, High Score Entry.

### C. Poured: brutalist
**Reference:** brutalist construction: timber formwork, board-marked concrete,
tie-holes, cranes, hard sun and architectural photography.

**How the lyrics show (new):**
- **Every line is cast.** Formwork boards go up around the letter shapes on the
  beat. Concrete pours into each letter as its word is sung, with a wet sheen,
  rippling on the kick like a vibrator. Then the boards strip off to show
  board-marked concrete letters with tie-holes.
- **The song builds a building.** Finished lines are craned up and stacked; the
  camera pulls back over the song to reveal a tower made of its words.
- **Time of day follows the song:** dawn at the first line, hard noon in the
  middle, sodium-lit night by the outro, when the holes in the letters glow
  like windows.
- **Chorus and drop:** the chorus line is cast twice as big on a plinth; the
  drop shakes the site with dust, and the tower lights up.

**Variants:** Hard Sun (day), Night Shift (sodium light), Blueprint (the same
build as architect's line drawings).
**Built on:** F1, F3. **Baseline:** Stencil Lyrics, Card Stack, Concrete Age
scenes.

### D. Hot Metal: vintage letterpress
**Reference:** hot-metal typesetting and letterpress: brass letter moulds dropping
into a line from the machine's magazine, the cast lead slug, inking rollers,
the platen press, ink pressed deep into cotton paper.

**How the lyrics show (new):**
- **Words are typeset as they're sung.** Each word's brass moulds drop in one by
  one, mirror-image as real type is, clicking in rhythm. Spacers widen at the
  end of the line to justify it.
- **The press strikes on the downbeat.** The line is cast (a hot glow), inked,
  and printed: a deep impression, ink squeezed at the edges, a touch of
  misregistration. Louder music means a heavier impression.
- **Wood type for hero words:** big grain-textured wooden letters, metal type
  for the rest, like a letterpress poster.
- **Chorus and drop:** printed sheets stack up with earlier lines visible, the
  chorus prints in a second colour, and the drop pulls a proof with an ink
  spatter.

**Variants:** Proof Press, Poster (giant wood-type hero words), Newsroom (lines
set as newspaper headlines and columns).
**Built on:** F1, F3, F4. **Baseline:** Cassette J-Card, Mimeograph Manifesto,
Ransom Note.

### Bench (swapped in if one of the four fails, or for a later batch)
- **Buddy Chat** (late-90s instant messaging): the song as a chat. Lines arrive
  as messages with a typing indicator, the away message is the current line,
  and emoticons replace words.
- **Lyric Booklet** (early-2000s CD): a jewel case opens and the booklet turns
  its pages to the verse, with the sung line highlighted in marker. The cover
  comes from the album art.
- **Silhouette Dance** (2000s ads): dancers as silhouettes on flat neon colours,
  with a white headphone cable that writes the words.
- **Marquee** (vintage cinema): a letter board changed letter by letter by
  hand, with bulbs chasing on the beat.

---

## 4. Lyrics mode: one switch, the right lyrics on every look

### How it works today, and what's wrong
- "Show lyrics over every look" puts one lyric style on top of everything. It
  skips looks with a lyric layer, but not looks whose words come from inside
  the look (Tape Deck's display, Neo 90s, the photo prints, Sketch Screen,
  neo-brutal, the 90s desktop, text looks set to lyrics), so those can get the
  lyrics twice.
- A second switch, "Put lyrics into text looks", does part of the same job.
- "Auto" picks a style by the look's category, but nothing else (material,
  colour, position), and it can't be changed per theme or per look.

### The new switch: Off / Looks' own / Everywhere
One control with three positions, on the Lyrics tab, the Perform tab, the **L**
key and a MIDI function:

| Mode | What you see |
|---|---|
| **Off** | No words anywhere, the looks' own lyric layers included (for instrumental sets, or gigs without a lyrics licence). Nothing else about the looks changes. |
| **Looks' own** (default) | Each look exactly as it was made: lyrics where it has them, none where it doesn't. |
| **Everywhere** | Every look shows lyrics, choosing per look with the rules below. |

### Everywhere: the rules, per look, in order
1. **Your choice for this look wins.** Each look can be set to *Theme default*,
   *Its own only*, a *specific treatment*, or *Never*. Set it from the
   library (right-click) or the Layers tab. It's saved per look, your
   favourites included, without changing the built-in presets.
2. **A look that already shows words stays exactly as it is.** That covers
   lyric layers and every look that puts words on screen itself (Tape Deck, Neo
   90s, the prints, Sketch Screen, neo-brutal, the desktop, captions, kinetic
   type), so there's never a second copy.
3. **A look with lyrics switched off gets its own lyrics switched on.** That
   covers a lyric layer you turned off in a saved look, and text looks that
   use their own words: they sing the lyrics instead. This replaces the "Put
   lyrics into text looks" switch.
4. **Otherwise the look gets the treatment for its theme**, from the theme table
   below, so a Brutalist look gets stencil lyrics and a Real 90s look teletext.

Switching back to *Looks' own* or *Off* undoes everything Everywhere added or
turned on. Your saved looks are never rewritten.

**Built as:** one small, pure "lyric router" that takes a look, the mode, your
per-look choices and the theme table, and returns which layers to show, hide
or add. Both windows use it, so preview and output always agree. A test runs it
over every built-in look: in Everywhere each look has exactly one source of
words; in Off, none.

---

## 5. Lyric settings: organised, easy to browse and control

### Treatments instead of loose dropdowns
A **treatment** is a named bundle of everything that makes a lyric style: the
style, material, font, colour, position, size, how lines leave and the glow. It
replaces the dozen separate dropdowns. Built-in treatments come in families, and
you can save your own (for example "My Pink Karaoke") from the fine-tune
controls.

| Family | Examples |
|---|---|
| Classic | Karaoke sweep, punch-in lines, typewriter |
| Music video | Drop, slam, pop, flip, orbit, glitch, jelly, glitter |
| Lyric cinema | Highway, credits, infomercial, teletext, laser, explosion |
| 90s & Y2K | Screensaver, high score, neon alley, J-card, chrome |
| Neo 90s & vintage | Holo, melt, glitter, ransom note |
| Brutalist | Stencil, mimeograph, rub-down, Swiss grid |
| Hero (new) | The parts of the four new looks that work on top of any look: Step Chart's lane at the side, Keyframes' morphing words, Hot Metal's printed strip |

### Finding and choosing
- **Gallery, not lists:** treatments show as cards with small live previews of
  the line being sung right now, grouped by family, with search, a star for
  favourites, and "Surprise me".
- **Try before applying:** hovering or arrowing onto a card shows it in the main
  preview (never on the screen); Enter or click applies it. Arrow keys move
  through the gallery and Tab moves between families.
- **Fine-tune folded away:** each treatment's detailed controls sit under
  *Fine-tune*, with *Save as treatment* and *Reset*.

### The Lyrics tab, reorganised
Short sections with a jump bar at the top:
1. **Mode:** the three-way switch, plus a status line for the look playing now
   ("own lyrics", "themed: Teletext", "none", "never").
2. **Treatment:** the gallery.
3. **Themes:** the theme table, one row per category, each with its treatment.
   Change any row from the gallery, or reset to the defaults.
4. **This look:** the per-look choice for the look playing now.
5. **Timing:** offset and automatic timing.
6. **Sources:** the lyrics folder, online search and the cache.
7. **Music:** the player you're following, and the optional Spotify login.

### Live control
- **L** toggles Off and your last mode; **Shift+L** steps through the
  treatments of the current look's theme.
- MIDI functions: *Lyrics mode*, *Next / previous treatment*.
- Library cards show a small badge for each look's lyric state.

### Graded too
The lab also checks Everywhere: for every theme it captures three looks with
their themed treatment. Graders check that the treatment suits the look and
stays readable over busy backgrounds; the measurements check readability on
every built-in look.

---

## 6. Build order

| Step | What | Done when |
|---|---|---|
| 0 | Foundations F1–F5 | Fonts and atlases build, the test song plays through the mock services, captures run. |
| 1 | **Lyrics mode and lyric settings** (the router, the three-way switch, treatments, gallery, theme table, per-look choices, the reorganised tab) | Router test passes on every look; your saved looks keep their lyrics. |
| 2 | Grading lab and calibration on three existing looks, plus the Everywhere check | Graders agree within ±1 point on repeat runs; baseline scores recorded. |
| 3 | **Step Chart** (2D, timing-heavy: proves the lab fast) | Passes the bar. |
| 4 | **Hot Metal** | Passes the bar. |
| 5 | **Keyframes** | Passes the bar. |
| 6 | **Poured** (3D, the heaviest) | Passes the bar. |
| 7 | Presets (2–3 variants each), hero treatments added to the gallery, your review of the demo videos, release | Released. |

Optional afterwards: a **remaster pass**. Run the cheap measurements over the
whole library, then grade the lowest 20 looks and rebuild them to the new bar.

## 7. Decisions for you
1. **The four picks:** Keyframes, Step Chart, Poured and Hot Metal, or swap any for a
   bench look.
2. **Grading:** full (best results) or lean (about a third of the cost).
3. **Off:** should it also hide the lyrics built into looks (as planned), or
   only the lyrics that Everywhere adds?
