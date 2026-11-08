# Earth Jukebox

NASA Space Apps 2026, the Earth Information Jukebox challenge. NASA EIC map
frames become numbers (backend), and the numbers become music, live in the
browser (frontend).

```
backend/   Python: NASA frames -> static JSON API     (see backend/README.md, backend/API.md)
public/    the website: index.html, api/, frames/
src/       engine.js: Tone.js sonifier (Scan, Planet Chord, Strict mode)
test/      browser test: keyboard, audio, accessibility
scripts/   roughness.py: checks the chord ladder
```

## Run it

You need Node 20+, Python 3.10+ and ffmpeg.

```bash
npm install
pip install numpy scipy opencv-python-headless

npm run test:backend   # 14 backend tests
npm run sample         # sample API from synthetic maps (already in public/api)
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
