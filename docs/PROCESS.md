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
| Ocean currents | 7, Perpetual Ocean 2: Western Boundary Currents (SVS 5425) | Bright moving water along a line through the picture |
| Carbon dioxide | 8, DYAMOND Global Carbon Dioxide (SVS 5196) | Carbon dioxide along a line on a turning globe |
| Lightning | 9, Lightning from the ISS 2017 to 2023 (SVS 5011) | Lightning strikes per place |
| Aerosols | GEOS Aerosols (2025) (SVS 5669) | Black carbon, dust, sea salt and sulfate per place, at one moment |

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

**Ocean currents.** The camera moves, so there is no fixed map. As in the carbon dioxide track, a
vertical line through the middle of the picture is read ten times per second of video: how much
bright, white flow (currents in the top 600 metres) sits on each of 54 parts of the line. Land, ice
and space score zero; a pixel only counts if blue sea is within 30 pixels, which keeps the thick,
pure-white core of the Gulf Stream. Dates come from NASA's matching date overlay: 15 January 2021 to
22 December 2023, evenly. The eight scenes (the globe, Kuroshio, Indian Ocean, Agulhas, South
Atlantic, Gulf Stream, Gulf of Mexico, the globe again) were timed from a contact sheet.

**Night lights, carbon dioxide, lightning and aerosols** are explained in each track's YAML file in
`backend/eic/tracks/` (and aerosols also in `backend/README.md`).

## Turning numbers into sound (public/sweep, Tone.js)

One rule holds on every track, so a listener learns it once:

- **Up is higher and left; down is lower and right.** Pitch follows latitude (or height in the
  picture) on a pentatonic scale; stereo runs along the line.
- **A note marks a place that stands out** (a bright city, thick smoke, a fast current) at the moment
  the line crosses it. Louder means more.
- **A drone carries everything under the line**, so silence means "nothing here" and a swell means
  "a lot here".
- **Time has a pulse** where the data has a calendar: a heartbeat per day for carbon dioxide, a soft
  pulse per month for the ocean.

Notes use a pentatonic scale, so notes never clash by accident. When they do clash, it is on
purpose and it means something.

## Beauty and urgency

The challenge asks how sound can carry the feeling of Earth science data. We let each dataset's
meaning choose its mood:

- **Air quality sounds uneasy where the air is worst.** Clean air is a calm, open drone. Over each
  pollutant's thickest tenth, the drone turns rough and sour and the notes slip from a major scale
  into a minor one. Listen to the scan cross Central Africa's burning season or eastern China: you
  hear it before anyone tells you.
- **The ocean is beautiful, and we kept it that way.** It gets a harp in D major, a warm open drone,
  and no sourness at all: its currents link every coast on Earth. The descriptions add the urgency
  in words: the Gulf Stream is part of an Atlantic circulation that scientists watch because a warming
  climate may slow it.
- **Night lights rise and fall.** Light that is new since 2012 rises in a pair of notes; light that
  went out falls, on a cello.
- **Carbon dioxide never goes silent.** Its drone only gets quieter, and it turns tense over the
  densest plumes.
- **Lightning is dark but calm.** Storms are not bad news, so it is a small orchestra in E flat with no
  clashing notes: a muted harp note for each lightning mark, a storm wind, a deep contrabass for how
  much lightning is under the line, and strings that sit higher when the storms are farther north.
- **Aerosols are four winds.** After the wind in NASA's NGC 1300 sonification: smoke is low, dark and a
  little rough, with soft crackles where it is thickest; dust is grainy; sea salt is low and airy;
  sulfate is thin and high. Listen to all four, or to one alone.

## Checking the work

- `backend/validate_api.py` checks every score against the contract in `backend/API.md`.
- `backend/tests/test_sweep.py` tests the score builders with known answers.
- `test/run.cjs` drives the real page by keyboard in a browser: every key, every track, the spoken
  answers, the sound level, the video staying in step, axe, and no keyboard trap.
- `test/responsive.cjs` checks every width from 320 to 1440 pixels.

What we could not check ourselves: VoiceOver, NVDA and JAWS by hand, and vibration on a real phone.

## Credits

Visualizations: NASA's Scientific Visualization Studio and the NASA Earth Information Center. Sound
design and video reading for night lights and carbon dioxide: team RUSTMN (Ulaanbaatar). Samples:
FluidR3_GM soundfont (CC BY 3.0). Built with help from an AI coding assistant; no data, images or
audio are AI-generated.
