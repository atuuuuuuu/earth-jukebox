# Track 07 Lightning v2: "Orchestral storms" (spec, agreed 14 Nov 2026)

Rework of the lightning SOUND only. Data pipeline, grid and API contract stay as they are.
AGENTS.md rules still apply (no new npm packages, never hand-edit public/api|data|media,
keep test hooks, ask before deleting files / changing backend/API.md / committing / pushing).

## Data (keep)
- NASA SVS 5011, 2D Science On a Sphere map: `iss_lightning_sos_yearly_07312023_2048p60.mp4`
  (4096x2048 equirectangular, 180W at left). Better than the 3D globe videos: same strikes, but the
  whole sensor range (~55N-55S) is visible every frame and pixels map straight to lat/lon.
- On this laptop it is in `C:\Users\Dell\Desktop\EarthJukebox_NASA_resources\07_Lightning_ISS\`.
  `backend/eic/tracks/07_lightning.yaml` expects `07_Lightning/...` under EJ_RESOURCES: set
  EJ_RESOURCES=C:\Users\Dell\Desktop\EarthJukebox_NASA_resources and fix the folder name or the yaml path.
- Grid 120x60 (3 deg), 14 equal parts in order, March 2017 - July 2023. No dates are guessed.

## Sound references (listen before building)
Folder: `C:\Users\Dell\Desktop\EarthJukebox_NASA_resources\reference\`
- `muzik.mp3` (47 s) = THE target for the orchestral bed. Analysis: 74% of energy below 250 Hz,
  34% sub-bass below 60 Hz; low pedal ~39 Hz (D#1/Eb1) + octave 78 Hz, slowly rocking D <-> Eb;
  bowed string band ~420-650 Hz swelling about every 3 s; no sharp attacks; very steady loudness
  (~7 dB range); chroma centred on Eb, Bb, G (+ D). Dark, cinematic, continuous.
- `13998_Butterfly_MP4.mp4` = target for the plucked layer: NASA plays its stars on a DIGITAL HARP
  (wings on strings and synth tones), soft, panned, lots of reverb, one diatonic scale.
- `NGC_1300_VIDEO.mp4`, `HUDF_1920_June_2nd_Speed_Up.mp4` = house style (calm, reverb, no harsh attacks).

## Layers
1. Bass + sub-bass = HOW MUCH. Contrabass / low strings on an Eb pedal (Eb1/Eb2) with a slow
   D <-> Eb pull like muzik.mp3. Gain and fullness follow the TOTAL lightning under the scan line,
   smoothed ~2 s. Over calm ocean a very soft bass floor STAYS (never full silence).
2. Strings = WHERE. String-ensemble sample playing consonant Eb-family chords only (Eb, Ab, Bb;
   e.g. Eb-G-Bb, Ab-C-Eb, Bb-D-F). Chord register follows the lightning-weighted mean latitude
   under the line (north = higher). Stereo as in the rest of the app (north = left ear, south = right).
   Slow bowed swells (attack ~1-1.5 s, release ~2-3 s), level from smoothed total.
3. Digital harp = STRONGEST STORMS. Replaces the kalimba. Only cells above the ~90th percentile of
   the track's range pluck, softly, on an Eb pentatonic (Eb F G Bb C), pitch by latitude, panned
   like other notes, generous reverb. Raw (unsmoothed) data so detail stays.
- Mood: dark-but-calm. Lightning is NOT "bad news": no dissonance, no tension notes for this track.

## Timing
- 20 s per west->east sweep (was 11 s), 14 parts = ~4.7 min. Orchestra uses ~2 s smoothing;
  harp uses the raw cells. Crossfade between parts like the other tracks.

## Samples
- Use the same source and license the repo already uses: FluidR3_GM via midi-js-soundfonts
  (CC BY 3.0, https://github.com/gleitz/midi-js-soundfonts): contrabass, string_ensemble_1,
  orchestral_harp (cello is already in public/samples/cello). Add the note files needed for
  Eb/Ab/Bb voicings as mp3 under public/samples/<name>/, load with the existing Tone.js sampler
  (EJ.Tone). No new npm packages. Keep the README credit line accurate.
- If realism is poor, ask before switching to another sample library (check its license).

## Where to change
- `backend/sweep.config.json`: lightning `instrument` (currently "kalimba"), playback speed, description
  text ("drop-like note" -> harp/orchestra wording). Rebuild: `npm run api`, `npm run validate`.
- `backend/eic/tracks/07_lightning.yaml`: `seconds_per_sweep: 20`, legend items (below).
- `public/sweep/tracks/lightning.js` (new mapping) + `public/sweep/audio.js` (bass/strings voices)
  + `public/sweep/sonifier.js` (DEMOS.lightning text, mapping selection).
- Sound legend / spoken text:
  - "Deep bass: how much lightning is under the scan line. It never stops; it swells over storms."
  - "Strings: where the storms are. Higher chords = farther north."
  - "Harp notes: the strongest storms, played as the line crosses them."

## Done when
- AGENTS.md checks pass (`npm run validate`, `npm test`, `npm run test:responsive`, python tests).
- By ear: Central Africa / Amazon / Maritime Continent swell deep and full; oceans keep only the soft
  floor; the strings audibly rise and fall as storms swing north and south through the seasons;
  harp plucks are sparse; nothing clicks or clips. Compare side by side with muzik.mp3.
