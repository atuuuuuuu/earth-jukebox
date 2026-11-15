// Track 03 — Aerosols, "Four winds": one west->east sweep over NASA's GEOS aerosol still.
// Pure planning logic (no Tone.js): given the data under the scan line, decide what sounds.
//
// Modelled on the wind in NASA's NGC 1300 sonification: soft, band-limited noise that swells as
// material passes the line. Each aerosol in the data (track.layers) is its own wind, with its own
// colour (layer.wind: smoke, sand, ocean or breath; see winds.js):
//  * how much of it is under the scan line -> the wind's loudness and how open (bright) it is;
//  * where it is, north or south (its weighted mean latitude) -> the wind's register (north =
//    higher) and stereo (north = left ear, south = right ear, as everywhere in the app);
//  * both smoothed over about two seconds, so the winds breathe; silence where there is none;
//  * where the smoke (layer.wind 'smoke') is thickest, sparse soft crackles, each at its latitude.
// Every layer has its own fixed scale for the whole track: 1 = its fullest stretch of the sweep.

import { clamp, scaleRange } from '../music.js';

// NASA's stories also get a voice: the aerosol NASA names plays its own instrument (layer.story in
// the data: cello for smoke, kalimba for dust, harp for sea salt, vibraphone for sulfate) where its
// plume is thickest under the line, on a steady pulse, its pitch the plume's place in the window
// (north higher). A thin plume at one latitude is one repeated note; a spiral climbs and falls.
const E_PENTATONIC = [4, 6, 8, 11, 1];             // the app's calm scale (as night lights)
const REGISTERS = {
  cello: scaleRange(40, 64, E_PENTATONIC),          // E2 … E4: low and dark, for smoke
  kalimba: scaleRange(52, 76, E_PENTATONIC),        // E3 … E5
  harp: scaleRange(56, 83, E_PENTATONIC),           // G#3 … B5
  vibraphone: scaleRange(64, 88, E_PENTATONIC),     // E4 … E6: high and glassy, for sulfate
};
const STORY = { perSecond: 3.2, min: 0.22, ring: 2.2, bow: 1.5 };

// NASA's stories (a view, see sonifier.js): each story is a window with its own finer grid
// (`frame.geo`), swept on its own. Inside a window the winds' register and stereo stretch to fit it
// (its north edge is the top), and the aerosol NASA names for the story (`frame.focus`) is brought
// forward: the other winds stay, a little softer.

export const HUM_NOTES = [];         // no synth hum: the winds are the whole sound

const SMOOTH_SECONDS = 0.9;         // each side: about ±0.9 s of the sweep at normal speed (±3 columns on the whole map)
const FOCUS_DUCK = 0.55;            // the other winds in a story, beside the aerosol NASA names (about -5 dB)
const LAT_SPAN = 60;                // winds.js plays -60 … 60 degrees as its whole register and stereo
const LEVEL_PERCENTILE = 0.97;      // stretches this full of a layer, or fuller, blow its wind in full
const GATE = 0.03;                  // below this share of full a wind is silent
const LAT_EDGE = 80;                // rows beyond this latitude are not read (map stretching, ice)
// Crackles: only in the thickest smoke (a cell at `min` of the layer's scale or more), sparse: at
// most one per step, at the column's thickest cell, and more likely the thicker it is. About two a
// second where the smoke is thickest, under ten in a whole sweep.
const CRACKLE = { min: 0.6, spread: 0.12, soft: 0.16, loud: 0.42 };

/** Live-tunable: which layer is heard alone (its id), or null for all. */
export const params = { solo: null };

export function defaults(track) {
  return {
    yearSweep: track.chapters[0].secondsPerSweep,
    bed: 'winds',                   // tells the audio engine to build the winds instead of notes
    winds: (track.layers ?? []).map((L) => ({ id: L.id, wind: L.wind })),
    // The story instruments to load (sample sets), one per aerosol that has one.
    storyVoices: [...new Set((track.layers ?? []).map((L) => L.story).filter(Boolean))],
    solo: null,
  };
}

export function configure(settings) {
  params.solo = settings.solo ?? null;
}

const gridOf = (track, frame) => frame.geo ?? track.grid;

/** One segment per map (or story); one step per column of its grid (3° on the whole map). */
export function segments(track) {
  return track.chapters.flatMap((chapter) => chapter.frames.map((frame) => ({ chapter, frame, steps: gridOf(track, frame).cols })));
}

