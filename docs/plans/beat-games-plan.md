# Beat Toons: a rhythm-game-style cartoon lyric look

Follows the hero lyric looks (`hero-lyric-visuals-plan.md`). Not a game (no
score, no player): a look that resembles the handheld rhythm-game series of
the 2000s: short cartoon minigames where
simple characters do one action on the beat (a cue, a wind-up, the payoff on
the beat), drawn in flat colours with thick outlines, everything bouncing in
time. No names, characters or art are copied; the likeness is in the feel.

## The quality bar: smooth, fluid, looping to the beat
- **Everything is a function of the beat.** Idle bobs, sways, blinks and
  background patterns are cycles of exactly one beat, two beats or a bar, so
  every loop lands on the downbeat and never drifts.
- **Cartoon motion:** anticipation before every action (a wind-up just before
  the word), the action exactly on the sung time, overshoot and settle after,
  squash on contact and stretch on the rise, follow-through on hair, arms and
  props (secondary motion that lags a little).
- **Continuous, never stepped:** positions come from easing curves of the
  clock, so the motion is smooth at any frame rate.
- **Flat and clean:** a few flat colours per scene, thick dark outlines of one
  weight, soft floor shadows, simple backgrounds that loop.
- **The lyrics are the game:** every sung word is a cue the characters act on,
  and the line also reads as a clean subtitle bar.

## The scenes (one look, three variants)
| Scene | What happens | How the words show |
|---|---|---|
| **Pot Punch** | A karate kid in a white gi punches objects tossed in from the side: pots, bulbs, rocks, balls. Tossed one beat ahead, punched on the word, shattering. The hero word is a big golden barrel and the background flashes. | Each word rides on its object and bursts out big when punched. |
| **Choir** | Three round singers on risers bob together; each word is sung by the next singer (mouth shapes from the letters), the hero word by all three. | Each word pops up in a bubble above its singer and floats away. |
| **Fan Club** | An idol sings and sways on stage, pigtails swinging; a row of fans claps on beats 2 and 4 and jumps with hearts on the hero word. | The idol's speech bubble fills in word by word. |

In instrumental gaps and with no song, the scenes keep looping to the beat
with no words (blank pots, humming, clapping). With no song at all there is no
text on screen.

## Build and check
1. A `beatGames` generator (shown as Beat Toons) on the canvas look base (drawn at screen
   resolution), using the word stream for timing.
2. Three presets (Pop Culture), registered in the lyric router as a look with
   its own lyrics.
3. Captures with the mock song, reviewed frame by frame; lean grading as
   before only if needed.
