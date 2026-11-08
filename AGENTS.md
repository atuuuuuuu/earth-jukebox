# Earth Jukebox: rules for AI coding assistants

NASA Space Apps 2026, "The Earth Information Jukebox". NASA map frames become
numbers (the backend, finished), and the numbers become music live in the
browser (the frontend, which you are building).

## Layout

- `public/` the website: `index.html`, `bundle.js` (built), `api/`, `frames/`
- `src/engine.js` the Tone.js sonifier. `npm run build` bundles it into `public/bundle.js` as the global `EJ`
- `backend/` Python that builds `public/api` and `public/frames`. `backend/API.md` is the contract
- `test/run.cjs` browser test: keyboard play, audio level, accessibility (axe)

## The backend contract

Read `backend/API.md` before writing any code that touches data.

- Load data only like this: `fetch("api/tracks.json")`, then `fetch(track.score)` for the chosen track. Never hardcode track ids, frame counts, dates or ranges.
- NEVER edit `backend/`, `public/api/` or `public/frames/`. They are generated. If the frontend needs a field that does not exist, stop and ask: the backend owner adds it.
- Use the fields like this:

| Field | Use |
| --- | --- |
| `columns` (16 values, west to east) | The Scan melody. `null` = land: stay silent |
| `grid` (18 rows x 36 cells) | The listening cursor |
| `mean`, `spread`, `clusters`, `hot` | The Planet Chord and the calm/tense scale |
| `nino34Relative` above `ninoLine` | Ring the El Niño bell. Use `nino34Relative`, NEVER `nino34` |
| `label` (`"2025"` / `"2026"`) | Then-vs-now pairs on the El Niño track |
| `text` | The spoken description. Speak it only when the listener asks |
| `image` | The map frame for that moment |
| `range` | One fixed scale for the whole track. NEVER rescale per frame |
| `leftLon` | Longitudes: strip k is at `leftLon + (k + 0.5) * 22.5`, grid cell c at `leftLon + (c + 0.5) * 10` |
| `sample`, `source` (in `tracks.json`) | Show a "sample data" note when `sample` is true. Always show the source credit and link |

## Rules

- Plain HTML, CSS and JavaScript. No frameworks. No new npm packages without asking.
- Audio starts only from a click or key press (`Tone.start()`), never on page load.
- One Tone transport. Before building a new `Sonifier` (new track, Strict mode), stop and clear the old one: `Tone.getTransport().stop()`, `Tone.getTransport().cancel()`, dispose its nodes. Otherwise every note plays twice.
- Accessibility is the point of the project: native controls (`button`, `input type="range"`, `fieldset` + `legend`), everything works with the keyboard alone, sliders carry `aria-valuetext`, one `role="status"` live region that speaks only when asked, visible focus, touch targets at least 44 px, works at 375 px wide.
- The site must run as static files on GitHub Pages: relative paths only.
- Keep the hooks the browser test uses: ids `play`, `describe`, `live`, `time`, `lon`, `lat`, and `window.ready`, `window.framesSeen`, `window.lastProbe`, global `EJ`. If you must change one, update `test/run.cjs` in the same change.

## Check before saying done

- `npm run build` succeeds
- `npm run validate` prints `API OK`
- `npm test` shows 0 axe violations and 0 page errors (needs Playwright; ask before installing it)
- By hand: Tab to Play, press Space, music plays; Describe speaks the frame's `text`

## Stop and ask before

Deleting files, adding dependencies, editing `backend/` or `public/api/`, changing `backend/API.md`, or pushing to GitHub.
