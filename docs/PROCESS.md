# How Earth Jukebox was made, and why

Earth Jukebox turns NASA Earth Information Center visualizations into sound for blind and low-vision
listeners. This note explains the choices behind it: what we read from NASA's pictures, how those
numbers become sound, and why each track sounds the way it does.

## Who it is for

Most data sonification is built for sighted people: a chart first, with sound added on top. We
started from the other end. Our test was simple: a blind person who has never seen the page opens it
with a screen reader and uses it alone, with no one explaining it.

That decided the interface before any sound was designed:

- **Every key answers.** Each key says what it did before the answer ("Next map. 2014, map 3 of 12"),
  with a soft click; a key with no job says so instead of doing nothing. Both can be turned off.
- **You can always ask where you are.** `W` names the track, the map, where the line is, how loud it
  is, and which ear the last note came from.
- **Every sound has an example.** "What the sounds mean" plays each sound alone, then explains it.
- **Text carries the same facts as the sound.** `D` reads a description of the current map, built from
  the same numbers that make the sound.
- **Touch.** On phones that can vibrate, each note buzzes, louder notes longer, and each beat pulses.
- **Standards.** Native buttons, sliders and radios; one-letter keys only inside the player
  (WCAG 2.1.4); every check passes axe with WCAG 2.2 AA rules; the whole page works by keyboard.

## The tracks and the NASA resources

| Track | NASA resource (challenge number) | What we read |
| --- | --- | --- |
| Earth at night, and what changed | 1, EIC content; 3, Change in Night Lights 2012 to 2023 (SVS 5313) | Brightness of city lights per year |
| Air quality | 6, Air Quality Model Runs (SVS 5533) | Four pollutants from NASA's GEOS-CF model, July and August 2024 |
| Ocean currents: the guided lesson | 7, Perpetual Ocean 2: Western Boundary Currents (SVS 5425) | Direction and speed of the Gulf Stream, from how NASA's flow lines move |
| Ocean currents: the world map | Global Sea Surface Currents and Temperature (SVS 3912) | How bright NASA's flow lines are, averaged over a year |
| Carbon dioxide | 8, DYAMOND Global Carbon Dioxide (SVS 5196) | Carbon dioxide on NASA's turning globe, flattened into one world map |
| Lightning | 9, Lightning from the ISS 2017 to 2023 (SVS 5011) | Lightning strikes per place |
| Atmospheric river | A River in the Sky (SVS 4960) | Water vapour along a line through NASA's moving picture, with NASA's own clock |
| El Niño: then and now | Sea Surface Temperature Anomaly, Near Real Time (SVS 5176) | Degrees C warmer or cooler than normal, read from NASA's colour bar, one map a month |

## Reading NASA's pictures (backend/eic, Python with OpenCV)

We never invent a number: every value comes from the pixels of NASA's own videos. Values are
relative positions on NASA's colour scales, not physical units, and the page says so.

**Air quality.** NASA's wide Earth Information Center movie (3840 x 1080) shows one flat world map
with four pollutants in vertical strips 500 pixels wide, in a repeating order: nitrogen oxides,
ozone, carbon monoxide, fine particles. The strips slide 40 pixels a second while the map stays
still. We measured the map from landmarks: 6 pixels per degree, 180° W at the left, 90° N at the
top, repeating every 2160 pixels, so the frame shows the whole world once and part of it twice. (The
16:9 version of the same movie stops at 140° E, which left Japan, eastern Australia and New Zealand
blank; the wide one does not.) In every third frame we:

1. find the green nitrogen-oxides strip by folding the frame onto the 2000-pixel pattern;
2. assign every pixel column to its pollutant, skipping 6 pixels at each strip edge and the label boxes;
3. turn each pixel's colour into a position on that pollutant's scale (yellow to dark red for carbon
   monoxide, cream to brown for particles, black-white-green for nitrogen oxides, grey to purple for
   ozone);
4. fold the repeated map back onto one world and add it to that pollutant's 3-degree grid.

In one minute every place passes under every strip at least once, so we get four complete world
maps, plus a picture of each, rebuilt from the strips.

**Ocean currents, the guided lesson.** For 28 seconds of Perpetual Ocean 2, NASA's camera holds
still over the Gulf Stream (17 March to 19 June 2023). We measure how NASA's white flow lines move
from frame to frame (optical flow) and subtract the camera's small drift, so land stays still. A fit
to 9 coast points places every pixel on the map (worst error about 50 km). The builder stops unless
the directions match known geography: north off Miami, northeast off Georgia, east off the
Carolinas, and west far out in the Atlantic, where slow water drifts back.

**Ocean currents, the world map.** NASA's ECCO2 film (SVS 3912) is already a flat world map, March
2007 to March 2008; its land matches the Blue Marble with a correlation of 0.96, and the builder
stops below 0.9. Faster water draws longer, brighter trails, so each place's strength is how bright
NASA's flow lines are there, averaged over the year. (Measuring their motion directly missed the
Gulf Stream: water moving along a line looks the same from frame to frame.)

