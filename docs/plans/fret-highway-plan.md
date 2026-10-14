# Fret Highway: the mid-2000s guitar game, played by the music

A look in the style of the console guitar games of 2005–2007, like being in
the game: a five-lane neck running into the venue, chrome gems that reach the
frets on the beat they're played and burst into flame, star power, the score,
streak lights, the multiplier and the rock meter. It's a look, not a game: there's
no player, and the music plays the chart. No names, logos, characters, songs or
art are copied. The likeness is in the layout, the motion and the feel.

## The hard part: notes have to arrive before they're heard
The game shows notes before they play because the chart is written ahead of
time. BOOFVIZ only hears the audio as it plays, so the chart is predicted:

- **Note grid (analysis worker, `audio/tempo/noteGrid.ts`).** Every onset
  lands on the beat clock's 16th-note grid: kick, snare and hat from the onset
  detectors, plus *tone* onsets. A tone onset is a new partial at a sharp
  spectral peak of the long FFT (180 Hz – 3 kHz), with its pitch and how long
  it holds. A rise only counts as a note once its partials carry it: a pluck's
  attack smears for ~30 ms, while a snare's noise never clears. The grid lives
  in the worker, so every window and every look reads one grid, whenever it
  was loaded. It is sent in each analysis packet (1.5 kB) and resets after a
  silence or a jump of the beat clock.
- **Chart (`engine/fretChart.ts`, pure).** Music repeats in one-, two- and
  four-bar loops. For each slot, pick the loop length that best explains the
  last two bars, then vote over the last three repeats of that slot. Each
  slot is predicted from the grid as it stood when the slot came into view,
  so a gem never changes on its way down. At the frets, the music says hit
  (an onset on the slot, or one slot off for the same kind) or miss (the gem
  slides past and fades). Onsets the chart didn't see coming still light
  their fret.
- **Lanes, like a chart written for the song.** Kicks go to green and red
  (beats 1 and 3, 2 and 4), the snare to yellow, and hats to blue and orange.
  The notes of a riff or melody go across all five lanes by pitch, around the
  recent median, and held tones become sustains. Hard and Expert add chords on
  big accents. Easy keeps three lanes and the beats, Medium adds the eighths,
  and Expert every sixteenth.
- **Measured:** on real audio through the app's front end, analysis and
  tempo pipeline (unit tests), 99% of the gems shown on a drum loop and on a
  riff that changes groove are hit. In the built app with the band track
  (`npm run fret:capture`), the rate is 89–100% per venue. The misses are the
  bar where a breakdown starts, as when a player misses.

## The look
- **Highway:** a perspective neck whose surface scrolls with the song, fading
  into the venue at the far end. It has chrome rails, beat and bar lines,
  strings, and fret buttons (black discs in coloured rings on chrome rims)
  that light when pressed.
- **Gems:** chrome pucks with glossy coloured caps; star-phrase notes are
  stars. In star power everything turns blue-white and the neck glows.
- **Hits:** a tongue of flame with two licks, a lane-coloured flash and
  sparks. Held sustains keep burning while their tail wobbles like the whammy.
- **HUD:** a chrome score box, a tilted multiplier plate with ten streak lights
  (×2 at 10, ×3 at 20, ×4 at 30, doubled in star power), and a needle rock
  meter (red, yellow, green) with ROCK lit in its zone. A glass star power
  tube sits below it. "50 NOTE STREAK!", "STAR POWER READY" and "STAR
  POWER!" pop in the middle of the screen.
- **Star power:** the last two bars of every other phrase are star phrases.
  Playing one through fills a quarter of the meter. At half, the drop, a sung
  chorus or a big phrase start sets it off.
- **Sections:** "VERSE 1", "CHORUS 2", "BREAKDOWN" in scratchy chalk type at
  the top. They come from the synced lyrics' choruses when there are lyrics,
  else from energy and whether the kick is playing.
- **Console finish:** drawn at 480 lines and scaled up soft, with a faint
  interlace; **Clean** draws at full resolution.
- **Fonts** (open licences, bundled): Rock Salt (Apache 2.0) for section
  names, Bungee (OFL) for the HUD, New Rocker (OFL) for posters and signs.
  The games' own fonts aren't published and can't be shipped.

## Venues
| Venue | What's there |
|---|---|
| **Garage** | A rehearsal room: board walls, rafters, a bare bulb swinging every bar, posters (original bands), an amp stack with a guitar leaning on it, milk crates, records, a pizza box, a woofer that pumps with the bass, a couch under the window with a red guitar on it. |
| **Arena** | A metal stage under a giant horned skull with burning eyes (blue in star power): spotlights from the truss, par cans stepping on the beat, speaker walls, a band headbanging on the kick, pyro along the stage front that goes up on the drop. |
| **Neon '80s** | A club: neon tubes buzzing with the beat, a mirror ball, lasers on the drop, a checkerboard stage, hair-metal silhouettes. |
| **Stadium** | Night: screens with the music as LED bars, a ring-of-fire LED wall, lamps chasing round the roof arch, searchlights, camera flashes, lighters, fireworks in star power. |

The scoreboard is shared by every highway in a window. Changing venue
mid-song keeps the score, and two highways crossfading never count a note
twice.

## Build and check
1. `fretHighway` generator on the canvas look base, four presets in Pop
   Culture.
2. Unit tests: the grid, loop finding, prediction through a change of
   groove, lane rules, star phrases, and charting real audio (a drum loop and
   a riff).
3. `npm run fret:capture`: the band track through the built app, frames of
   every venue and the hit rate.
