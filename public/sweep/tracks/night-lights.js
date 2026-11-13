// Track 01 — Night Lights: moving west->east sweep, one sweep per year, then the change map.
// Pure planning logic (no Tone.js): given the data under the scan line, decide what sounds.
//
// Modelled on NASA's Caldwell 73 sonification: a deep hum under ringing notes.
//  * the scan advances one 3° column at a time, so every note lands when the line crosses it;
//  * bright city cores ring a note; its pitch is the city's latitude band (north = higher);
//  * a deep hum swells with the total light under the line (near-silent over oceans);
//  * stereo runs ALONG the scan line: top of the line (north) = left ear, bottom = right.

import { scaleRange, clamp } from '../music.js';

export const BANDS = 20;
const ROWS_PER_BAND = 2;           // 2 grid rows (3° each) = 6° of latitude per band
const TOP_ROW = 6;                 // row 6 is centred on 70.5°N; band 19 = rows 6–7 … band 0 = rows 44–45
const E_MAJOR_PENTATONIC = [4, 6, 8, 11, 1];
export const BAND_NOTES = scaleRange(47, 100, E_MAJOR_PENTATONIC).slice(0, BANDS); // B2 … G#6
export const HUM_NOTES = [40, 47, 52, 56];   // E2 B2 E3 G#3 — an open E major drone

const ROW_MIN_LAT = -60;           // ignore Antarctica and the far Arctic (no cities, ice texture)
const ROW_MAX_LAT = 76;

/** Live-tunable (dev panel). */
export const params = {
  coreMin: 0.3,                    // a city core must be this bright to ring a note
  ring: 2.0,                       // seconds each note is held before its release
};

const MAX_NOTES = 3;               // per column
const EXTRA_MARGIN = 0.15;         // 2nd/3rd note in a column must clear coreMin by this much…
const EXTRA_MIN_BANDS = 3;         // …and sit at least 18° of latitude from the others
const CHANGE_MIN = 0.3;            // ~top 10% of changed cells
const CHANGE_PAIR = 0.5;           // strong change: add the rising/falling second note
const HUM_GATE = 0.08;             // below this the hum is silent: dark land / open ocean

export const voices = {
  note: { label: 'Notes', colour: 'var(--lamp)' },
  pad: { label: 'Hum', colour: 'var(--glow)' },
  gain: { label: 'Rising pair', colour: 'var(--gain)' },
  loss: { label: 'Falling cello', colour: 'var(--loss)' },
};

export const legendVoice = ['note', 'pad', 'gain', 'loss']; // order matches track legend items

export const view = 'sweep';        // a scan line that moves across a still map

/** Track-specific settings (dev panel). */
export function defaults(track) {
  return {
    yearSweep: track.chapters[0].secondsPerSweep,
    changeSweep: track.chapters.find((c) => c.id === 'change')?.secondsPerSweep ?? 18,
    coreMin: 0.3,
  };
}

export const devControls = {
  speed: [
    { key: 'yearSweep', label: 'Seconds per year sweep', min: 4, max: 40, step: 0.5, unit: 's' },
    { key: 'changeSweep', label: 'Seconds for change map', min: 6, max: 60, step: 0.5, unit: 's' },
  ],
  notes: [
    { key: 'coreMin', label: 'City brightness needed for a note (lower = more notes)', min: 0.1, max: 0.8, step: 0.01, unit: '' },
  ],
};

export function configure(settings) {
  params.coreMin = settings.coreMin;
  params.ring = settings.ring;
}

/** One segment per map; one step per 3° column. */
export function segments(track) {
  return track.chapters.flatMap((chapter) => chapter.frames.map((frame) => ({ chapter, frame, steps: track.grid.cols })));
}

export function segmentSeconds(track, seg, settings) {
  return seg.chapter.id === 'change' ? settings.changeSweep : settings.yearSweep;
}

export const segmentLabel = (seg) => (seg.chapter.id === 'years' ? seg.frame.label : 'Change');
export const segmentAria = (seg) => (seg.chapter.id === 'years'
  ? `${seg.frame.label}, ${Math.round(seg.dur)}-second sweep`
  : `Change map 2012 to 2023, ${Math.round(seg.dur)}-second sweep`);

const rowLat = (g, r) => g.latNorth - (r + 0.5) * g.cellDeg;
const inRange = (g, r) => { const lat = rowLat(g, r); return lat >= ROW_MIN_LAT && lat <= ROW_MAX_LAT; };

