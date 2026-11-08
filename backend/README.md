# Earth Jukebox backend

The backend turns NASA map images into numbers and publishes them as a small
API the frontend reads. It has no server and no database. It is a Python
program you run once on your laptop, and it writes plain JSON files that are
hosted with the website.

```
NASA video ──ffmpeg──> frames ──build_api.py──> public/api/*.json ──fetch()──> the jukebox
                                    │
                    reads each pixel's colour off the colour bar
```

`API.md` is the contract with the frontend: every file and field it can rely on.

## The parts

| File | What it does |
| --- | --- |
| `analyze.py` | The science: finds the colour bar, turns colours into numbers, works out averages, the Niño 3.4 box and the spoken text |
| `build_api.py` | The program you run: reads the config, chooses frames, writes the API files and the web images |
| `tracks.config.json` | Settings for the real NASA data: where the files are, the dates, the tracks |
| `sample.config.json` | The same settings for the synthetic sample data |
| `validate_api.py` | Checks every API file against `API.md`. Run it before every deploy |
| `inspect_frame.py` | Checks one frame by eye (the Gate 1 test) |
| `make_fixture.py` | Makes synthetic maps with known answers, for tests and the sample API |
| `tests/test_backend.py` | 14 tests: known answers in, the same answers must come out |

## Set up once

You need Python 3.10 or newer and ffmpeg. Check them:

```bash
python3 --version
ffmpeg -version
```

On Windows, type `py` where these notes say `python3`. Install the libraries:

```bash
pip install numpy scipy opencv-python-headless
```

Then run the tests from the project folder. All 14 should say `ok`:

```bash
python3 -m unittest discover backend/tests -v
```

## Try it now with sample data

```bash
python3 backend/make_fixture.py data/sample              # fake NASA-style maps
python3 backend/build_api.py backend/sample.config.json  # writes public/api
python3 backend/validate_api.py public                   # "API OK"
```

The sample API is already in `public/api`, so your frontend pair can start
building against it now. `tracks.json` says `"sample": true` until you build
from real data.

## On the day: real NASA data

**1. Download** from [SVS 5176](https://svs.gsfc.nasa.gov/5176) into `data/sst/`:
the no-datestamp MP4, the dated MP4, and the colour bar image (save it as
`data/sst/colorbar.jpg`). Check the Resources tab first: if NASA lists a
different visualization, use that one instead (see "A different dataset" below).

**2. Extract every frame** from the no-datestamp video. Nearest-neighbour
scaling keeps NASA's exact colours:

```bash
mkdir -p data/sst/daily
ffmpeg -i data/sst/sst_nodates.mp4 -vf scale=1440:720:flags=neighbor -q:v 2 data/sst/daily/%04d.jpg
```

**3. Read the dates.** Save the first and last frames of the *dated* video, open
them, and read the date printed on each:

```bash
ffmpeg -i data/sst/sst_dated.mp4 -frames:v 1 data/sst/first.png
ffmpeg -sseof -0.2 -i data/sst/sst_dated.mp4 -update 1 data/sst/last.png
```

Put the two dates in `tracks.config.json` as `firstDate` and `lastDate`.

**4. Gate 1: check one frame by eye.**

```bash
python3 backend/inspect_frame.py data/sst/daily/0001.jpg data/sst/colorbar.jpg --range -4 4
```

Open `check_colorbar.png`: the green box must sit on the bar. Open
`check_frame.png`: land should be shaded purple, and each marked number should
match its spot's colour on the colour bar. "Mapped area" should be about 60–70%
for an ocean map.

**5. Build and check.**

```bash
python3 backend/build_api.py backend/tracks.config.json
python3 backend/validate_api.py public
```

The build prints how many days lie between frames. If it says "exactly one per
day: yes", the dates are exact.

**6. Check against NOAA.** NOAA put Niño 3.4 at +2.1 °C in its 8 Oct 2026
discussion. Your October values should land roughly near that. Expect rough
agreement only: NASA's daily data and NOAA's index use different baselines.

**7. Hand over.** Commit `public/api` and `public/frames`. The frontend needs
nothing else.

## If something goes wrong

| Message or sign | Fix |
| --- | --- |
| `No colour bar found` | Crop to the bar: `"colorbarCrop": [x0, y0, x1, y1]` in the source settings (pixel corners from any image viewer) |
| `set firstDate and lastDate` | Step 3 above |
| Mapped area far above 70%, or land shows numbers | Land matches a bar colour. Add its colour as `"landColors": [[B, G, R]]` (note the order: blue, green, red) |
| Mapped area far below 60% | Video compression moved the colours. Raise `"maxDist"` from 14 to 20 |
| A burned-in date or logo is read as data | Cut it off with `"frameCrop": [x0, y0, x1, y1]` |
| Map centred on the Pacific | Set `"leftLon": 0` (or whatever longitude sits at the left edge) |

## A different dataset

Any NASA visualization works if it is a flat world map with a colour bar that
has numbers on it. Add a new entry under `"sources"` with its frames, dates,
colour bar and `range`, then a track that uses it. The frontend needs no change:
the new track appears in `tracks.json`.

## Explaining it to the judges

**How does a picture become data?** Every colour on the map stands for a number
on the colour bar. For each pixel we find the nearest bar colour, measured the
way eyes see colour (CIE Lab), and read its number. Pixels that match no bar
colour, like land and labels, become "no data" and stay silent.

**Why weight by latitude?** On a flat world map every pixel is the same size, but
near the poles a pixel covers much less of the Earth. At 60° it covers half as
much as at the equator, so each pixel counts by cos(latitude).

**What is the Niño 3.4 bell?** The average of the ocean box from 5°S to 5°N and
170°W to 120°W. Above +0.5 °C is the line NOAA uses for El Niño conditions. It is
the one sound with a scientific threshold rather than a chosen one.

**How do you know it is right?** The tests build fake maps where we know every
true number. The decoder recovers the map average to within 0.01 °C after JPEG
compression. On real data we check three spots by eye, check that the ocean
covers about the right share of the Earth, and compare Niño 3.4 with NOAA.

**Why no database?** The data does not change while people listen, so a server
would add something that can break and give listeners nothing. The API is
static files: fast, free to host, and it cannot go down during judging.

**What are the limits?** A colour map can only be read as finely as its colours
differ. If the bar has a flat white middle, every value inside it reads as its
midpoint (on the sample bar, that is −0.24 to +0.24 °C). Video compression adds
small errors. The data covers about 2.5 years: enough to show El Niño, too short
to show the long-term warming trend.

## Before you submit

Check the 2026 Project Submission guide (out 13 Nov) on code written before the
event, and declare AI help on your project page. Say what actually happened,
for example: "Parts of our code were written with an AI assistant (Claude). We
reviewed, tested and adapted it, and ran every step on NASA's data ourselves."
