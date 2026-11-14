# Earth Jukebox backend

The backend turns NASA Earth Information Center videos into numbers and publishes them as a small
API the website reads. It has no server and no database: Python programs you run on a laptop write
plain JSON files that are hosted with the website.

```
NASA video ──backend/eic (OpenCV)──> public/data/*.json ──build_sweep.py──> public/api/*.json ──fetch()──> the page
              3-degree grid per map     + public/media/*      10-degree scores, statistics, spoken text
```

`API.md` is the contract with the page: every file and field it can rely on.

## The parts

| File | What it does |
| --- | --- |
| `eic/` | Team RUSTMN's pipeline: one YAML and one builder per track, video to 3-degree grids and map images (see `eic/README.md`) |
| `build_sweep.py` + `sweep.config.json` | Grids to scores: 10-degree squares, statistics, and the spoken description of every map, naming nearby cities |
| `validate_api.py` | Checks every API file against `API.md`. GitHub runs it before every deploy |
| `tests/` | Known answers in, the same answers out: the score builder, the validator, the lightning correction |

## Set up once

Python 3.10 or newer (on Windows, type `py` where these notes say `python3`):

```bash
pip install -r backend/eic/pipeline/requirements.txt
python3 -m unittest discover backend/tests -v      # all should say ok
```

## Rebuild

The processed data is in the repository, so the site runs without any of this. To rebuild a track,
download its video (each `eic/tracks/*.yaml` names the file and the NASA page), then:

```bash
export EJ_RESOURCES=/path/to/videos                  # default: data/eic in the repository
cd backend/eic && python3 -m pipeline.run --track 07_lightning && cd ../..
python3 backend/build_sweep.py backend/sweep.config.json
python3 backend/validate_api.py public               # "API OK"
```

| Track | NASA video (SVS page) |
| --- | --- |
| `01_night_lights` | `nightlights_flat_series_and_change_wZooms_13_EIC_2160p30_h265.mp4` ([5313](https://svs.gsfc.nasa.gov/5313/)) |
| `06_air_quality` | `EIC_AirQuality_Preview_3840x1080.mp4` ([5533](https://svs.gsfc.nasa.gov/5533/)) |
| `07_ocean_currents` | `perpetual_ocean2_CLOSE_093_clean_noDate_1080p30.mp4` ([5425](https://svs.gsfc.nasa.gov/5425/)) |
| `06_co2_dyamond` | `dyamondPointCloud_12-1-2023b_dyamond_co2_anim_globe_orbit_1080p30_h265.mp4` ([5196](https://svs.gsfc.nasa.gov/5196/)) |
| `07_lightning` | `iss_lightning_sos_yearly_07312023_2048p60.mp4`, the flat Science On a Sphere version ([5011](https://svs.gsfc.nasa.gov/5011/)); the turning-globe `iss_lightning_sphere_*.mp4` cannot be read this way |

## Explaining it to the judges

**How does a video become data?** Each track reads NASA's own frames. Night lights: the 8K EIC
video, calibrated against 10 known cities, with the lights separated from the base map. Carbon
dioxide: a thin line through the centre of NASA's turning globe, read every 3 hours of model time.
Air quality: four pollutants in strips that slide over one flat map; each strip is found in every
frame and its colours rebuilt into a whole world map per pollutant. Ocean: a line through the middle
of NASA's moving camera view, ten readings per second of video. Lightning: the flat world-map movie, where yellow dots are strikes; we average them over 14 equal
parts of the record, in order.

**Why is lightning corrected?** The space station's orbit is tilted 51.6 degrees, so it turns round
near 50 degrees north and south and passes over those latitudes about four times as often as over
the equator. NASA's movie shows every strike the sensor saw, so storms there look bigger than they
are. We divide by how long the sensor looks at each latitude (`iss_view_weight`, tested against the
orbit formula), for the sound, the words and the picture alike.

**Why weight by latitude?** On a flat world map every pixel is the same size, but near the poles a
pixel covers much less of the Earth, so each one counts by cos(latitude).

**Why no database?** The data does not change while people listen, so a server would add something
that can break and give listeners nothing. Static files are fast, free to host, and cannot go down
during judging.

**What are the limits?** Values come from the colours of NASA's videos, so they are relative levels,
not satellite units. The lightning movie has no dates, so its parts are equal stretches of the movie,
not calendar months.

## Before you submit

Declare AI help on your project page and say what actually happened, for example: "Parts of our
code were written with an AI assistant. We reviewed, tested and adapted it, and ran every step on
NASA's data ourselves."
