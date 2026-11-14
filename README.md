# Earth Jukebox

**Hear NASA's views of Earth.** Earth Jukebox turns visualizations from NASA's Earth Information
Center into sound: city lights at night, carbon dioxide, lightning, and the aerosols in the air. A scan line crosses the world
from west to east, and whatever it crosses plays. North sounds higher and in your left ear, south
lower and in your right.

It is made for blind and low-vision listeners first. A first-time screen reader user can open it and
use it alone: the page says what to press next, every action is a button, and the player answers
"Where am I?" at any moment. A 3D globe shows what is playing, but you never need it.

Built for **NASA Space Apps 2026: The Earth Information Jukebox**.

## Tracks

| # | Track | NASA resource |
| --- | --- | --- |
| 1 | **Earth at night**, one scan per year, 2012 to 2023 | Resource 1: [Change in Night Lights between 2012 and 2023, EIC version](https://svs.gsfc.nasa.gov/5313/) |
| 2 | **Night lights: what changed**, NASA's 2012 to 2023 change map | Resource 1 |
| 3 | **Carbon dioxide**, seven weeks of early 2020 on a turning globe | Resource 6: [DYAMOND Global Carbon Dioxide](https://svs.gsfc.nasa.gov/5196/) |
| 4 | **Lightning**, March 2017 to July 2023 in 14 parts, in order | Resource 7: [Lightning Events Detected from the ISS 2017-2023](https://svs.gsfc.nasa.gov/5011/) |
| 5 | **Aerosols**, four winds over one moment of NASA's model, 19 August 2025 | Resource 3: [GEOS Aerosols (2025)](https://svs.gsfc.nasa.gov/5669/) |

## Using it without sight

1. Open the page. The first **Tab** is "Skip to the player".
2. Choose a track in the track list with the arrow keys.
3. Tab to the player's **keyboard area** and press **Space**.

In the keyboard area (and on any player button):

| Key | Does |
| --- | --- |
| Space | Play or pause |
| Left, Right | Previous or next map (year, week or month) |
| Home, End | First or last map |
| W | Where am I: track, map, where the scan line is, the last note and which ear (on Aerosols: what you listen to and which aerosols are under the line) |
| D | Describe this map (pauses first) |
| S | What the sounds mean |
| H | Every key |
| 1 to 5 | Choose a track |
| M | Mono on or off |
| C | On Lightning: compare each part with the previous part |
| A, B, U, T, L | On Aerosols: all four winds, or black carbon, dust, sea salt or sulfate alone (also the "Listen to" radios) |
| Escape | Stop all sound and speech, from anywhere |

The single-letter keys work only inside the player, so they never clash with screen reader keys
(WCAG 2.1.4). The keyboard area is `role="application"`, so NVDA and JAWS switch to focus mode there
by themselves. Every key is also a button. Below the player: **What the sounds mean** (each sound with
an example button), **Explore one place** (city buttons and two sliders: hear one 10 degree square),
and **Settings** (volume, speed, mono, say each new map, read aloud, save as audio file). Settings
are remembered on the device.

## Run it

The processed NASA data and the built audio engine are in the repository, so the site runs with only
Python 3.10+:

```bash
python3 scripts/serve.py 8000      # no-cache server with byte ranges (Safari needs them for video)
```

Open <http://localhost:8000>, put on headphones, and follow "Start here". Browsers only allow
sound after a key press or click, so nothing plays on page load.

## Develop and test

```bash
npm install                        # Tone.js, esbuild, Playwright, axe-core
npm run build                      # bundle Tone.js into public/bundle.js (global EJ)
npm run api                        # 3-degree grids -> public/api scores (standard library only)
npm run validate                   # check public/api against backend/API.md: prints "API OK"
npm test                           # the real page, keyboard only: every key, speech, sound level, axe, no trap
npm run test:responsive            # 320 to 1440 px: no sideways scroll, touch targets >= 44 px
python3 -m unittest backend/tests/test_sweep.py   # known-answer tests for the score builder
```

To rebuild a track from NASA's video or image, put it in `data/eic/` or point `EJ_RESOURCES` at the
folder that holds it (see each `backend/eic/tracks/*.yaml` for the file and URL), then:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/eic/pipeline/requirements.txt
npm run eic -- 07_lightning        # or 01_night_lights, 06_co2_dyamond, 03_aerosols
npm run api && npm run validate
cd backend/eic && python3 -m pipeline.validate --track 03   # known places, and heat maps in backend/eic/debug/
```

## How it works

1. **Reading NASA's video** (`backend/eic/`, team RUSTMN's pipeline, numpy and OpenCV). Each track's
   YAML says how. Night lights: the 8K EIC video, calibrated against 10 cities, lights separated from
   the base map. Carbon dioxide: a thin line through the centre of NASA's turning globe, read every 3
   hours of model time. Lightning: NASA's Science On a Sphere movie is already a flat world map, read
   at its own 4096 x 2048 pixels in 14 equal parts; each yellow mark is counted once, when it first
   appears, on a 1 x 3 degree grid, and the share of each 3 degree cell covered by marks is averaged
   over the part. Aerosols: NASA's 8K still draws four aerosols as half-see-through colours that
   overlap; each pixel is unmixed into black carbon, dust, sea salt and sulfate (the colours of NASA's
   own key, in linear light, with the fewest types that explain the colour) after city lights and
   fire dots are painted over, and the bare land and ice come from the Blue Marble. Sea salt is read
   only over the sea and near coasts. Each type is scaled to its own thickest places.
   Output: a 3 degree grid per map in `public/data/` and map images in `public/media/`.
2. **Scores** (`backend/build_sweep.py`, standard library). Pools the grid to 10 degree squares, adds
   statistics and the spoken description of every map (naming the cities in the busiest squares), and
   writes `public/api/` following `backend/API.md`. `backend/validate_api.py` checks it.
3. **Sound** (`public/sweep/`, team RUSTMN's engine on Tone.js). The scan advances one 3 degree column
   at a time; a vibraphone rings as it crosses bright places, a hum follows everything under the
   line, and carbon dioxide adds tension over dense plumes and a heartbeat for each day. Lightning
   is a small orchestra in E flat, after NASA's Butterfly Nebula sonification (a sustained texture
   under distinct notes): a quiet, muted harp note for each lightning mark (crowded marks become a
   soft flurry), a storm wind that swells with the marks near the line, a deep contrabass for how
   much lightning is under the line, and bowed strings that sit higher when the storms are farther
   north. Its sound moves from the left ear to the right as the line crosses from west to east. A
   compare pass plays the change from the previous part instead: rising notes for more, falling
   notes for less. Aerosols is four soft winds made from noise, after the wind in NASA's NGC 1300
   sonification: smoke is low, dark and rough with sparse soft crackles, dust is grainy in the
   middle, sea salt is low and airy, sulfate is thin and high. More of an aerosol under the line makes
   its wind louder and brighter; its latitude sets the register (north higher) and the ear (north
   left). Listen to all four, or one alone.
4. **Page** (`public/app.js`, `globe.js`). Plain HTML, CSS and JavaScript; the globe is plain WebGL.

## Data and credits

- Visualizations: NASA's Scientific Visualization Studio, NASA Earth Information Center.
  Night lights: Kel Elkins (USRA); Black Marble: Next Generation (Suomi NPP VIIRS). Carbon dioxide:
  AJ Christensen, Greg Shirah, Helen-Nicole Kostis, Mark SubbaRao; DYAMOND, GEOS-MITgcm. Lightning:
  Lightning Imaging Sensor on the ISS, NASA GHRC DAAC. Aerosols: [GEOS Aerosols (2025)](https://svs.gsfc.nasa.gov/5669/),
  NASA's GEOS model (Goddard Earth Observing System).
- Values are read from the colours of NASA's videos and images, so they are relative levels, not
  satellite or model units. The lightning video has no date label: it is cut into 14 equal parts,
  in order, and no dates are guessed. The aerosol key has no numbers: each aerosol is measured
  against its own thickest places.
- Land on the globe: [NASA Visible Earth, Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble).
- Sound design and video reading for night lights and carbon dioxide: team RUSTMN (Ulaanbaatar).
- Instrument samples: FluidR3_GM soundfont (CC BY 3.0) via
  [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts). Sound: [Tone.js](https://tonejs.github.io/).

## AI assistance

Built with help from an AI coding assistant, Claude Code (Anthropic). It wrote and reviewed much of
the code, tests and documentation; `AGENTS.md` holds the rules it worked under. The team decided what
to build, chose the data, and reviewed and tested the changes. No data, images or audio are AI-generated.

Earth Jukebox is not an official NASA product.
