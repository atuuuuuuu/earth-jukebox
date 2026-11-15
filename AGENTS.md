# Hearth: rules for AI coding assistants

NASA Space Apps 2026, "The Earth Information Jukebox". NASA Earth Information Center videos become
numbers (the backend), and the numbers become sound live in the browser. The tracks are the
challenge's NASA resources (numbered as on its Resources tab) 1 and 3 (night lights), 6 (air quality),
7 (Perpetual Ocean 2), 8 (carbon dioxide) and 9 (lightning), GEOS Aerosols (SVS 5669) and 2 (sea surface
currents and temperature, SVS 3912). 1, 6 and 7 come first; sea heat is the last track.

## Layout

- `public/` the website: `index.html`, `styles.css`, `app.js` (the page), `globe.js` (the 3D globe, plain WebGL), `bundle.js` (built: Tone.js as `EJ.Tone`, and `EJ.toWav`), `textures/` (NASA Blue Marble), `api/` (scores), `data/` (3 degree grids), `media/` (map images, the CO2 and ocean videos), `samples/`
- `public/sweep/` the sound engine (team RUSTMN): `sonifier.js` wraps `player.js`, `audio.js` and `tracks/night-lights.js` / `tracks/co2.js` / `tracks/ocean.js` / `tracks/lightning.js` / `tracks/aerosols.js`. Air quality uses the night-lights mapping (vibraphone with a sour drone for the `pollutants` chapter). Lightning has its own mapping: muted harp notes per mark, storm wind, contrabass and strings in E flat, stereo following the scan line west to east, and a compare-with-previous-part pass. Aerosols is one noise wind per layer of the map (`winds.js`; the layers, their names, letters and wind colours come from the data), heard all together or one alone ("Listen to"). A score's `views` (backend/API.md) are other ways to hear a track, each window on its own finer grid: NASA's four zoom regions on Earth at night (whose last map, the change map, is heard as the decade: one note per year, on the flat map alone), NASA's six stories on aerosols (radios "Region" / "Mode", key R). Sea heat (`tracks/sea-heat.js`, `chords.js`) is track 7: a level scan line moving north to south (`sweep.scan: "south"`, so west = left ear there), degrees C read from NASA's key, a warm pad synthesised from the measured timbre of NASA's reference pad (`chords.js`, no samples) whose chord grows, and whose soft melody climbs, with the water's temperature
- `backend/eic/` team RUSTMN's pipeline: NASA videos (and the aerosol still) to `public/data/*.json` and `public/media/`. One YAML per track in `backend/eic/tracks/`. `python -m pipeline.validate --track <id>` checks known places and writes heat maps to `backend/eic/debug/` (git-ignored)
- `backend/build_sweep.py` + `backend/sweep.config.json`: grids to `public/api`. `backend/API.md` is the contract, `backend/validate_api.py` enforces it
- `test/run.cjs` the real page by keyboard, with axe. `test/responsive.cjs` every layout from 320 to 1440 px. `backend/tests/` the score builders and the validator (`npm run test:backend`)

## The data contract

- Load data only like this: `fetch("api/tracks.json")`, then `fetch(track.score)`. Never hardcode track ids, map counts, dates or ranges.
- Never edit `public/api/`, `public/data/` or `public/media/` by hand. They are generated: change the config or the builder and rebuild.
- `text` is the spoken description of a map and starts with its `when` ("2013", "Ozone", "Gulf Stream, off the United States", "Week from 21 January 2020", "Part 3 of 14"). Speak it only when the listener asks (D), or announce `when` alone as a map starts.
- `range` is one fixed scale per track. Never rescale per map.
- The globe never shows anything the sound and text do not, and never fakes a value.

## Accessibility rules (the point of the project)

- A blind person must be able to use the page the first time with no one explaining it. Every step says what to press next, in the live region or in visible text.
- Native controls only (`button`, `input type="range"`, radios in a `fieldset`). Sliders carry `aria-valuetext`. One polite `role="status"` region (`#live`) for speech, one `role="alert"` (`#alert`) for errors.
- Single-letter shortcuts work only inside `#player` (WCAG 2.1.4); `#keys` is `role="application"` so NVDA and JAWS pass keys through. Space stays native on buttons; sliders and radios keep their arrow keys. Escape stops everything from anywhere. Every shortcut is also a button.
- Focus moves only when the listener moves it (the skip link goes to `#keys`). Focus rings stay visible. Touch targets are at least 44 px. Respect `prefers-reduced-motion`.
- Keep announcements short. No sound before a key press or click (`Tone.start()` inside the gesture).
- Every key and player button confirms itself: a click (`son.earcon`) and, with "Name each key I press" on, its name before the answer (`run()` in app.js). A key with no job says so. Never leave a key press silent.

## Other rules

- Plain HTML, CSS and JavaScript. No frameworks. No new npm packages without asking.
- One Tone.js only: the sweep engine uses `EJ.Tone`. Dispose the old sonifier before building a new one (`son.dispose()`), or notes double.
- Static files on GitHub Pages: relative paths only.
- Keep the hooks the tests use: ids `keys`, `play`, `prev`, `next`, `map`, `where`, `describe`, `help`, `live`, `alert`, `demos`, `places`, `lon`, `lat`, `volume`, `mono`, `continuous` (Continuous sound: on note tracks only, `son.hasNotes`), `keyecho`, `clicks`, `vibrate`, `save`, `compare`, `listen-field` (radios `listen-all` and `listen-<layer id>`, name `listen`), `view-field` (radios `view-whole` and `view-<option id>`, name `view`), `story-list` (buttons `story-<n>` in `story-buttons`, `aria-pressed` on the story heard), `view-map` (the flat map of the windows), `about-sound` (About this track), `csv` (the numbers as a file), `readout` (the last note), `mystery` (Mystery place: `mystery-play`, `mystery-guess`, `mystery-result`), `guide` and `guide-start` (Guide me), `show` (the whole jukebox), and `window.ready`, `window.son` (with `son.layers`, `son.solo`, `son.viewOptions`, `son.view`, `son.frames`, `son.boxOf`), `window.globe`, `window.lastProbe`, `window.framesSeen`, global `EJ`. If you change one, update `test/run.cjs` in the same change.

## Check before saying done

- `npm run api` and `npm run validate` (prints `API OK`)
- `npm test` ends with `all checks passed` (Playwright; ask before installing it)
- `npm run test:responsive` prints `all widths ok`
- `npm run test:backend` ends with `OK`
- By hand with a screen reader: Tab, Enter on the skip link, Space, W, D

## Stop and ask before

Deleting files, adding dependencies, changing `backend/API.md`, committing, or pushing to GitHub.
