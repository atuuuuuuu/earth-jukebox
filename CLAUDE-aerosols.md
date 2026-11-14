# Track 03 GEOS Aerosols: "Four winds" (spec, agreed 14 Nov 2026)

New track. AGENTS.md rules apply (no new npm packages; never hand-edit public/api|data|media;
keep test hooks; ask before deleting files, changing backend/API.md, committing or pushing).
Reuse the existing sweep engine, pipeline style (one YAML per track in backend/eic/tracks/) and
accessibility patterns. Do NOT break tracks 1-4.

## Data
- NASA SVS 5669 "GEOS Aerosols (2025)": https://svs.gsfc.nasa.gov/5669/ (credit: NASA's Scientific
  Visualization Studio; data: NASA GEOS model).
- Files: `C:\Users\Dell\Desktop\EarthJukebox_NASA_resources\03_GEOS_Aerosols\`
  - `Aerosols_2025-08-19T20_00_00_7680x4320.png` (use this, 8K), also 3840x2160 and 1920x1080 versions
  - `Aerosols_cbar.png` = colour key with 4 types, no numbers:
    Black Carbon ~ (210,95,70) orange-red, Dust ~ (195,155,215) lavender,
    Sea Salt ~ (130,170,170) grey-teal, Sulfate ~ (80,220,50) bright green.
    Sample the exact colours from the key image, don't trust these numbers.
- ONE still image, 19 Aug 2025 20:00 UTC, flat equirectangular world map (check edges/offset like
  the night-lights yaml does). Base map = dark ocean, grey land, Greenland/Antarctica grey, small
  city lights (white/yellow dots) and fire spots: these are NOT aerosol, mask them.
- Layers are blended/semi-transparent and overlap (e.g. dust over Sahara/Atlantic, smoke over
  central Africa, sea salt swirls over southern oceans, sulfate over China/N. Pacific/E. US).
  Unmix per pixel: in linear RGB, solve a small non-negative least squares
  pixel ~= base + sum_k a_k * colour_k (k = 4 types), clip a_k to [0,1]. Validate visually by
  writing 4 debug heatmaps (backend/eic/debug/, git-ignored) and checking: Sahara->Atlantic dust plume
  high in DUST, central/southern Africa high in BLACK CARBON, Southern Ocean high in SEA SALT,
  East Asia / N. Pacific high in SULFATE.
- Grid 120x60 (3 deg) like the other tracks, but 4 values per cell (one per type). Values are
  relative (no numbers on the key): normalise each type to its own max, say so in the caveat.
- If 4 layers need a change to backend/API.md (score format), STOP and show me the proposed change
  first (AGENTS.md rule). Prefer an additive, backward-compatible field (e.g. `layers`).

## Reading method
- Left-to-right sweep (same engine as the other tracks), one still map, ~35 s per sweep, loops
  optionally. North = higher pitch/brighter filter AND left ear, south = right ear (app convention).

## Sound: four winds (reference = NGC 1300 wind)
Reference: `C:\Users\Dell\Desktop\EarthJukebox_NASA_resources\reference\NGC_1300_VIDEO.mp4`
- Take ONLY its wind/whoosh quality: the soft airy sound that swells as the galaxy's dusty, glowing
  arm passes the rotating scan line. Our analysis: band-limited noise, ~100-2000 Hz (almost nothing
  above 2 kHz, so it's soft and dark), centre of the sound sweeps slowly between ~230 and ~730 Hz
  as more material passes the line, gentle swells over several seconds, no attacks, lots of reverb.
- Build it in Tone.js (EJ.Tone) from noise: pink/brown noise -> bandpass/lowpass filter(s) with slow
  filter + gain automation (+ optional slow LFO for gusts) -> reverb send. No samples needed.
- Amount of that aerosol under the scan line -> wind loudness AND filter opening (more = louder,
  brighter whoosh). Weighted mean latitude of that aerosol under the line -> filter centre/register
  (north = higher) and stereo (north left). Smooth ~1-2 s so it breathes. Silence when absent.
- Each type has its own wind COLOUR so they stay distinguishable in "All":
  - Sea salt: low, airy ocean wind (lowpass, ~150-600 Hz band, smooth, slow gusts).
  - Dust: mid, sandy/grainy wind (~300-1200 Hz, add subtle grain: fast tiny amplitude flutter).
  - Sulfate: higher, thin breathy wind (~600-2000 Hz, narrower band, very soft).
  - Black carbon (smoke): dark, rough wind (~100-500 Hz, slightly distorted/crackly texture,
    sparse soft crackles where it is thickest). Stays calm overall, but thick smoke may get
    slightly rougher (house rule: bad news = a bit less calm, never harsh).
- Mix so "All" is pleasant: each wind's level balanced so no type masks the others.

## Controls (accessibility first, see AGENTS.md)
- One native radio group in a fieldset, legend "Listen to": All, Black carbon, Dust, Sea salt,
  Sulfate. Default All. Arrow keys move; the live region announces e.g. "Dust only".
- Single-letter shortcuts inside #player only (WCAG 2.1.4), each also a button/radio:
  A = All, B = Black carbon, U = dust, T = sea salT, L = suLfate (check no clash with existing keys:
  Space, arrows, Home, End, W, D, S, H, 1-5, M, Escape). Update H help text.
- Track key 5 = Aerosols. "Where am I?" (W) reports the selected aerosol, scan position and which
  aerosols are under the line right now. "Describe" (D) speaks the map text.
- Sound legend items (one per wind + "how the sweep works"), with "Hear an example" buttons that
  play each wind alone.
- Globe/map display shows the aerosol image; when one type is soloed, dim or hide the others if
  cheap (optional).

## Done when
- AGENTS.md checks pass (`npm run api`, `npm run validate`, `npm test`, `npm run test:responsive`,
  python tests). Add test coverage for the radio group and shortcuts in test/run.cjs.
- By ear: soloing Dust, the sweep crossing the Sahara/Atlantic swells clearly; Sea salt is strongest
  over southern oceans; Black carbon over central Africa; Sulfate over East Asia. "All" sounds like
  one calm, layered wind where the four colours can still be told apart.
