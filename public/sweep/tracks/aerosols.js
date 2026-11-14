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

import { clamp } from '../music.js';

export const HUM_NOTES = [];         // no synth hum: the winds are the whole sound

const SMOOTH_COLS = 3;              // columns each side (±9°, about ±0.9 s at normal speed)
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
    solo: null,
  };
}

export function configure(settings) {
  params.solo = settings.solo ?? null;
}

/** One segment per map; one step per 3° column. */
export function segments(track) {
  return track.chapters.flatMap((chapter) => chapter.frames.map((frame) => ({ chapter, frame, steps: track.grid.cols })));
}

export function segmentSeconds(track, seg, settings) {
  return settings.yearSweep;
}

const rowLat = (g, r) => g.latNorth - (r + 0.5) * g.cellDeg;

/**
 * Decode the layers once and plan every column: for each layer, its amount under the line
 * (area-weighted, smoothed across neighbouring columns, wrapping at the date line) and its
 * weighted mean latitude. Each layer gets one fixed scale over the whole track.
 */
export function prepare(track) {
  const g = track.grid, layers = track.layers ?? [];
  const weight = Float32Array.from({ length: g.rows }, (_, r) => (Math.abs(rowLat(g, r)) > LAT_EDGE ? 0 : Math.cos((rowLat(g, r) * Math.PI) / 180)));
  const kernel = Array.from({ length: 2 * SMOOTH_COLS + 1 }, (_, i) => SMOOTH_COLS + 1 - Math.abs(i - SMOOTH_COLS));
  const ksum = kernel.reduce((a, b) => a + b, 0);
  const sums = Object.fromEntries(layers.map((L) => [L.id, []]));
  for (const ch of track.chapters) {
    for (const fr of ch.frames) {
      fr._layers = {};
      fr._winds = {};
      for (const L of layers) {
        const v = Float32Array.from(fr.layers[L.id], (x) => x / 100);
        fr._layers[L.id] = v;
        const amount = new Float32Array(g.cols), moment = new Float32Array(g.cols);
        for (let c = 0; c < g.cols; c++) {
          for (let r = 0; r < g.rows; r++) {
            const a = v[r * g.cols + c] * weight[r];
            amount[c] += a;
            moment[c] += a * rowLat(g, r);
          }
        }
        const sum = new Float32Array(g.cols), lat = new Float32Array(g.cols);
        for (let c = 0; c < g.cols; c++) {
          let s = 0, m = 0;
          kernel.forEach((k, i) => {
            const cc = (c + i - SMOOTH_COLS + g.cols) % g.cols;
            s += k * amount[cc];
            m += k * moment[cc];
          });
          sum[c] = s / ksum;
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
  return track;
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
  const g = track.grid, v = frame._layers[layerId];
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
 * @returns {{events, hum, layers: {winds: Array<{id, wind, level, open, lat, thick}>}}}
 *   level: loudness 0..1; open: how bright 0..1; lat: where it is (degrees); thick: the thickest
 *   cell of the layer right under the line (0..1), for the smoke's roughness.
 */
export function planStep(track, seg, c) {
  const { frame } = seg;
  const g = track.grid;
  const events = [];
  const winds = (track.layers ?? []).map((L) => {
    const w = frame._winds[L.id];
    const rel = clamp(w.sum[c] / track._windNorm[L.id], 0, 1);
    let thick = 0;
    const v = frame._layers[L.id];
    for (let r = 0; r < g.rows; r++) thick = Math.max(thick, v[r * g.cols + c]);
    if (L.wind === 'smoke' && (!params.solo || params.solo === L.id)) events.push(...crackles(track, frame, L.id, c));
    return { id: L.id, wind: L.wind, level: windLevel(rel), open: rel, lat: w.lat[c], thick };
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
