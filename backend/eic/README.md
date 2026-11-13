# backend/eic: NASA Earth Information Center videos to 3-degree grids

Team RUSTMN's pipeline, merged from their repository. It reads a NASA EIC video and writes,
into the website:

- `public/data/<id>.json`: a 3° grid per map (120 × 60 cells), plus the track's sound legend
- `public/media/<id>/*.webp`: the maps, 2048 × 1024, equirectangular, 180° W at the left edge

`backend/build_sweep.py` then turns the grid into API scores (`npm run sweep`).

```bash
pip install -r backend/eic/pipeline/requirements.txt
export EJ_RESOURCES=/path/to/EarthJukebox_NASA_resources   # default: data/eic in the repo
npm run eic                                                 # = cd backend/eic && python3 -m pipeline.run --track 01_night_lights
cd backend/eic && python3 -m pipeline.validate --track 01   # checks known places, heatmaps in backend/eic/debug/
```

Each track is configured in `tracks/<id>.yaml`: source video, geometry calibration, masks,
colour key, grid, playback timing and the screen-reader sound legend.

`06_co2_dyamond.yaml` and its builder are kept but not in the jukebox yet: that video is a
turning globe seen by a camera, not a world map, so it cannot be draped on the 3D globe
without more work. `pipeline.fetch_samples` downloads the instrument samples into
`public/samples/` (vibraphone and cello are already there).
