# Earth Jukebox API

The backend publishes plain JSON files next to the website, and the page reads them with `fetch()`.
There is no server and no database, so nothing can go down during the demo, and the site works on
GitHub Pages. All paths are relative to `public/`.

| File | What it holds |
| --- | --- |
| `api/tracks.json` | The list of tracks the jukebox shows |
| `api/scores/<track id>.json` | One track's score: every number the page shows and says |
| `data/<name>.json` | The fine grid the sound engine plays (3 degree cells, or one line per step for carbon dioxide and the ocean); a track with layers also holds one such grid per layer in each map, under `layers` |
| `media/<name>/...` | Map images (and NASA's carbon dioxide and ocean videos) |

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
| `firstDate`, `lastDate` | `YYYY-MM-DD`, or `null` for tracks with no single date per map (air quality, ocean scenes, lightning parts) |
| `when` | The span, spoken: `"2012 to 2023"`, `"Part 1 of 14 to Part 14 of 14"` |
| `units` | What the values mean, like `"share of the brightest light"` |
| `engine` | `"sweep"` |
| `source` | `title`, `url`, `credit`: show them on the page |

## `api/scores/<track id>.json`

| Field | Meaning |
| --- | --- |
| `units`, `range` | `range` is fixed for the whole track: never rescale per map. `[0, 1]`, or `[-1, 1]` for the change map, or real units where NASA's key has numbers (`[0, 32]`, degrees Celsius, for sea surface temperature) |
| `hotLine` | Values at or above this count as "high" in `hot` |
| `leftLon` | Longitude at the left edge of every map: -180 |
| `words` | How the page talks about the track: `map`, `what` ("light"), `top` ("brightest"), `missing` (said for a square with no reading), `dates` |
| `sweep` | `src` (the fine grid in `data/`), `chapter` (`years`, `change`, `pollutants`, `scenes`, `weeks`, `parts`, `still` for one map, or `sweeps` for equal sections of one movie), `mapping` (`night-lights`, `co2`, `ocean`, `lightning`, `aerosols` or `sea-heat`), `instrument` for the ringing notes (`vibraphone`, `harp`, `kalimba`) or the chords (`pad`), `scan` (optional: `"east"`, the default, a north-south line moving west to east; or `"south"`, a west-east line moving north to south, with west in the left ear and east in the right) |
| `layers` | Optional. Separate things drawn on one map, each heard and chosen on its own (aerosols: black carbon, dust, sea salt, sulfate), in the order the page lists them: `id`, `name` (spoken), `key` (its one-letter shortcut in the player), `image` (the map with only this layer; optional), `colour` (its swatch on NASA's key, `#rrggbb`; optional). Tracks without it are unchanged |
| `views` | Optional. Other ways to hear the same track, chosen with radios beside "Whole map" (see below). Tracks without it are unchanged |
| `legend` | `summary`, `method`, `items` (`sound`, `meaning`), `caveat`: "What the sounds mean" |
| `places` | `{"row,col": "Tokyo"}`: a listed city inside that 10 degree square. Only used to name a spot in speech |
| `frames` | The maps, in playing order |

Each frame:

| Field | Meaning |
| --- | --- |
| `when` | The map's name, spoken: `"2013"`, `"Change from 2012 to 2023"`, `"Ozone"`, `"Gulf Stream, off the United States"`, `"Week from 21 January 2020"`, `"Part 3 of 14"` |
| `date` | `YYYY-MM-DD`, or `null` when `when` names something with no single date (a part of the lightning video) |
| `image`, `alt` | The map image and its description |
| `text` | The spoken description. Starts with `when`. Built from the same numbers |
| `grid` | 18 rows (north first) of 36 cells (west first), 10 degrees each. `null` = no reading there (beyond the sensor, ice, not crossed by carbon dioxide's line that week; every cell for ocean scenes, which follow a moving camera and have no map) |
| `mean`, `spread`, `hot`, `clusters`, `valid` | Area-weighted average, spread, share of the map read at or above `hotLine`, number of separate high patches, share of the Earth with a reading |
| `relativeTotal` | Total compared with the first map (night lights) or the busiest map (carbon dioxide, lightning) |
| `layers` | Only when the score has `layers`: `{"<layer id>": grid}`, each 18 × 36 like `grid` and inside `range`. `grid` is then the strongest layer in each cell |

Cell longitude: `leftLon + (col + 0.5) * 10`; latitude: `90 - (row + 0.5) * 10`.

### `views`: regions and stories

`{"legend": "Region", "key": "R", "options": [...]}`. `legend` names the choice (the radio group's
legend; the first radio is always "Whole map"); `key` (optional) is the letter that moves to the next
option in the player. Each option replaces the track's list of maps while it is chosen:

| Field | Meaning |
| --- | --- |
| `id`, `name` | The option, like `"india"`, `"India"`, or `"stories"`, `"NASA's stories"` |
| `unit` | What one of its maps is called when spoken: `"map"` or `"story"` |
| `frames` | Its maps, in playing order: `when` (spoken name), `text` (starts with `when`), `box` (`[west, south, east, north]`, the window the scan line crosses), `base` (index of the track's own map it is read from, for the picture and Explore one place), `focus` (optional: the layer brought forward), `view` and `frame` (where its fine grid is in the sweep data's `views.items`) |

NASA's zoom regions on night lights (`legend` "Region") have one map per map of the track, inside the
region. NASA's stories on the aerosol map (`legend` "Mode") are one option whose maps are the stories.

## Promises the backend keeps

`python3 backend/validate_api.py public` checks before every deploy:

- every file named in `tracks.json` exists, and every map image exists
- `grid` is always 18 × 36, every value a number inside `range` or `null`
- every `text` starts with its map's `when` (or date)
- dated maps are in date order
- `sweep.src` exists, its chapter has as many maps with the same images, and its arrays are full size
- each score stays under 2 MB
- with `layers`: every map has a grid for every layer; ids and keys are unique; keys are single letters the
  player doesn't already use; every layer image exists; the sweep data has a full-size array per layer
- `sweep.scan`, when given, is `"east"` or `"south"`
- with `views`: option ids are unique; the key is a letter neither the player nor a layer uses; every
  map's text starts with its `when`, its box is a real window, its `base` is one of the track's maps, its
  `focus` is a layer; the sweep data holds that view's map with full-size arrays and the same box
