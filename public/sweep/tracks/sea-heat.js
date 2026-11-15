// Track 02 — Sea heat, "Warm and cold seas": a level scan line moves down NASA's map of sea surface
// temperature, from the Arctic to Antarctica. Pure planning logic (no Tone.js).
//
// The line lies on its side: at each step it covers one 3-degree band of latitude, all the way
// round, so west is the left ear and east the right (not north and south, as on the other tracks).
//  * how warm the sea under the line is (mean of its sea cells, in degrees C) -> how many chord
//    voices sound: the deep root over any sea, and more and higher voices as it warms, each group
//    joining at its own temperature (the data's `voices`, from the track YAML);
//  * where along the line the warm water is -> each voice leans toward it, west left, east right;
//  * how much of the line is sea -> how loud the chord is (only land or ice: almost silent).
// Calm throughout: one white-key scale, no dissonance. Warm water is not bad news here.

import { clamp, noteToMidi, scaleRange } from '../music.js';

export const HUM_NOTES = [];        // no synth hum: the chord is the whole sound
export const params = {};

const RAMP = 1;                     // degrees C over which a voice group fades in around its threshold
const BASE = 0.8;                   // the deep root alone is quiet
// Loudness follows how much of the line is sea, from a floor (any sea at all) up to a full line.
// Like the reference, the chord grows richer more than louder: each voice softens a little as more
// join (SPREAD), so the whole sweep stays within about 10 dB. Set by offline render, 15 Nov 2026.
const LOUD_FLOOR = 0.45, LOUD_CURVE = 0.6, SEA_MIN = 0.04;
const SPREAD = 0.4;
// The temperature melody: one soft swelling note every other band of latitude (6 degrees), its pitch the
// water's temperature on one fixed scale: sixteen 2-degree steps of white keys from D3 (0 C) up to E5
// (30 C and more). So warming is heard as rising notes and cooling as falling notes, a note a step
// higher for every 2 degrees. A stretch of the line much warmer than the rest adds its own note, in
// its own ear (west left, east right).
const MELODY = scaleRange(50, 78, [0, 2, 4, 5, 7, 9, 11]).slice(0, 16);   // D3 ... E5
const MELODY_EVERY = 2;             // bands
const MELODY_STEP = 2;              // degrees C per note
const WARM_OUTLIER = 3;             // a stretch this much warmer than the line's mean gets its own note
const WARM_SPAN = 2;                // cells each side when finding the warmest stretch of the line

/** The melody note of water at `temp` degrees C: one step of the scale for every 2 degrees. */
export const melodyMidi = (temp) => MELODY[clamp(Math.floor(temp / MELODY_STEP), 0, MELODY.length - 1)];

/** The chord's voices, low to high: {midi, min (degrees C), group}. From the data's `voices`. */
export function voicesOf(track) {
  return (track.voices ?? []).flatMap((G, group) => G.notes.map((n) => ({ midi: noteToMidi(n), min: G.min, group })));
}

export function defaults(track) {
  return {
    yearSweep: track.chapters[0].secondsPerSweep,
    bed: 'chords',
    chordNotes: voicesOf(track).map((v) => v.midi),
  };
}

export function configure() {}

/** One segment per sweep; one step per band of latitude that has a reading in any sweep. */
export function segments(track) {
  return track.chapters.flatMap((chapter) => chapter.frames.map((frame) => ({ chapter, frame, steps: track._rows.length })));
}

export function segmentSeconds(track, seg, settings) {
  return settings.yearSweep;
}

const rowLat = (g, r) => g.latNorth - (r + 0.5) * g.cellDeg;
const colLon = (g, c) => g.lonWest + (c + 0.5) * g.cellDeg;
/** Where along the line a column is: -1 = western edge (left ear) … +1 = eastern edge (right ear). */
const colX = (g, c) => ((c + 0.5) / g.cols) * 2 - 1;

/**
 * Decode every sweep and describe each band of latitude once: how much of it is sea, its mean
 * temperature (smoothed a little with the bands either side), where along it each voice group's
 * warm water is, and its warmest stretch.
 */
