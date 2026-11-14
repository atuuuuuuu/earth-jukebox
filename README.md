# Earth Jukebox

**Hear NASA's views of Earth.** Earth Jukebox turns visualizations from NASA's Earth Information
Center into sound: city lights at night, carbon dioxide, and lightning. A scan line crosses the world
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
| 4 | **Lightning**, March 2017 to July 2023 in 14 equal parts | Resource 7: [Lightning Events Detected from the ISS 2017-2023](https://svs.gsfc.nasa.gov/5011/) |

## Using it without sight

1. Open the page. The first **Tab** is "Skip to the player".
2. Choose a track in the track list with the arrow keys.
3. Tab to the player's **keyboard area** and press **Space**.

In the keyboard area (and on any player button):

| Key | Does |
| --- | --- |
| Space | Play or pause |
| Left, Right | Previous or next map (year, week or part) |
| Home, End | First or last map |
| W | Where am I: track, map, where the scan line is, the last note and which ear |
| D | Describe this map (pauses first) |
| S | What the sounds mean |
| H | Every key |
| 1 to 4 | Choose a track |
| M | Mono on or off |
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

To rebuild a track from NASA's video, put the video in `data/eic/` (see each `backend/eic/tracks/*.yaml`
for the file and URL), then:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/eic/pipeline/requirements.txt
npm run eic -- 07_lightning        # or 01_night_lights, 06_co2_dyamond
npm run api && npm run validate
```

## How it works

1. **Reading NASA's video** (`backend/eic/`, team RUSTMN's pipeline, numpy and OpenCV). Each track's
   YAML says how. Night lights: the 8K EIC video, calibrated against 10 cities, lights separated from
   the base map. Carbon dioxide: a thin line through the centre of NASA's turning globe, read every 3
   hours of model time. Lightning: NASA's Science On a Sphere movie is already a flat world map;
   yellow strike pixels are averaged over the frames of each of 14 equal parts, in order. Output: a 3 degree grid
   per map in `public/data/` and map images in `public/media/`.
2. **Scores** (`backend/build_sweep.py`, standard library). Pools the grid to 10 degree squares, adds
   statistics and the spoken description of every map (naming the cities in the busiest squares), and
   writes `public/api/` following `backend/API.md`. `backend/validate_api.py` checks it.
3. **Sound** (`public/sweep/`, team RUSTMN's engine on Tone.js). The scan advances one 3 degree column
   at a time; notes ring as it crosses bright places (vibraphone for lights, kalimba for lightning),
   a hum follows everything under the line, and carbon dioxide adds tension over dense plumes and a
   heartbeat for each day.
4. **Page** (`public/app.js`, `globe.js`). Plain HTML, CSS and JavaScript; the globe is plain WebGL.

## Data and credits

- Visualizations: NASA's Scientific Visualization Studio, NASA Earth Information Center.
  Night lights: Kel Elkins (USRA); Black Marble: Next Generation (Suomi NPP VIIRS). Carbon dioxide:
  AJ Christensen, Greg Shirah, Helen-Nicole Kostis, Mark SubbaRao; DYAMOND, GEOS-MITgcm. Lightning:
  Lightning Imaging Sensor on the ISS, NASA GHRC DAAC.
- Values are read from the colours of NASA's videos, so they are relative levels, not satellite units.
  The lightning video has no date label and its speed is uneven, so it is split into 14 equal parts
  and no part claims a month or date.
- Land on the globe: [NASA Visible Earth, Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble).
- Sound design and video reading for night lights and carbon dioxide: team RUSTMN (Ulaanbaatar).
- Instrument samples: FluidR3_GM soundfont (CC BY 3.0) via
  [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts). Sound: [Tone.js](https://tonejs.github.io/).

## AI assistance

Built with help from an AI coding assistant, Claude Code (Anthropic). It wrote and reviewed much of
the code, tests and documentation; `AGENTS.md` holds the rules it worked under. The team decided what
to build, chose the data, and reviewed and tested the changes. No data, images or audio are AI-generated.

Earth Jukebox is not an official NASA product.