/** Latitude band (0 = south … 19 = north) of a grid row; rows beyond the range clamp to the edges. */
export function bandOfRow(r) {
  return clamp(BANDS - 1 - Math.floor((r - TOP_ROW) / ROWS_PER_BAND), 0, BANDS - 1);
}

const noteOfRow = (r) => BAND_NOTES[bandOfRow(r)];

function lightSource(fr) {
  return fr._glow ? (i) => fr._glow[i] : (i) => fr._gain[i] + fr._loss[i];
}

/** Decode compact int arrays once and compute each chapter's loudness scales. */
export function prepare(track) {
  const g = track.grid;
  const toF = (a) => Float32Array.from(a, (v) => v / 100);
  for (const ch of track.chapters) {
    const colSums = [], cells = [];
    for (const fr of ch.frames) {
      for (const k of ['core', 'glow', 'gain', 'loss']) if (fr[k]) fr[`_${k}`] = toF(fr[k]);
      const val = lightSource(fr);
      for (let c = 0; c < g.cols; c++) {
        let s = 0;
        for (let r = 0; r < g.rows; r++) {
          if (!inRange(g, r)) continue;
          const v = val(r * g.cols + c);
          s += v;
          if (v > 0) cells.push(v);
        }
        colSums.push(s);
      }
    }
    colSums.sort((a, b) => a - b);
    cells.sort((a, b) => a - b);
    ch._humNorm = Math.max(1e-6, colSums[Math.floor(colSums.length * 0.95)] ?? 1);
    ch._rowNorm = Math.max(1e-6, cells[Math.floor(cells.length * 0.97)] ?? 1);
  }
  return track;
}

/** Light 0..1 in each grid row of column c — the shape drawn on the scan line. */
export function rowLevels(track, chapter, frame, c, out = new Float32Array(track.grid.rows)) {
  const g = track.grid;
  const val = lightSource(frame);
  for (let r = 0; r < g.rows; r++) {
    out[r] = inRange(g, r) ? Math.min(1, Math.sqrt(val(r * g.cols + c) / chapter._rowNorm)) : 0;
  }
  return out;
}

/** Hum loudness 0..1 and where along the line the light sits (-1 = top/north … +1 = bottom/south). */
function hum(track, chapter, frame, c) {
  const g = track.grid;
  const val = lightSource(frame);
  let sum = 0, moment = 0;
  for (let r = 0; r < g.rows; r++) {
    if (!inRange(g, r)) continue;
    const v = val(r * g.cols + c);
    sum += v;
    moment += v * (((r + 0.5) / g.rows) * 2 - 1);
  }
  const level = clamp(Math.sqrt(sum / chapter._humNorm), 0, 1);
  return { level: level < HUM_GATE ? 0 : level, pan: sum > 0 ? moment / sum : 0 };
}

/** Rows that are local maxima above `min`, strongest first. */
function peaks(arr, g, c, min) {
  const out = [];
  for (let r = 0; r < g.rows; r++) {
    if (!inRange(g, r)) continue;
    const v = arr[r * g.cols + c];
    const up = r > 0 ? arr[(r - 1) * g.cols + c] : 0;
    const down = r < g.rows - 1 ? arr[(r + 1) * g.cols + c] : 0;
    if (v >= min && v >= up && v >= down) out.push({ r, v });
  }
  return out.sort((a, b) => b.v - a.v);
}

/**
 * Plan one scan step (one column).
 * @returns {{events: Array, hum: {level: number, pan: number}}}
 *   events: {voice: 'notes'|'cello', kind, midi, velocity, offset (s), duration (s), row, col}
 */