**Carbon dioxide.** NASA's film shows a globe turning. We fitted NASA's camera (4.5 Earth radii away)
and measured the turn by matching NASA's land to the Blue Marble every 49 frames (0.2007 degrees a
frame), then projected every frame back onto one world map. Each place is the average of the frames
that show it face-on.

**Atmospheric river.** NASA's camera moves, so there is no fixed map: a line through the middle of
the picture is read for NASA's blue water-vapour shading, and NASA's own date overlay is lined up
with the film at 19 points, so the spoken dates and the clock over the picture match NASA's.

**El Niño.** NASA's film is a flat world map, one day a frame from 18 May 2024 to 4 November 2026.
Every colour on the sea is a number on NASA's colour bar (-4 to +4 degrees C from normal), so we
read each pixel back as the nearest bar colour; land, ice and NASA's date stamp match no bar colour
and carry no reading. Every day of a month is averaged into one map. The maps come in pairs, each
month of 2025 then the same month of 2026, so the listener hears the same water a year apart. The
check: NOAA's relative Niño 3.4 for September 2026 was +2.1 degrees C; ours, from NASA's pixels, is
+2.05.

**Night lights and lightning** are explained in each track's YAML file in `backend/eic/tracks/`.

## Turning numbers into sound (public/sweep, Tone.js)

One rule holds on every track, so a listener learns it once:

- **Up is higher and left; down is lower and right.** Pitch follows latitude (or height in the
  picture) on a pentatonic scale; stereo runs along the line. (The ocean lesson is the one exception,
  and says so: its tone moves left to right for east, because it teaches direction.)
- **A note marks a place that stands out** (a bright city, thick smoke, a fast current) at the moment
  the line crosses it. Louder means more.
- **A drone carries everything under the line**, so silence means "nothing here" and a swell means
  "a lot here".
- **Time has a pulse** where NASA's film has a clock: a soft pulse each time the atmospheric river's
  clock passes midnight. When the pulses race, weeks are flying by.

Notes use a pentatonic scale, so notes never clash by accident. When they do clash, it is on
purpose and it means something.

## Beauty and urgency

The challenge asks how sound can carry the feeling of Earth science data. We let each dataset's
meaning choose its mood:

- **Air quality sounds uneasy where the air is worst.** Clean air is a calm, open drone. Over each
  pollutant's thickest tenth, the drone turns rough and sour and the notes slip from a major scale
  into a minor one. Listen to the scan cross Central Africa's burning season or eastern China: you
  hear it before anyone tells you.
- **The ocean is beautiful, and we kept it that way.** It gets a harp, a warm open drone, and no
  sourness at all: its currents link every coast on Earth. A guided lesson comes first and teaches
  one idea at a time (what a current is, then direction, then speed, then change), with every sound
  explained before it plays. The descriptions add the urgency
  in words: the Gulf Stream is part of an Atlantic circulation that scientists watch because a warming
  climate may slow it.
- **Night lights rise and fall.** Light that is new since 2012 rises in a pair of notes; light that
  went out falls, on a cello.
- **Carbon dioxide rings where it is dense.** Notes mark the plumes (eastern China, Africa's fires,
  the Amazon), and a deep hum follows all the carbon dioxide under the line.
- **El Niño is heard a year apart.** In 2025 the El Niño box in the middle of the Pacific is quiet,
  with a few cellos. In the same months of 2026 the same water rings: single notes from May, rising
  pairs from June, and from July the whole box.

## Checking the work

- `backend/validate_api.py` checks every score against the contract in `backend/API.md`.
- `backend/tests/` tests the score builders and the video readers with known answers: the strong
  currents are where the Gulf Stream, Kuroshio and Agulhas run, carbon dioxide is dense over eastern
  China and clean over the South Pacific, the Gulf Stream flows north off Miami, El Niño is in 2026
  and not 2025, and September 2026 agrees with NOAA's index.
- `test/run.cjs` drives the real page by keyboard in a browser: every key, every track, the spoken
  answers, the sound level, the scan line, the video staying in step, axe, and no keyboard trap.
- `test/lesson.cjs` does the same for the guided lesson; `test/responsive.cjs` checks every width
  from 320 to 1440 pixels. GitHub runs all of them on every push.

What we could not check ourselves: VoiceOver, NVDA and JAWS by hand, vibration on a real phone, and
sessions with blind listeners (the plan is in `test/ACCESSIBILITY.md`; no results are recorded yet).

## Credits

Visualizations: NASA's Scientific Visualization Studio and the NASA Earth Information Center. Sound
design and video reading for night lights and carbon dioxide: team RUSTMN (Ulaanbaatar). Samples:
FluidR3_GM soundfont (CC BY 3.0). Built with help from an AI coding assistant; no data, images or
audio are AI-generated.
