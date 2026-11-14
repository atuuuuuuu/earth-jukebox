# Earth Jukebox API

The backend publishes plain JSON files next to the website, and the page reads them with `fetch()`.
There is no server and no database, so nothing can go down during the demo, and the site works on
GitHub Pages. All paths are relative to `public/`.

| File | What it holds |
| --- | --- |
| `api/tracks.json` | The list of tracks the jukebox shows |
| `api/scores/<track id>.json` | One track's score: every number the page shows and says |
| `data/<name>.json` | The fine grid the sound engine plays (3 degree cells, or one line per step for carbon dioxide) |
| `media/<name>/...` | Map images (and NASA's carbon dioxide video) |

Built in two stages:

1. `backend/eic/` (`npm run eic -- <track>`, needs the NASA video, numpy, OpenCV, PyYAML) reads a
   NASA video into `data/<name>.json` and `media/<name>/`.
2. `backend/build_sweep.py backend/sweep.config.json` (`npm run api`, standard library, plus ffmpeg
   once to take stills from a video) writes `api/`.

## Loading a track

```js
const index = await (await fetch("api/tracks.json")).json();
const score = await (await fetch(index.tracks[0].score)).json();
const son = await (await import("./sweep/sonifier.js")).createSweep(score, { onFrame, onEnd });
```

## `api/tracks.json`

`{"api": 1, "generated": "...", "sample": false, "tracks": [...]}`. Each track:

| Field | Meaning |
| --- | --- |
| `id`, `code`, `title`, `subtitle`, `description` | Names; `description` is read by screen readers with the track's radio button |
| `score` | Path of the score |
| `frames` | Number of maps |
| `firstDate`, `lastDate` | `YYYY-MM-DD`, or `null` for tracks with no single date per map (lightning months) |
| `when` | The span, spoken: `"2012 to 2023"`, `"January to December"` |
| `units` | What the values mean, like `"share of the brightest light"` |
| `engine` | `"sweep"` |
| `source` | `title`, `url`, `credit`: show them on the page |

## `api/scores/<track id>.json`

| Field | Meaning |
| --- | --- |
| `units`, `range` | `range` is fixed for the whole track: never rescale per map. `[0, 1]`, or `[-1, 1]` for the change map |
| `hotLine` | Values at or above this count as "high" in `hot` |
| `leftLon` | Longitude at the left edge of every map: -180 |
| `words` | How the page talks about the track: `map`, `what` ("light"), `top` ("brightest"), `missing` (said for a square with no reading), `dates` |
| `sweep` | `src` (the fine grid in `data/`), `chapter` (`years`, `change`, `weeks`, `parts`), `mapping` (`night-lights`, `co2` or `lightning`), `instrument` for the ringing notes (`vibraphone`, `harp`) |
| `legend` | `summary`, `method`, `items` (`sound`, `meaning`), `caveat`: "What the sounds mean" |
| `places` | `{"row,col": "Tokyo"}`: a listed city inside that 10 degree square. Only used to name a spot in speech |
| `frames` | The maps, in playing order |

Each frame:

| Field | Meaning |
| --- | --- |
| `when` | The map's name, spoken: `"2013"`, `"Change from 2012 to 2023"`, `"Week from 21 January 2020"`, `"July"` |
| `date` | `YYYY-MM-DD`, or `null` when `when` names something with no single date (a month across years) |
| `image`, `alt` | The map image and its description |
| `text` | The spoken description. Starts with `when`. Built from the same numbers |
| `grid` | 18 rows (north first) of 36 cells (west first), 10 degrees each. `null` = no reading there (beyond the sensor, ice, or not crossed by carbon dioxide's line that week) |
| `columns` | 16 west-to-east strips of 22.5 degrees |
| `mean`, `spread`, `hot`, `clusters`, `valid` | Area-weighted average, spread, share of the map read at or above `hotLine`, number of separate high patches, share of the Earth with a reading |
| `relativeTotal` | Total compared with the first map (night lights) or the busiest map (carbon dioxide, lightning) |

Cell longitude: `leftLon + (col + 0.5) * 10`; latitude: `90 - (row + 0.5) * 10`.

## Promises the backend keeps

`python3 backend/validate_api.py public` checks before every deploy:

- every file named in `tracks.json` exists, and every map image exists
- `grid` is always 18 × 36 and `columns` 16, every value a number inside `range` or `null`
- every `text` starts with its map's `when` (or date)
- dated maps are in date order
- `sweep.src` exists, its chapter has as many maps with the same images, and its arrays are full size
- each score stays under 2 MB