export function prepare(track) {
  const g = track.grid, voices = voicesOf(track);
  const mins = [...new Set(voices.map((v) => v.min))];
  track._voices = voices;
  let top = g.rows, bottom = -1;
  for (const ch of track.chapters) {
    for (const fr of ch.frames) {
      fr._t = Float32Array.from(fr.temp, (v) => (v === null ? NaN : v));
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) if (!Number.isNaN(fr._t[r * g.cols + c])) { top = Math.min(top, r); bottom = Math.max(bottom, r); break; }
      }
    }
  }
  track._rows = Array.from({ length: Math.max(0, bottom - top + 1) }, (_, i) => top + i);
  for (const ch of track.chapters) {
    for (const fr of ch.frames) {
      const raw = track._rows.map((r) => {
        const cells = [];
        for (let c = 0; c < g.cols; c++) {
          const t = fr._t[r * g.cols + c];
          if (!Number.isNaN(t)) cells.push({ c, t });
        }
        const mean = cells.length ? cells.reduce((a, x) => a + x.t, 0) / cells.length : NaN;
        // Each group's warm water: the cells at or above its threshold, and their middle along the line.
        const warm = mins.map((m) => {
          const w = cells.filter((x) => x.t >= m);
          return { share: cells.length ? w.length / cells.length : 0, x: w.length ? w.reduce((a, x) => a + colX(g, x.c), 0) / w.length : 0 };
        });
        // The warmest stretch: the highest mean over a few neighbouring sea cells.
        let best = null;
        for (const { c } of cells) {
          let s = 0, n = 0;
          for (let d = -WARM_SPAN; d <= WARM_SPAN; d++) {
            const t = fr._t[r * g.cols + ((c + d + g.cols) % g.cols)];
            if (!Number.isNaN(t)) { s += t; n += 1; }
          }
          if (n && (!best || s / n > best.t)) best = { c, t: s / n };
        }
        return { r, share: cells.length / g.cols, mean, warm, warmest: best && { lon: colLon(g, best.c), x: colX(g, best.c), temp: best.t } };
      });
      // The chord follows a temperature smoothed with the bands either side (1-2-1), so it moves
      // with the sea, not with each 3-degree row.
      fr._line = raw.map((L, i) => {
        let s = 0, w = 0;
        for (const [j, k] of [[i - 1, 1], [i, 2], [i + 1, 1]]) {
          const m = raw[j]?.mean;
          if (m !== undefined && !Number.isNaN(m)) { s += k * m; w += k; }
        }
        return { ...L, lat: rowLat(g, L.r), temp: w ? s / w : NaN, mins };
      });
    }
  }
  return track;
}

/** How strongly a voice group joining at `min` sounds over water at `temp` degrees C (0..1). */
export const groupLevel = (temp, min) => (min <= 0 ? 1 : clamp((temp - min) / RAMP + 0.5, 0, 1));
/** Loudness of the whole chord for a line that is `share` sea (0..1): almost none on a line of land. */
export const loudness = (share) => (share <= 0 ? 0
  : share < SEA_MIN ? (LOUD_FLOOR * share) / SEA_MIN
    : LOUD_FLOOR + (1 - LOUD_FLOOR) * Math.pow((share - SEA_MIN) / (1 - SEA_MIN), LOUD_CURVE));

/** The chord's voice levels and pans for water at `temp` C on a line that is `share` sea. */
export function chordFor(track, temp, share, pansOf = () => 0) {
  if (Number.isNaN(temp)) return { levels: track._voices.map(() => 0), pans: track._voices.map(() => 0) };
  const on = track._voices.map((v) => groupLevel(temp, v.min) * (v.min <= 0 ? BASE : 1));
  const voices = on.reduce((a, x) => a + (x > 0 ? x : 0), 0);
  const each = loudness(share) * Math.pow(Math.max(1, voices), -SPREAD);
  return { levels: on.map((x) => x * each), pans: track._voices.map((v) => pansOf(v)) };
}

/**
 * Plan one step: one band of latitude.
 * @returns {{events: [], hum, layers: {chords: {levels, pans}}, sea}}
 *   sea: {lat, temp (C), share (of the line that is sea), warmest {lon, temp, x}} for "Where am I?".
 */
export function planStep(track, seg, s) {
  const L = seg.frame._line[s];
  const chords = chordFor(track, L.temp, L.share, (v) => L.warm[L.mins.indexOf(v.min)]?.x ?? 0);
  const events = [];
  if (!Number.isNaN(L.temp) && s % MELODY_EVERY === 0) {
    const vel = 0.5 + 0.3 * L.share, at = L.warmest, lon = at?.lon ?? 0;
    events.push({ voice: 'sea', kind: 'sea', midi: melodyMidi(L.temp), velocity: vel, duration: 1.0, pan: 0, lat: L.lat, lon, offset: 0 });
    if (at && at.temp - L.temp >= WARM_OUTLIER) {
      events.push({ voice: 'sea', kind: 'sea', midi: melodyMidi(at.temp), velocity: vel * 0.9, duration: 0.8, pan: at.x, lat: L.lat, lon, offset: 0.12 });
    }
  }
  return {
    events,
    hum: { level: 0, pan: 0, under: loudness(L.share) },
    layers: { chords },
    sea: { lat: L.lat, temp: L.temp, share: L.share, warmest: L.warmest },
  };
}
