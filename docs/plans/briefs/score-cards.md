# Score cards: late 90s and early 2000s

Each look scored 1-5 on the six tests from the plan (see
[late90s-2000s-plan.md](../late90s-2000s-plan.md), Part 1), after the
look-check gates: the music sheet (groove, build end, drop, two beats after,
breakdown, sung, breakbeat, silence), three minutes of the club track, four
aspect ratios, four palettes, the flash capture and the frame rate.

* **Recognisable**: someone who was there names it in a few seconds.
* **Musical**: the kick, the bar, the phrase, the drop and silence all read.
* **Beautiful**: a still frame would make a good thumbnail.
* **Fresh**: nothing else in the library does this.
* **Alive**: still changing after three minutes; no loop is obvious.
* **Solid**: no breakage at any aspect, palette or frame rate.

Nothing ships under 4 on any test. Scores that started under 4 are noted
with what fixed them.

| Look | Rec | Mus | Beau | Fresh | Alive | Solid | Notes |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| Silhouette Dance | 5 | 5 | 4 | 5 | 4 | 4 | Was 3 on Beautiful (stick figures, crossed mirrored legs) and Solid (invisible on dark stops, oversized on 9:16): fuller bodies, mirrored poses swap parameters, light-only backgrounds, fits tall screens. |
| Plugin Party / Ambient / Hard Cuts | 5 | 5 | 4 | 4 | 5 | 4 | A new preset every phrase keeps it alive over three minutes. |
| Bullet Time / Frozen Rain | 4 | 4 | 4 | 5 | 4 | 4 | Was 2 on Beautiful (flat, wide opaque debris): bullet and air rings, glass transparency, a compact burst. |
| Y2K Rollover / Millennium Fireworks | 5 | 5 | 4 | 5 | 4 | 4 | Digits flicker at 4 Hz, not 12; bloom off the crash screen; 1900 readable; digits fit the width. |
| Glowstick Rave / Poi Flowers | 5 | 5 | 5 | 4 | 4 | 4 | Pattern changes crossfade over a beat so trails never jump; haze is a round glow. |
| Fractal Flame / Flame Embers | 5 | 4 | 5 | 4 | 5 | 4 | Morphs crossfade instead of collapsing; auto quality holds the frame rate (slowest look in software rendering, 1.7 fps vs 10.2 for the reference look; real GPUs are far faster). |
| Plasma Globe | 5 | 5 | 5 | 5 | 4 | 4 | Was 3 on Recognisable (tendrils stopped halfway, hot spots were slivers): tendrils reach the glass, round hot spots, the globe fits tall screens. |
| Fiber Optic Lamp | 5 | 4 | 4 | 5 | 4 | 4 | Was 2 on Beautiful (grey slivers): round glowing tips, the wheel lands on pure palette colours and each change sweeps across the spray; base lifted, fits tall screens. |
| Synesthesia Rail / Rail Ocean | 4 | 5 | 4 | 5 | 5 | 4 | Hits burst on the note grid; brighter, thicker lines; empty void in silence by design. |
| Trance Swoosh / Sunrise Set | 5 | 4 | 5 | 4 | 4 | 5 | Swooshes rest in the breakdown and silence, leaving the core. |
| Console Boot Fog / Boot Fog Violet | 4 | 4 | 4 | 5 | 4 | 4 | The swell at the end of each phrase can fill the screen with a near tower for a moment. |
| Aqua Gel / Graphite Gel | 5 | 5 | 5 | 5 | 4 | 5 | Flat row of beads in silence. |
| Burn Disc / Gold Master | 5 | 4 | 5 | 5 | 5 | 5 | The burned area creeps outward through the song. |
| Cel-Shade / Ink Rush | 5 | 5 | 5 | 5 | 4 | 5 | Squash on the kick and speed lines through the build both read on the sheet. |
| Accelerator Demo / Fog Benchmark | 4 | 4 | 4 | 5 | 4 | 4 | 16-bit banding and dither on purpose. |
| Skate Video | 4 | 5 | 4 | 4 | 4 | 4 | Fisheye hood corners tuned; DV combing shows on movement. |
| Flat Panel Plugin | 4 | 5 | 4 | 4 | 5 | 4 | Early LCD ghosting and grey blacks over the plugin. |

## Known limits of the gates

* **Flash:** the capture reaches only 0.4-3.3 frames a second in this
  software-rendered test machine, so it cannot count flashes per second
  the way a real flash test does. No look has a full-screen strobe, and the
  Y2K digits were slowed to 4 Hz by eye; a check on real hardware is still
  worth doing.
* **Colour:** the output tonemap cannot reach the most saturated blues,
  cyans, greens and yellows. Palettes use the closest colours it can show.
* **Frame rate** is measured in software rendering, so it ranks looks
  against each other rather than predicting real frame rates.