export function planStep(track, seg, c) {
  const { chapter, frame } = seg;
  const g = track.grid;
  const events = [];
  const ring = params.ring;

  // Every chapter but the change map is a map of light (night lights by year, lightning by month).
  if (chapter.id !== 'change') {
    const min = params.coreMin;
    const chosen = [];
    for (const q of peaks(frame._core, g, c, min)) {
      if (chosen.length >= MAX_NOTES) break;
      const far = chosen.every((o) => Math.abs(bandOfRow(q.r) - bandOfRow(o.r)) >= EXTRA_MIN_BANDS);
      if (chosen.length === 0 || (q.v >= min + EXTRA_MARGIN && far)) chosen.push(q);
    }
    chosen.forEach((q, i) => {
      const t = clamp((q.v - min) / (1 - min), 0, 1);
      events.push({
        voice: 'notes', kind: 'note', row: q.r, col: c, midi: noteOfRow(q.r),
        velocity: 0.22 + 0.62 * Math.pow(t, 0.8), offset: i * 0.03, duration: ring,
      });
    });
  } else {
    const gp = peaks(frame._gain, g, c, CHANGE_MIN)[0];
    if (gp) {
      const b = bandOfRow(gp.r);
      const vel = 0.2 + 0.55 * gp.v;
      events.push({ voice: 'notes', kind: 'gain', row: gp.r, col: c, midi: BAND_NOTES[b], velocity: vel, offset: 0, duration: ring });
      if (gp.v >= CHANGE_PAIR) {
        events.push({ voice: 'notes', kind: 'gain', row: gp.r, col: c, midi: BAND_NOTES[Math.min(b + 1, BANDS - 1)],
          velocity: vel * 0.7, offset: 0.11, duration: ring });
      }
    }
    const lp = peaks(frame._loss, g, c, CHANGE_MIN)[0];
    if (lp) {
      const b = bandOfRow(lp.r);
      const vel = 0.25 + 0.55 * lp.v;
      events.push({ voice: 'cello', kind: 'loss', row: lp.r, col: c, midi: BAND_NOTES[b] - 12, velocity: vel, offset: 0.04, duration: 1.4 });
      if (lp.v >= CHANGE_PAIR) {
        events.push({ voice: 'cello', kind: 'loss', row: lp.r, col: c, midi: BAND_NOTES[Math.max(b - 1, 0)] - 12,
          velocity: vel * 0.6, offset: 0.3, duration: 1.6 });
      }
    }
  }
  for (const ev of events) {           // where the note sits on screen (0..1) and along the line (-1..1)
    ev.x = (ev.col + 0.5) / g.cols;
    ev.y = (ev.row + 0.5) / g.rows;
    ev.pos = ev.y * 2 - 1;
  }
  return { events, hum: hum(track, chapter, frame, c) };
}

/** Geometry and light levels of the scan line at fraction p of the segment (for drawing). */
let colA, colB;
export function lineShape(track, seg, p, shape) {
  const g = track.grid;
  if (!shape.ys || shape.ys.length !== g.rows) {
    shape.ys = Float32Array.from({ length: g.rows }, (_, r) => (r + 0.5) / g.rows);
    shape.levels = new Float32Array(g.rows);
    colA = new Float32Array(g.rows); colB = new Float32Array(g.rows);
  }
  const fc = p * g.cols - 0.5;
  const c0 = clamp(Math.floor(fc), 0, g.cols - 1);
  const c1 = Math.min(g.cols - 1, c0 + 1);
  const f = clamp(fc - c0, 0, 1);
  rowLevels(track, seg.chapter, seg.frame, c0, colA);
  rowLevels(track, seg.chapter, seg.frame, c1, colB);
  for (let r = 0; r < g.rows; r++) shape.levels[r] = colA[r] + (colB[r] - colA[r]) * f;
  shape.x = p; shape.y0 = 0; shape.y1 = 1;
  shape.dir = 1;           // bends ahead of the line, toward the east
  shape.maxW = 0.022;
  return shape;
}

const fmtLon = (lon) => {
  const a = Math.round(Math.abs(lon));
  return a === 0 || a === 180 ? `${a}°` : `${a}° ${lon < 0 ? 'W' : 'E'}`;
};

/** Text over the map. */
export function readout(track, seg, p, started) {
  return {
    frame: segmentLabel(seg),
    sub: seg.chapter.title,
    scan: started ? `Scanning ${fmtLon(-180 + p * 360)}` : 'West → East',
  };
}

/** Text for the live region when a new frame starts. */
export function describe(track, seg) {
  const { chapter, frame } = seg;
  if (chapter.id === 'years') {
    const pct = Math.round((frame.relativeTotal - 1) * 100);
    const rel = frame.label === track.chapters[0].frames[0].label
      ? 'baseline year'
      : `${pct >= 0 ? pct + '% brighter' : -pct + '% dimmer'} than 2012 in this visualization`;
    return `${frame.label}: ${rel}.`;
  }
  return 'Change map, 2012 to 2023: a rising pair of notes for new lights, a falling cello for lights that dimmed.';
}