/** A story may be longer than the others (its own seconds); the speed setting scales them all. */
export function segmentSeconds(track, seg, settings) {
  const own = seg.frame.secondsPerSweep, all = seg.chapter.secondsPerSweep;
  return own && all ? (settings.yearSweep * own) / all : settings.yearSweep;
}

const rowLat = (g, r) => g.latNorth - (r + 0.5) * g.cellDeg;

/**
 * Decode the layers once and plan every column: for each layer, its amount under the line
 * (area-weighted mean over the column, smoothed across neighbouring columns, wrapping at the date
 * line on a whole world map) and its weighted mean latitude. Each layer gets one fixed scale over
 * the whole track (or over all the stories).
 */
export function prepare(track) {
  const layers = track.layers ?? [];
  const sums = Object.fromEntries(layers.map((L) => [L.id, []]));
  for (const ch of track.chapters) {
    for (const fr of ch.frames) {
      const g = gridOf(track, fr);
      const weight = Float32Array.from({ length: g.rows }, (_, r) => (Math.abs(rowLat(g, r)) > LAT_EDGE ? 0 : Math.cos((rowLat(g, r) * Math.PI) / 180)));
      const wsum = weight.reduce((a, b) => a + b, 0) || 1;
      const world = Math.abs(g.cols * g.cellDeg - 360) < 1e-6;
      const seconds = fr.secondsPerSweep ?? ch.secondsPerSweep ?? 35;
      const half = Math.max(1, Math.round((SMOOTH_SECONDS * g.cols) / seconds));
      const kernel = Array.from({ length: 2 * half + 1 }, (_, i) => half + 1 - Math.abs(i - half));
      fr._layers = {};
      fr._winds = {};
      for (const L of layers) {
        const v = Float32Array.from(fr.layers[L.id], (x) => x / 100);
        fr._layers[L.id] = v;
        const amount = new Float32Array(g.cols), moment = new Float32Array(g.cols);
        for (let c = 0; c < g.cols; c++) {
          for (let r = 0; r < g.rows; r++) {
            const a = v[r * g.cols + c] * weight[r];
            amount[c] += a / wsum;              // a mean, so windows of any height share one scale
            moment[c] += (a / wsum) * rowLat(g, r);
          }
        }
        const sum = new Float32Array(g.cols), lat = new Float32Array(g.cols);
        for (let c = 0; c < g.cols; c++) {
          let s = 0, m = 0, ks = 0;
          kernel.forEach((k, i) => {
            let cc = c + i - half;
            if (world) cc = (cc + g.cols) % g.cols;
            else if (cc < 0 || cc >= g.cols) return;      // a window has edges: nothing beyond them
            s += k * amount[cc];
            m += k * moment[cc];
            ks += k;
          });
          sum[c] = s / ks;
          lat[c] = s > 0 ? m / s : 0;
          sums[L.id].push(sum[c]);
        }
        fr._winds[L.id] = { sum, lat };
      }
    }
  }
  track._windNorm = {};
  for (const L of layers) {
    const s = sums[L.id].sort((a, b) => a - b);
    track._windNorm[L.id] = Math.max(1e-6, s[Math.floor(s.length * LEVEL_PERCENTILE)] ?? 1);
  }
  // In a story, the wind of the aerosol NASA names fills the story: its own fullest stretch of the
  // window blows in full (the others keep the scale shared by all the stories, a little softer).
  for (const ch of track.chapters) {
    for (const fr of ch.frames) {
      if (!fr.focus || !fr._winds[fr.focus]) continue;
      const s = [...fr._winds[fr.focus].sum].sort((a, b) => a - b);
      fr._focusNorm = Math.max(1e-6, s[Math.floor(s.length * LEVEL_PERCENTILE)] ?? 1);
    }
  }
  return track;
}

/**
 * The story's voice in column c: the instrument of the aerosol NASA names, at that aerosol's
 * thickest cell under the line, on a steady pulse (about three notes a second at normal speed).
 */
