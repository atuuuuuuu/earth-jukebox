# Earth Jukebox

**Hear NASA's views of Earth.** Earth Jukebox turns visualizations from NASA's Earth Information
Center into sound: city lights at night, the air we breathe, the ocean's great currents, carbon
dioxide and lightning. A line crosses the picture, and whatever it crosses plays. North (or the top of
the picture) sounds higher and in your left ear, south lower and in your right.

It is made for blind and low-vision listeners first. A first-time screen reader user can open it and
use it alone: the page says what to press next, every key names itself as you press it, every
action is a button, and the player answers "Where am I?" at any moment. On phones that can vibrate,
the notes buzz. A 3D globe (or, for the atmospheric river, NASA's own video) shows what is playing, but you never need it.

Why it sounds the way it does, and how the NASA videos are read: [docs/PROCESS.md](docs/PROCESS.md).

Built for **NASA Space Apps 2026: The Earth Information Jukebox**.

## Tracks

Resource numbers are the order on the challenge's Resources tab.

| # | Track | NASA resource |
| --- | --- | --- |
| 1 | **Earth at night**, one scan per year, 2012 to 2023 | 1 and 3: [EIC content](https://svs.gsfc.nasa.gov/gallery/earth-information-center/), [Change in Night Lights between 2012 and 2023, EIC version](https://svs.gsfc.nasa.gov/5313/) |
| 2 | **Night lights: what changed**, NASA's 2012 to 2023 change map | 1 and 3 |
| 3 | **Air quality**, four pollutants, July and August 2024 | 6: [Air Quality Model Runs](https://svs.gsfc.nasa.gov/5533/) |
| 4 | **Ocean currents**, a guided lesson on the Gulf Stream (direction, then speed, then change), then NASA's world map of the ocean's surface currents, March 2007 to March 2008 | 7: [Perpetual Ocean 2: Western Boundary Currents](https://svs.gsfc.nasa.gov/5425/) (the lesson) and [Global Sea Surface Currents and Temperature](https://svs.gsfc.nasa.gov/3912/) (the map) |
| 5 | **Carbon dioxide**, a world map from NASA's turning globe, 14 January to 3 March 2020 | 8: [DYAMOND Global Carbon Dioxide](https://svs.gsfc.nasa.gov/5196/) |
| 6 | **Lightning**, March 2017 to July 2023 in 14 equal parts | 9: [Lightning Events Detected from the ISS 2017-2023](https://svs.gsfc.nasa.gov/5011/) |
| 7 | **Atmospheric river**, NASA's 3D film of a Pineapple Express, December 2010, with NASA's clock over the film | [A 3D View of an Atmospheric River from an Earth System Model](https://svs.gsfc.nasa.gov/4960/) |
| 8 | **El Niño: then and now**, NASA's map of sea temperature compared with normal, each month of 2025 then the same month of 2026 | [Sea Surface Temperature (SST) Anomaly, Near Real Time](https://svs.gsfc.nasa.gov/5176/) |

## Using it without sight

1. Open the page. The first **Tab** is "Skip to the player".
2. Choose a track in the track list with the arrow keys.
3. Tab to the player's **keyboard area** and press **Space**.

In the keyboard area (and on any player button):

| Key | Does |
| --- | --- |
| Space | Play or pause |
| Left, Right | Previous or next map (year, pollutant, scene, week or part) |
| Home, End | First or last map |
| W | Where am I: track, map, where the scan line is, the last note and which ear |
| D | Describe this map (pauses first) |
| S | What the sounds mean |
| H | Every key |
| 1 to 6 | Choose a track |
| M | Mono on or off |
| Escape | Stop all sound and speech, from anywhere |

Each key says its name before its answer ("Next map. 2014, map 3 of 12"), with a soft click; a key
with no job says so. The single-letter keys work only inside the player, so they never clash with screen reader keys
(WCAG 2.1.4). The keyboard area is `role="application"`, so NVDA and JAWS switch to focus mode there
by themselves. Every key is also a button. Below the player: **What the sounds mean** (each sound with
an example button), **Explore one place** (city buttons and two sliders: hear one 10 degree square),
and **Settings** (volume, speed, mono, say each new map, name each key, click on each key, vibrate,
read aloud, save as audio file). Settings are remembered on the device. The atmospheric river follows
NASA's moving camera, so it has no map of places to explore.

**Ocean currents starts with a guided lesson** (`public/lesson.js`), placed before the player: Tab
from the track list lands in it. Thirteen short steps teach one idea at a time: what a current is
(and how it differs from a wave), then the Gulf Stream's direction at four places, then its speed
across the stream, then how it changes over 12 snapshots 8 days apart. Every sound is explained before
it plays and has its own example button. Direction is a tone that travels the way the water goes
(rises = north, falls = south, left ear to right ear = east); speed is soft ticks in the middle
(faster = faster water). Keys in the lesson's keyboard area: Right and Left (next step, back), Space
(play or pause), R (replay), W (where am I), D (read the step again), T (go to the full tour),
H (every key); L in the player comes back. The lesson's own settings: pace (slow, normal, fast),
lesson volume, an ocean background that is off unless asked for and carries no information, and the
read-aloud voice's on/off, volume and speed.

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
npm run test:lesson                # the ocean lesson by keyboard: explain, play, pause, go on, replay, axe
npm run test:backend               # known-answer tests: score builder, validator, lightning correction
```

`test:backend` needs the pipeline's Python packages (`pip install -r backend/eic/pipeline/requirements.txt`).
GitHub runs the backend tests and the API check before every deploy (`.github/workflows/pages.yml`), and
the two browser tests on every push (`.github/workflows/tests.yml`).

To rebuild a track from NASA's video, put the video in `data/eic/` (see each `backend/eic/tracks/*.yaml`
for the file and URL; `data/eic/` is not in git), then:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/eic/pipeline/requirements.txt
npm run eic -- 06_air_quality      # or 01_night_lights, 06_co2_map, 07_ocean_map, 07_ocean_lesson, 07_lightning, 09_el_nino
npm run api && npm run validate
```

Two builders read our smaller web copies of NASA's films, which used to sit in `public/media/` and are
kept in git history. Restore them with:

```bash
mkdir -p data/eic/07_Perpetual_Ocean data/eic/06_CO2_DYAMOND
git show 281f561:public/media/07_ocean_currents/tour.mp4 > data/eic/07_Perpetual_Ocean/tour.mp4   # 07_ocean_lesson
git show 281f561:public/media/06_co2_dyamond/orbit.mp4 > data/eic/06_CO2_DYAMOND/orbit.mp4       # 06_co2_map
```

El Niño (`09_el_nino`) reads NASA's 4096 x 2048 film `sst_anomaly_30_sec_4096x2048_2x1_30p.mp4` and its
colour bar `colorbar.jpg`, both from [SVS 5176](https://svs.gsfc.nasa.gov/5176/), in `data/eic/09_SST_Anomaly/`.

## How it works

1. **Reading NASA's video** (`backend/eic/`, team RUSTMN's pipeline, numpy and OpenCV). Each track's
   YAML says how. Night lights: the 8K EIC video, calibrated against 10 cities, lights separated from
   the base map. Ocean currents: NASA's flat ECCO2 world map film (SVS 3912, its land matches the
   Blue Marble with correlation 0.96), averaged over the year: brighter flow lines are faster water
   (`globe_map.py`, `projection: flat`; put the film in `data/eic/07_ECCO2/`). Carbon dioxide: NASA's
   film of the globe turning, flattened into one world map (`globe_map.py`). NASA's camera is close to
   the globe (4.5 Earth radii, fitted), and the longitude facing it is measured in every 49th frame by
   matching NASA's land to the Blue Marble (correlation 0.81); every frame is then projected onto a
   0.25 degree map and each place averages the frames that show it face-on. Air quality: four pollutants in strips that slide over one flat map; each
   strip is found in every frame and its colours rebuilt into a full world map per pollutant. Ocean
   lesson: where NASA's camera holds still over the Gulf Stream (spring 2023), the optical flow of
   NASA's white flow lines gives direction and relative speed; places are found with an affine fit to
   nine coast points (worst 11 px), the camera's drift is subtracted, and the builder stops unless the
   measured directions agree with known geography (north off Miami, east off the Carolinas).
   Lightning: NASA's Science On a Sphere movie is already a flat world map; yellow strike pixels are
   averaged over the frames of each of 14 equal parts, in order, then divided by how often the space
   station looks at each latitude (its orbit turns round near 50 degrees north and south, so it sees
   those storms about four times as often as storms at the equator). Output: a 3 degree grid per map
   (or one line per step) in `public/data/` and images or video in `public/media/`.
2. **Scores** (`backend/build_sweep.py`, standard library). Pools the grid to 10 degree squares, adds
   statistics and the spoken description of every map (naming the cities in the busiest squares), and
   writes `public/api/` following `backend/API.md`. `backend/validate_api.py` checks it.
3. **Sound** (`public/sweep/`, team RUSTMN's engine on Tone.js). The scan advances one 3 degree column
   at a time; notes ring as it crosses bright places (vibraphone for lights and air, harp for the
   ocean, kalimba for lightning), a drone follows everything under the line. The worst air turns the
   drone sour and the notes minor; the atmospheric river adds a soft pulse each time NASA's clock
   passes midnight. El Niño is two-sided: a rising pair of notes where the sea is much warmer than
   normal, a low falling cello where it is much cooler.
4. **Page** (`public/app.js`, `globe.js`). Plain HTML, CSS and JavaScript; the globe is plain WebGL.

### The sound follows NASA's Caldwell 73 sonification

The challenge lists NASA's [Data Sonification: Caldwell 73](https://svs.gsfc.nasa.gov/13786/) as its
model. There, a radar line sweeps round a star cluster, a star's place on the line sets its pitch, the
whole image sounds as a choir, and bright stars ring as marimba and glockenspiel notes. Earth Jukebox
keeps that grammar for Earth maps: a scan line sweeps the world, a place's latitude on the line sets its
pitch (and its ear), the whole line sounds as a deep hum, and bright places ring as single notes.

## Data and credits

- Visualizations: NASA's Scientific Visualization Studio, NASA Earth Information Center.
  Night lights: Kel Elkins (USRA); Black Marble: Next Generation (Suomi NPP VIIRS). Carbon dioxide:
  AJ Christensen, Greg Shirah, Helen-Nicole Kostis, Mark SubbaRao; DYAMOND, GEOS-MITgcm. Lightning:
  Lightning Imaging Sensor on the ISS, NASA GHRC DAAC. Air quality: NASA GEOS-CF. Ocean: Greg
  Shirah, Horace Mitchell (NASA/GSFC); scientists Atousa Saberi (NASA/GSFC), Josh Willis (JPL); ECCO2.
- Values are read from the colours of NASA's videos, so they are relative levels, not satellite units.
  The lightning video has no date label and its speed is uneven, so it is split into 14 equal parts
  and no part claims a month or date. Lightning is corrected for how often the space station looks
  at each latitude (`iss_view_weight` in `backend/eic/pipeline/tracks/lightning.py`, with tests).
- Sound design model: [Data Sonification: Caldwell 73](https://svs.gsfc.nasa.gov/13786/), NASA Hubble,
  sonification by SYSTEM Sounds (M. Russo, A. Santaguida).
- Land on the globe: [NASA Visible Earth, Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble).
- Sound design and video reading for night lights and carbon dioxide: team RUSTMN (Ulaanbaatar).
- The ocean web video is a 640 x 360 copy of NASA's; the raw NASA videos are not in the repository.
- Instrument samples: FluidR3_GM soundfont (CC BY 3.0) via
  [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts). Sound: [Tone.js](https://tonejs.github.io/).

## AI assistance

Built with help from an AI coding assistant, Claude Code (Anthropic). It wrote and reviewed much of
the code, tests and documentation; `AGENTS.md` holds the rules it worked under. The team decided what
to build, chose the data, and reviewed and tested the changes. No data, images or audio are AI-generated.

Earth Jukebox is not an official NASA product.
