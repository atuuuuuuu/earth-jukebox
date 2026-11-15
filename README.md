# Hearth

**Hear NASA's views of Earth.** Hearth (hear + Earth) turns visualizations from NASA's Earth Information
Center into sound: city lights at night, the air we breathe, the ocean's great currents, carbon
dioxide, lightning, and the aerosols in the air. A line crosses the picture, and whatever it crosses
plays. North (or the top of the picture) sounds higher and in your left ear, south lower and in your right.

It is made for blind and low-vision listeners first. A first-time screen reader user can open it and
use it alone: the page says what to press next, every key names itself as you press it, every
action is a button, and the player answers "Where am I?" at any moment. On phones that can vibrate,
the notes buzz. A 3D globe (or NASA's own video) shows what is playing, but you never need it.

Why it sounds the way it does, and how the NASA videos are read: [docs/PROCESS.md](docs/PROCESS.md).

Built for **NASA Space Apps 2026: The Earth Information Jukebox**.

## Tracks

Resource numbers are the order on the challenge's Resources tab.

| # | Track | NASA resource |
| --- | --- | --- |
| 1 | **Earth at night**, one scan per year, 2012 to 2023, then NASA's change map heard as the decade (one note per year); for the whole map or one of NASA's four zoom regions | 1 and 3: [EIC content](https://svs.gsfc.nasa.gov/gallery/earth-information-center/), [Change in Night Lights between 2012 and 2023, EIC version](https://svs.gsfc.nasa.gov/5313/) |
| 2 | **Air quality**, four pollutants, July and August 2024 | 6: [Air Quality Model Runs](https://svs.gsfc.nasa.gov/5533/) |
| 3 | **Ocean currents**, NASA's world map of the ocean's surface currents, March 2007 to March 2008, after a guided lesson on the Gulf Stream (direction, speed, change, one idea at a time) | 2: [Global Sea Surface Currents and Temperature](https://svs.gsfc.nasa.gov/3912/); the lesson, 7: [Perpetual Ocean 2: Western Boundary Currents](https://svs.gsfc.nasa.gov/5425/) |
| 4 | **Carbon dioxide**, seven weeks of early 2020 on a turning globe | 8: [DYAMOND Global Carbon Dioxide](https://svs.gsfc.nasa.gov/5196/) |
| 5 | **Lightning**, March 2017 to July 2023 in 14 equal parts | 9: [Lightning Events Detected from the ISS 2017-2023](https://svs.gsfc.nasa.gov/5011/) |
| 6 | **Aerosols**, four winds over one moment of NASA's model, 19 August 2025; or NASA's six stories on that map, one after another | [GEOS Aerosols (2025)](https://svs.gsfc.nasa.gov/5669/) |
| 7 | **Warm and cold seas**, sea surface temperature in four seasons, March 2007 to March 2008: a level line moves from the Arctic to Antarctica and warm water adds chord voices | 2: [Global Sea Surface Currents and Temperature](https://svs.gsfc.nasa.gov/3912/) |
| 8 | **El Niño: then and now**, how much warmer or cooler than normal the sea is, one map a month: each month of 2025, then the same month of 2026 | Extra NASA resource: [Sea Surface Temperature Anomaly, Near Real Time](https://svs.gsfc.nasa.gov/5176/) |

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
| W | Where am I: track, map, where the scan line is, the last note and which ear (on Aerosols: what you listen to and which aerosols are under the line) |
| D | Describe this map (pauses first) |
| S | What the sounds mean |
| H | Every key |
| 1 to 8 | Choose a track |
| L | On a track with a guided lesson (ocean currents): go to the lesson; T in the lesson comes back |
| M | Mono on or off |
| C | On Lightning: compare each part with the previous part |
| A, B, U, T, L | On Aerosols: all four winds, or black carbon, dust, sea salt or sulfate alone (also the "Listen to" radios) |
| R | On Earth at night: the next region (whole map, Western Europe, Eastern Mediterranean, Ukraine, India). On Aerosols: the whole map or NASA's stories (also the "Region" and "Mode" radios) |
| Escape | Stop all sound and speech, from anywhere |

Each key says its name before its answer ("Next map. 2014, map 3 of 12"), with a soft click; a key
with no job says so. The single-letter keys work only inside the player, so they never clash with screen reader keys
(WCAG 2.1.4). The keyboard area is `role="application"`, so NVDA and JAWS switch to focus mode there
by themselves. Every key is also a button. Below the player: **What the sounds mean** (each sound with
an example button), **Explore one place** (city buttons and two sliders: hear one 10 degree square),
and **Settings** (volume, speed, mono, continuous sound, say each new map, name each key, click on each key, vibrate,
read aloud, save as audio file). Settings are remembered on the device. Ocean currents starts with a
**guided lesson** above the player: the Gulf Stream one idea at a time, with its own keyboard area
(arrows move through the steps, Space plays each step's sound, T goes on to the player).

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
npm run test:backend               # known-answer tests: score builders, validator
```

`test:backend` needs the pipeline's Python packages (`pip install -r backend/eic/pipeline/requirements.txt`).
GitHub runs the backend tests and the API check before every deploy (`.github/workflows/pages.yml`), and
the two browser tests on every push (`.github/workflows/tests.yml`).

To rebuild a track from NASA's video or image, put it in `data/eic/` or point `EJ_RESOURCES` at the
folder that holds it (see each `backend/eic/tracks/*.yaml` for the file and URL), then:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/eic/pipeline/requirements.txt
npm run eic -- 06_air_quality      # or 01_night_lights, 06_co2_dyamond, 07_ocean_map, 07_ocean_lesson, 07_lightning, 03_aerosols, 09_el_nino
npm run api && npm run validate
cd backend/eic && python3 -m pipeline.validate --track 03   # known places, and heat maps in backend/eic/debug/
```

## How it works

1. **Reading NASA's video** (`backend/eic/`, team RUSTMN's pipeline, numpy and OpenCV). Each track's
   YAML says how. Night lights: the 8K EIC video, calibrated against 10 cities, lights separated from
   the base map. Carbon dioxide: a thin line through the centre of NASA's turning globe, read every 3
   hours of model time. Air quality: four pollutants in strips that slide over one flat map; each
   strip is found in every frame and its colours rebuilt into a full world map per pollutant. Ocean:
   NASA's flat ECCO2 film of surface currents, averaged over the year, where brighter flow lines mean
   faster water; the lesson measures how NASA's flow lines move off Florida in Perpetual Ocean 2.
   El Niño: every daily sea temperature anomaly map is read back into degrees from NASA's colour bar
   (-4 to +4 degrees C) and averaged by month.
   Lightning: NASA's Science On a Sphere movie is already a flat world map, read at its own 4096 x 2048
   pixels in 14 equal parts, in order; each yellow mark is counted once, when it first appears, on a
   1 x 3 degree grid, and the share of each 3 degree cell covered by marks is averaged over the part.
   Aerosols: NASA's 8K still draws four aerosols as half-see-through colours that overlap; each pixel
   is unmixed into black carbon, dust, sea salt and sulfate (the colours of NASA's own key, in linear
   light, with the fewest types that explain the colour) after city lights and fire dots are painted
   over, and the bare land and ice come from the Blue Marble. Sea salt is read only over the sea and
   near coasts. Each type is scaled to its own thickest places. Output: a 3 degree grid per map (or one
   line per step) in `public/data/` and images or video in `public/media/`.
2. **Scores** (`backend/build_sweep.py`, standard library). Pools the grid to 10 degree squares, adds
   statistics and the spoken description of every map (naming the cities in the busiest squares), and
   writes `public/api/` following `backend/API.md`. `backend/validate_api.py` checks it.
3. **Sound** (`public/sweep/`, team RUSTMN's engine on Tone.js). The scan advances one 3 degree column
   at a time; notes ring as it crosses bright places (vibraphone for lights and air, harp for the
   ocean), a drone follows everything under the line. The worst air turns the drone sour and the
   notes minor; carbon dioxide adds tension over dense plumes and a heartbeat for each day; El Niño
   plays a rising pair where the sea is warmer than normal and a falling cello where it is cooler. Lightning is a small orchestra in E flat, after NASA's Butterfly
   Nebula sonification (a sustained texture under distinct notes): a quiet, muted harp note for each
   lightning mark (crowded marks become a soft flurry), a storm wind that swells with the marks near
   the line, a deep contrabass for how much lightning is under the line, and bowed strings that sit
   higher when the storms are farther north. Its sound moves from the left ear to the right as the
   line crosses from west to east. A compare pass plays the change from the previous part instead:
   rising notes for more, falling notes for less. Aerosols is four soft winds made from noise, after
   the wind in NASA's NGC 1300 sonification: smoke is low, dark and rough with sparse soft crackles,
   dust is grainy in the middle, sea salt is low and airy, sulfate is thin and high. More of an
   aerosol under the line makes its wind louder and brighter; its latitude sets the register (north
   higher) and the ear (north left). Listen to all four, or one alone.
   **Regions and stories** zoom in. NASA's night lights video ends with pop-out views of four regions;
   their outline boxes on NASA's map are read again from the same frames on a 0.5 degree grid, and the
   year-by-year scans and the change map can play inside one of them. NASA's page for the aerosol map
   describes six events (Hurricane Erin, the Saharan dust crossing the Atlantic, Kilauea's and Etna's
   sulfate, smoke from southern Africa and Spain's wildfires); each gets a window read again from the
   8K still on a 0.75 degree grid, and they play one after another, the aerosol NASA names brought
   forward. Inside a window the scan is slower and pitch and ears stretch to fit it (its north edge is
   highest, in the left ear). The windows are in the track YAMLs; the backend tests check that each
   story's named aerosol is the strongest in its window, and that Kyiv dims and India brightens.
   **Warm and cold seas** turns the scan line on its side. NASA's flat movie of the ocean's surface
   currents colours every flow line by temperature; each colour is read back to degrees Celsius on
   NASA's own key (0 to 32): a lookup table over every colour keeps only bright, strongly coloured
   pixels close to a key colour (a fading line keeps its hue; grey land, white ice and the black sea
   are left out), and each 3 degree cell takes the median of every reading in a quarter of the movie,
   named by NASA's own per-frame dates. A level line then moves from the Arctic to Antarctica, once
   per season, west in the left ear and east in the right. The sound is built from the measured timbre
   of NASA's reference pad (instrument.mp3), not from a soundfont: a harmonic fit of the reference gave
   a nearly pure tone (second partial 19 dB down, third 23 dB), a swell of 1 to 2 seconds and a slow
   tremolo of about 20 percent, and the page synthesises exactly that. A deep D root plays over any sea,
   and as the water under the line warms more and higher chord voices join, at 6, 12, 18, 24 and 28
   degrees, each leaning toward where that warm water is along the line. On top, a soft melody makes the
   temperature itself audible: its pitch climbs one step of the scale for every two degrees, so warming
   is heard as rising notes and cooling as falling notes, and a stretch of the line much warmer than
   the rest adds a note in its own ear. The
   backend tests check the key (a cell coloured like 20 degrees reads 20) and the known places: the
   warm pool, the cold Southern Ocean, the Gulf Stream's warm water reaching north-east, and the cold
   tongue of the equatorial east Pacific (cooling through the La Niña of late 2007).
   **The decade** (Earth at night's last map, after TerraJuke's idea): NASA's change map is shown flat
   (NASA's own EIC print with its four zooms) and heard as one note per year for the whole map or the
   region chosen. A place's light is its brightness above the dark land (each pixel's luma above its
   7 x 7 median, summed, no "lit" threshold, at the EIC print's scale); it starts on A3, and twice the
   light is an octave higher. Then NASA's change-map figure: a rising pair, a falling pair or one note.
   The world grows 24 percent from 2012 to 2023, India 86 percent, Western Europe dims a little.
4. **Page** (`public/app.js`, `globe.js`). Every map track shows the flat map beside the globe. Plain HTML, CSS and JavaScript; the globe is plain WebGL.

### The sound follows NASA's Caldwell 73 sonification

The challenge lists NASA's [Data Sonification: Caldwell 73](https://svs.gsfc.nasa.gov/13786/) as its
model. There, a radar line sweeps round a star cluster, a star's place on the line sets its pitch, the
whole image sounds as a choir, and bright stars ring as marimba and glockenspiel notes. Hearth
keeps that grammar for Earth maps: a scan line sweeps the world, a place's latitude on the line sets its
pitch (and its ear), the whole line sounds as a deep hum, and bright places ring as single notes.

## Data and credits

- Visualizations: NASA's Scientific Visualization Studio, NASA Earth Information Center.
  Night lights: Kel Elkins (USRA); Black Marble: Next Generation (Suomi NPP VIIRS). Carbon dioxide:
  AJ Christensen, Greg Shirah, Helen-Nicole Kostis, Mark SubbaRao; DYAMOND, GEOS-MITgcm. Lightning:
  Lightning Imaging Sensor on the ISS, NASA GHRC DAAC. Air quality: NASA GEOS-CF. Ocean: Greg
  Shirah, Horace Mitchell, Eric Sokolowsky; scientists Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL);
  ECCO2. The Gulf Stream lesson: Perpetual Ocean 2, Greg Shirah, Horace Mitchell (NASA/GSFC); scientists
  Atousa Saberi (NASA/GSFC), Josh Willis (JPL). El Niño: [Sea Surface Temperature Anomaly, Near Real
  Time](https://svs.gsfc.nasa.gov/5176/), NASA's Scientific Visualization Studio; data: MUR SST v4.1
  (NASA JPL PO.DAAC).
  Aerosols: [GEOS Aerosols (2025)](https://svs.gsfc.nasa.gov/5669/), NASA's GEOS model (Goddard Earth
  Observing System); visualizers Joseph V. Ardizzone (NASA/GSFC) and Helen-Nicole Kostis (STC),
  scientist Lesley Ott (NASA/GSFC). NASA's stories on the aerosol map come from the facts on that page,
  told in our own words; the night lights regions are the four zooms NASA draws in
  [its EIC video](https://svs.gsfc.nasa.gov/5313/), at NASA's own outline boxes. The Ukraine box is
  NASA's and also takes in Moldova and parts of Belarus, Russia, Romania and Poland.
- Sea surface temperature: [Global Sea Surface Currents and Temperature](https://svs.gsfc.nasa.gov/3912/),
  NASA/Goddard Space Flight Center Scientific Visualization Studio; visualization by Greg Shirah;
  scientists Hong Zhang (UCLA), Dimitris Menemenlis (NASA/JPL); data: ECCO2 High Resolution Ocean and
  Sea Ice Model (NASA/JPL), GTOPO30 (USGS); dates from NASA's `flat_ecco2_dates.txt`. Its key starts
  at 0 degrees, so colder water (under sea ice) reads as 0 to 2 degrees.
- Values are read from the colours of NASA's videos and images, so they are relative levels, not
  satellite or model units. The lightning video has no date label and its speed is uneven, so it is
  split into 14 equal parts and no part claims a month or date. The aerosol key has no numbers: each
  aerosol is measured against its own thickest places.
- Sound design model: [Data Sonification: Caldwell 73](https://svs.gsfc.nasa.gov/13786/), NASA Hubble,
  sonification by SYSTEM Sounds (M. Russo, A. Santaguida).
- Land on the globe: [NASA Visible Earth, Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble).
- Sound design and video reading for night lights and carbon dioxide: team RUSTMN (Ulaanbaatar).
- The raw NASA videos are not in the repository; only the maps and images read from them are.
- Instrument samples: FluidR3_GM soundfont (CC BY 3.0) via
  [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts). Sound: [Tone.js](https://tonejs.github.io/).

## Use of AI

NASA Space Apps asks every project to say where AI was used. Hearth was built with help from an AI
coding assistant, Claude Code (Anthropic), working under the rules in `AGENTS.md` and the team's specs:

- **Code written with Claude Code (AI-assisted):** much of the web page (`public/app.js`,
  `public/globe.js`, `public/index.html`, `public/styles.css`), the sound engine in `public/sweep/`
  (the track mappings, the winds, the sea temperature chords and the views: regions and stories), the
  score builder and its validator (`backend/build_sweep.py`, `backend/validate_api.py`) and the
  browser and backend tests.
- **Data processing written with Claude Code (AI-assisted):** the Python pipeline in `backend/eic/`
  that reads NASA's videos and images (colour keys, grids, the aerosol unmixing, the sea temperature
  reading, the night-lights decade and regions). It is ordinary, repeatable code: no AI model runs on
  the data, and running the pipeline again gives the same numbers.
- **Text written with Claude Code (AI-assisted):** much of the spoken text, the legends, "About this
  track" (written from NASA's own pages) and this documentation.
- **Not AI-generated:** the data, images and video (all NASA's), the instrument samples (FluidR3_GM),
  and the sound itself, which the page computes from NASA's data as you listen.

The team chose the challenge, the NASA resources and the sound design, decided what to build, and
reviewed, listened to and tested every change.

Hearth is not an official NASA product.
