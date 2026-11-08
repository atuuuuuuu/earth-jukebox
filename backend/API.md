# Earth Jukebox API

The backend publishes plain JSON files next to the website. The frontend reads
them with `fetch()`. There is no server and no database, so nothing can go down
during the demo, and the site works on GitHub Pages or Netlify.

All paths below are relative to the site root (the `public/` folder).

| File | What it holds |
| --- | --- |
| `api/tracks.json` | The list of tracks the jukebox shows |
| `api/scores/<track id>.json` | One track's score: every number the music plays |
| `frames/<track id>/0001.jpg` | The map image for each frame, 1024 × 512 |

## Loading a track

```js
const index = await (await fetch("api/tracks.json")).json();
const track = index.tracks[0];                     // or the one the listener picked
const score = await (await fetch(track.score)).json();
const sonifier = new EJ.Sonifier(score, { mapping: "scan" });
```

The score works with `src/engine.js` as it is. The fields marked *new* below
are extra, and the engine ignores them until the Audio role uses them.

## `api/tracks.json`

```json
{
  "api": 1,
  "generated": "2026-11-14",
  "sample": false,
  "tracks": [
    {
      "id": "a1-ocean-fever",
      "code": "A1",
      "title": "Ocean Fever",
      "subtitle": "Sea surface temperature",
      "description": "The whole ocean, about one frame a month ...",
      "score": "api/scores/a1-ocean-fever.json",
      "frames": 30,
      "firstDate": "2024-05-16",
      "lastDate": "2026-11-12",
      "units": "degrees C",
      "source": { "title": "...", "url": "https://svs.gsfc.nasa.gov/5176", "credit": "..." }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `sample` | `true` while the files come from synthetic test maps. Show a "sample data" note when it is true |
| `code` | Short name to say aloud and show on the button, like a real jukebox |
| `score` | Path of the score file, ready for `fetch()` |
| `source` | Where the data comes from. Show the credit and link on the page |

## `api/scores/<track id>.json`

| Field | Meaning |
| --- | --- |
| `units` | Unit of every value, such as `"degrees C"` |
| `range` | `[low, high]` of the colour bar. Fixed for the whole track: never rescale per frame |
| `hotLine` | Values at or above this count as hot |
| `ninoLine` | *new.* El Niño line: 0.5 degrees C, NOAA's threshold. It applies to `nino34Relative` |
| `leftLon` | *new.* Longitude at the map's left edge: -180 for a standard map, 0 for one centred on the Pacific |
| `tuning` | Sound settings for this track, read by the engine |
| `frames` | The frames, in the order they play |

Each frame:

| Field | Meaning |
| --- | --- |
| `date` | `YYYY-MM-DD` |
| `image` | Path of the map image |
| `mean` | Area-weighted average of the whole map; `null` if the frame has no data |
| `spread` | How uneven the map is (area-weighted standard deviation) |
| `hot` | Share of the mapped area at or above `hotLine`, 0 to 1 |
| `clusters` | Number of separate hot patches |
| `columns` | 16 values, west to east from `leftLon`, for the Scan. `null` = land or no data: stay silent |
| `grid` | 18 rows (north first) of 36 cells (west first), 10 degrees each, for the listening cursor |
| `nino34` | *new.* Average anomaly of the Niño 3.4 box (5S to 5N, 170W to 120W), as the map shows it |
| `tropics` | *new.* Average anomaly of the whole tropical ocean, 20S to 20N |
| `nino34Relative` | *new.* `nino34` minus `tropics`, the way NOAA judges El Niño. **Ring the bell when it is above `ninoLine`** |
| `valid` | *new.* Share of the Earth's area with data. About 0.6 to 0.7 for an ocean map |
| `label` | *new, then-vs-now tracks only.* The year, like `"2025"`. Frames come in pairs: then, now |
| `text` | The spoken description, built from the same numbers. Put it in the live region on request |

Cell longitude for the listening cursor: `leftLon + (col + 0.5) * 10`, wrapped
to -180..180. Strip longitude for the Scan: `leftLon + (strip + 0.5) * 22.5`.

## Promises the backend keeps

`python3 backend/validate_api.py public` checks all of these before every deploy:

- every file named in `tracks.json` exists, and every frame's image exists
- `columns` always has 16 entries and `grid` always 18 × 36
- every value is a number inside `range`, or `null`
- frames are in date order, except then-vs-now tracks, which alternate years
- every `text` starts with its frame's date
- `nino34Relative` always equals `nino34` minus `tropics`
- each score stays under 2 MB
