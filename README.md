# Earth Jukebox

NASA Space Apps 2026, the Earth Information Jukebox challenge. NASA EIC map
frames become numbers (backend), and the numbers become music, live in the
browser (frontend).

## What it does

- **A 3D globe painted with the real NASA map.** Every moment's sea surface temperature frame is wrapped onto a WebGL globe, with NASA Blue Marble showing the land. It spins, you drag it, and it crossfades from month to month.
- **The globe shows the music.** The strip being played lights up as it sweeps west to east, the Niño 3.4 box glows when the El Niño bell rings, and the listening cursor is a yellow square.
- **Tap the ocean to hear it.** Tapping the globe plays that 10 degree square and says its real temperature anomaly from the data grid. Moving the cursor sliders turns the globe to the spot.
- **Hear the change.** Pick two moments and hear A, then B. Below it, a plain-language list of what changed and how it changes the sound, all computed from the score.
- **Inside the signal.** Live readout of the strip, value, note, loudness, scale (calm or darker), Niño 3.4 and the Planet Chord rung.
- **The melody bars and a live waveform**, a timeline chart of the map average and Niño 3.4, a visible key built from the data, and Read aloud for listeners without a screen reader.
- **Still accessibility first.** Native controls, keyboard only, one live region that speaks only when asked, reduced-motion support, a flat-map fallback without WebGL, 375 px wide.
- **No framework, no new packages.** The globe is about 350 lines of plain WebGL.

```
AGENTS.md  rules for AI coding assistants (CLAUDE.md points to it)
backend/   Python: NASA frames -> static JSON API     (see backend/README.md, backend/API.md)
public/    the website: index.html, styles.css, app.js, globe.js, textures/, api/, frames/
src/       engine.js: Tone.js sonifier (Scan, Planet Chord, Strict mode, A-then-B sequences)
test/      browser test: keyboard, audio, accessibility
scripts/   roughness.py: checks the chord ladder
```

## Run it

You need Node 20+, Python 3.10+ and ffmpeg.

```bash
npm install
pip install numpy scipy opencv-python-headless

npm run test:backend   # 16 backend tests
npm run sample         # sample API from synthetic maps (replaces the real API in public/api)
npm run validate       # check the API against backend/API.md
npm run build          # bundle the engine into public/bundle.js
npm run serve          # then open http://localhost:8000
```

Press Tab until Play has focus, then press Space.

For real NASA data, follow "On the day" in `backend/README.md`, then
`npm run api && npm run validate`.

## Optional browser test

```bash
npm i -D playwright && npx playwright install chromium
npm test
```

The test also taps the globe and runs Hear the change. Chromium gets WebGL in headless mode through SwiftShader.

## Save a track as WAV

In the browser console on the running page:

```js
const index = await (await fetch("api/tracks.json")).json();
const score = await (await fetch(index.tracks[0].score)).json();
const wav = EJ.toWav(await EJ.renderOffline(score, { mapping: "scan" }, 90));
const a = document.createElement("a");
a.href = URL.createObjectURL(wav);
a.download = `${index.tracks[0].id}.wav`;
a.click();
```

Check the 2026 Space Apps rules on when project code may start, and declare AI
assistance on the project page.
