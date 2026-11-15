# Track 02 Sea Surface Currents & Temperature: "Warm chords" (spec, 15 Nov 2026)

New track (do not touch 07_ocean_currents / Perpetual Ocean). AGENTS.md rules apply (no new npm
packages; never hand-edit public/api|data|media; keep test hooks; ask before deleting files,
changing backend/API.md, committing or pushing). Build only from NASA sources and this repo.
Name it in our own words, e.g. "Warm and cold seas" (not another team's record name).

## Data
- NASA SVS 3912 "Global Sea Surface Currents and Temperature": https://svs.gsfc.nasa.gov/3912/
  (credit NASA's Scientific Visualization Studio; data: ECCO2 ocean model).
- Files: `C:\Users\Dell\Desktop\EarthJukebox_NASA_resources\02_SeaSurface_Currents_Temp\`
  - `flat_global_ecco2_2028x1024_comp_p30.mp4` (2048x1024, 30 fps, 68.7 s): flat equirectangular
    world map, flow traces coloured by temperature. Use this. (`ecco2_sst_flow.mp4`, 66.7 s, also
    2048x1024: check which one has no overlays and use that.) `Oceanflows-UHD-2160.mp4.part` is an
    unfinished download: ignore it.
  - `sst_ecco2_cbar.png` = colour key "Sea Surface Temp (°C)" 0 -> 32 °C:
    blue (0) -> cyan -> green (~10) -> yellow (~20) -> orange -> red (32). Sample it into a lookup table.
  - `flat_global_ecco2_2028x1024.25000.jpg` = a still frame for checking.
- Base map: grey land, black/dark ocean between traces, white/grey Antarctica and Greenland: not data.
  Only coloured trace pixels close (Lab distance) to the key count; everything else = no data.
- Read each colour back to °C on NASA's 0-32 °C key. Grid: 120x60 (3 deg) per sampled frame
  (2-5 fps is plenty), median of the valid trace pixels per cell. Keep real °C in the data
  (units: "°C, read from NASA's colour key"), range [0, 32] fixed for the whole track.
- Check: tropics (W Pacific warm pool, Indian Ocean) ~28-32 °C; Southern Ocean ~0-5 °C;
  Gulf Stream warm tongue reaching NE; cold tongue along the equatorial E Pacific.

## Reading method: top to bottom
- The scan line is HORIZONTAL and moves from the top of the map (north) to the bottom (south),
  ~16 s per sweep, while the video plays (moving sweep, one sweep per ~1/4 of the movie, or
  sweeps at fixed movie times: put the timing in the YAML).
- At each moment the line covers one latitude band across all longitudes.
  Stereo = WEST in the left ear, EAST in the right ear (the line is horizontal, so stereo runs along it).
  Say this clearly in the legend and help, because the other tracks use north = left.

## Sound: warm chords (reference = instrument.mp3)
Reference: `C:\Users\Dell\Desktop\EarthJukebox_NASA_resources\reference\instrument.mp3` (25 s).
Our analysis: a warm, soft, sustained chord pad (organ / string-pad like), fundamental around
D2 (~73 Hz) with a harmonic stack (partials ~73, 116, 164, 221, 261, 293, 350, 393, 439, 522 Hz),
86% of energy below 500 Hz and nothing above ~1.5 kHz (dark, warm, no brightness), no sharp attacks,
very steady loudness (~8 dB range), and chords that change every ~5 s by ADDING upper voices on top
of the low base. Notes come from one white-key scale (C D E F G A; D Dorian / C major colour).
- Instrument: try sampled pads from the source the repo already uses (FluidR3_GM via
  midi-js-soundfonts, CC BY 3.0: e.g. pad_2_warm, string_ensemble_1, church_organ / reed_organ);
  pick the one closest to instrument.mp3 by ear, keep a lowpass ~1.5 kHz, slow attack (~0.8-1.2 s)
  and long release. If no sample is close, use a Tone.js PolySynth (soft saw/triangle -> lowpass).
- HOTTER = MORE AND HIGHER CHORD VOICES ADDED (cold = only the deep base). Temperature under the line
  (ocean cells only, area-weighted mean; put the thresholds in the YAML):
  - always (any ocean): D2 root, quiet
  - >= 6 °C: + A2 (fifth)
  - >= 12 °C: + D3, F3
  - >= 18 °C: + A3, C4
  - >= 24 °C: + E4, G4
  - >= 28 °C: + A4, D5 (the highest, warmest voices)
  Voices fade in/out over ~1-1.5 s (never click on/off). Overall loudness follows how much ocean is
  under the line (land-only rows: near silence).
- Stereo detail: each added voice is panned toward where along the line that warmth is
  (e.g. warm western Pacific left-of-centre, warm Indian Ocean right), from the cell temperatures.
- Mood: calm. Warm water is not "bad news" here: no dissonance.

## Accessibility and UI
- New track with its own key (next free number), legend, "Hear an example" buttons
  ("cold sea: deep base only", "warm sea: full chord"), W = latitude of the line + temperature
  under it in °C + which side (west/east) is warmest, D = map description.
- `text` for each sweep starts with its `when` (date span of the movie section if known, else
  "Sweep 1 of N").

## Done when
- AGENTS.md checks pass (`npm run api`, `npm run validate`, `npm test`, `npm run test:responsive`,
  python tests); unit test: a cell coloured exactly like the key at 20 °C decodes to 20 ±1 °C.
- By ear: the sweep starts thin and low over the Arctic, fills with rising chords toward the
  tropics (fullest around the equator), then thins again to the deep base over the Southern Ocean.
  Compare side by side with instrument.mp3.
