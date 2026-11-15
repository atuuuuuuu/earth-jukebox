# backend/eic: NASA Earth Information Center videos to 3-degree grids

Team RUSTMN's pipeline, merged from their repository. It reads a NASA EIC video and writes,
into the website:

- `public/data/<id>.json`: a 3° grid per map (120 × 60 cells), plus the track's sound legend
- `public/media/<id>/*`: the maps (2048 × 1024, equirectangular, 180° W at the left edge), or for
  carbon dioxide and the ocean NASA's own video and its stills

`backend/build_sweep.py` then turns the grids into API scores (`npm run api`).

```bash
pip install -r backend/eic/pipeline/requirements.txt
export EJ_RESOURCES=/path/to/EarthJukebox_NASA_resources   # default: data/eic in the repo
npm run eic -- 07_lightning                                 # = cd backend/eic && python3 -m pipeline.run --track 07_lightning
cd backend/eic && python3 -m pipeline.validate --track 01   # checks known places (night lights), heatmaps in backend/eic/debug/
```

Each track is configured in `tracks/<id>.yaml`: source video, geometry calibration, masks,
colour key, grid, playback timing and the screen-reader sound legend. The tracks are
`01_night_lights`, `06_air_quality` (four pollutant strips rebuilt into one world map each),
`07_ocean_map` and `06_co2_map` (one world map each: NASA's flat ECCO2 film, and NASA's turning
globe flattened; `pipeline/tracks/globe_map.py`), `07_ocean_lesson` (the guided Gulf Stream lesson),
`08_atmospheric_river` (played against NASA's own video, with NASA's clock) and `07_lightning`
(corrected for how often the space station looks at each latitude).
`pipeline.fetch_samples` downloads the instrument samples into `public/samples/`.