export function storyNotes(track, frame, c) {
  const L = track.layers?.find((x) => x.id === frame.focus);
  const reg = L && REGISTERS[L.story];
  if (!reg) return [];
  const g = gridOf(track, frame), v = frame._layers[L.id];
  const every = Math.max(1, Math.round(g.cols / ((frame.secondsPerSweep ?? 10) * STORY.perSecond)));
  if (c % every) return [];
  let r = -1, best = STORY.min;
  for (let k = 0; k < g.rows; k++) if (v[k * g.cols + c] >= best) { best = v[k * g.cols + c]; r = k; }
  if (r < 0) return [];
  const t = clamp((best - STORY.min) / (1 - STORY.min), 0, 1);
  const midi = reg[clamp(Math.round((1 - (r + 0.5) / g.rows) * (reg.length - 1)), 0, reg.length - 1)];
  return [{
    voice: 'story', instrument: L.story, kind: 'story', layer: L.id, row: r, col: c, midi,
    velocity: 0.35 + 0.5 * Math.pow(t, 0.7), offset: 0, duration: L.story === 'cello' ? STORY.bow : STORY.ring,
  }];
}

/** A wind's level 0..1 for a share `rel` (0..1) of the layer's fullest stretch: silent below the gate.
 *  The curve lifts thin layers, so the mix stays steady, as in the reference, yet still swells. */
export const windLevel = (rel) => (rel < GATE ? 0 : Math.pow(clamp(rel, 0, 1), 0.6));

/** Small repeatable pseudo-random numbers in [0, 1), so a sweep always crackles the same way. */
const hash = (a, b, k) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A soft crackle where the smoke is thickest in column c, now and then: at most one, at its latitude. */
export function crackles(track, frame, layerId, c) {
  const g = gridOf(track, frame), v = frame._layers[layerId];
  let r = 0;
  for (let k = 1; k < g.rows; k++) if (v[k * g.cols + c] > v[r * g.cols + c]) r = k;
  const x = v[r * g.cols + c];
  if (x < CRACKLE.min) return [];
  const t = (x - CRACKLE.min) / (1 - CRACKLE.min);             // 0 at the threshold … 1 at the thickest
  if (hash(c, r, 0) >= 0.25 + 0.6 * t) return [];               // a quarter of the time at the threshold, most of it at the thickest
  return [{
    voice: 'crackle', kind: 'smoke', layer: layerId, row: r, col: c, free: true,
    velocity: CRACKLE.soft + (CRACKLE.loud - CRACKLE.soft) * t * (0.6 + 0.4 * hash(c, r, 1)),
    offset: CRACKLE.spread * hash(c, r, 7), duration: 0.03,
  }];
}

/**
 * Plan one scan step (one column).
 * @returns {{events, hum, layers: {winds: Array<{id, wind, level, open, lat, tone, thick}>}}}
 *   level: loudness 0..1; open: how bright 0..1; lat: where it is (degrees); tone: the latitude its
 *   register and stereo follow (lat itself on the whole map, stretched inside a story's window);
 *   thick: the thickest cell of the layer right under the line (0..1), for the smoke's roughness.
 */
export function planStep(track, seg, c) {
  const { frame } = seg;
  const g = gridOf(track, frame);
  const events = [];
  // Inside a window, its south edge plays as -60 degrees and its north edge as 60 (winds.js's span).
  const south = g.latNorth - g.rows * g.cellDeg;
  const tone = (lat) => (g.zoom ? -LAT_SPAN + (2 * LAT_SPAN * (lat - south)) / (g.latNorth - south) : lat);
  if (frame.focus && (!params.solo || params.solo === frame.focus)) events.push(...storyNotes(track, frame, c));
  const winds = (track.layers ?? []).map((L) => {
    const w = frame._winds[L.id];
    const rel = clamp(w.sum[c] / (L.id === frame.focus ? frame._focusNorm : track._windNorm[L.id]), 0, 1);
    let thick = 0;
    const v = frame._layers[L.id];
    for (let r = 0; r < g.rows; r++) thick = Math.max(thick, v[r * g.cols + c]);
    if (L.wind === 'smoke' && (!params.solo || params.solo === L.id)) events.push(...crackles(track, frame, L.id, c));
    const duck = frame.focus && !params.solo && frame.focus !== L.id ? FOCUS_DUCK : 1;
    return { id: L.id, wind: L.wind, level: windLevel(rel) * duck, open: rel, lat: w.lat[c], tone: tone(w.lat[c]), thick };
  });
  for (const ev of events) {           // where the crackle sits along the line (-1 = north … +1 = south)
    ev.x = (ev.col + 0.5) / g.cols;
    ev.y = (ev.row + 0.5) / g.rows;
    ev.pos = ev.y * 2 - 1;
  }
  const heard = winds.filter((w) => !params.solo || w.id === params.solo);
  const level = Math.max(0, ...heard.map((w) => w.level));
  return { events, hum: { level: 0, pan: 0, under: level }, layers: { winds } };
}
