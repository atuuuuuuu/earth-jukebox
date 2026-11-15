// Track 07 — Perpetual Ocean 2: a camera tour, read along a fixed vertical line through the middle
// of NASA's picture. Pure planning logic (no Tone.js), modelled on tracks/co2.js.
// The atmospheric river film (mapping "river") plays the same way: hum = water vapour, notes = the
// river's deep-blue core, pulse = each midnight on NASA's clock.
//
//  * swell (the hum) = all the bright moving water on the line; calm sea is soft, never silent;
//  * harp notes = a current or eddy crossing the line, rung once at its brightest moment;
//    pitch = height in the picture (top = higher), in a calm D major pentatonic: no tension, because
//    this track is about the ocean's beauty and connection;
//  * a soft low pulse at the start of each month, so three years can be heard passing;
//  * stereo runs along the line: top = left ear, bottom = right ear.

import { scaleRange, clamp } from '../music.js';

export const HUM_NOTES = [38, 45, 50, 54];   // D2 A2 D3 F#3: an open, warm drone
const ROWS_PER_BAND = 3;
const SCALE = scaleRange(45, 100, [2, 4, 6, 9, 11]);   // D major pentatonic, from A2 up
const CREST_REACH = 4;                       // a note marks the brightest moment within ±4 steps (about a day)
const MAX_NOTES = 2;
const HUM_FLOOR = 0.08;

export const params = { noteMin: 0.65, ring: 2.4 };

export function defaults(track) {
  return { orbitSeconds: track.media.duration, noteMin: 0.65, beat: -2, notes: -2, ring: 2.4 };
}

export function configure(settings) {
  params.noteMin = settings.noteMin;
  params.ring = settings.ring;
}

export function prepare(track) {
  const { rows, steps } = track;
  const toF = (a) => Float32Array.from(a, (v) => v / 100);
  track._line = toF(track.line);
  track._peak = toF(track.peak);
  const bands = Math.ceil(rows / ROWS_PER_BAND);
  track._bands = bands;
  track._bandNotes = SCALE.slice(0, bands);
  track._rowPos = Float32Array.from({ length: rows }, (_, r) => ((r + 0.5) / rows) * 2 - 1);
  track._bandPeak = new Float32Array(steps * bands);
  track._bandRow = new Uint8Array(steps * bands);
  const sums = [];
  for (let s = 0; s < steps; s++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      const b = Math.floor(r / ROWS_PER_BAND), v = track._peak[s * rows + r];
      if (v > track._bandPeak[s * bands + b]) { track._bandPeak[s * bands + b] = v; track._bandRow[s * bands + b] = r; }
      sum += track._line[s * rows + r];
    }
    sums.push(sum);
  }
  sums.sort((a, b) => a - b);
  track._humLo = sums[Math.floor(sums.length * 0.08)];
  track._humHi = Math.max(track._humLo + 1e-6, sums[Math.floor(sums.length * 0.97)]);
  const start = Date.parse(`${track.startDate}T00:00:00Z`);
  // The date at step s (whole or fractional): NASA's own clock when the backend read one
  // (atmospheric river: it races, stops and replays), else evenly spaced days (ocean tour).
  track._ms = track.minutes ? (s) => start + Math.round(clockAt(track.minutes, s)) * 6e4 : (s) => start + s * track.daysPerStep * 864e5;
  // The pulse: each midnight on a clock read from NASA, else the start of each month.
  track._pulseOf = track.minutes ? (s) => Math.floor(track._ms(s) / 864e5)
    : (s) => { const d = new Date(track._ms(s)); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  return track;
}

export function segments(track) {
  const chapter = track.chapters[0];
  return chapter.frames.map((frame) => ({ chapter, frame, steps: frame.steps }));
}

export function segmentSeconds(track, seg, settings) {
  return (settings.orbitSeconds * seg.steps) / track.steps;
}

function isCrest(track, s, b, v) {
  const { _bandPeak: bp, _bands: bands, steps } = track;
  for (let d = 1; d <= CREST_REACH; d++) {
    if (s - d >= 0 && bp[(s - d) * bands + b] >= v) return false;
    if (s + d < steps && bp[(s + d) * bands + b] > v) return false;
  }
  return true;
}

export function planStep(track, seg, step) {
  const { rows, _bands: bands } = track;
  const s = seg.frame.startStep + step;
  let sum = 0, moment = 0;
  for (let r = 0; r < rows; r++) {
    const v = track._line[s * rows + r];
    sum += v;
    moment += v * track._rowPos[r];
  }
  const rel = clamp((sum - track._humLo) / (track._humHi - track._humLo), 0, 1);
  const level = HUM_FLOOR + (1 - HUM_FLOOR) * Math.pow(rel, 0.75);

  const crests = [];
  for (let b = 0; b < bands; b++) {
    const v = track._bandPeak[s * bands + b];
    if (v >= params.noteMin && isCrest(track, s, b, v)) crests.push({ b, v });
  }
  crests.sort((a, c) => c.v - a.v);
  const chosen = [];
  for (const q of crests) {
    if (chosen.length >= MAX_NOTES) break;
    if (chosen.every((o) => Math.abs(o.b - q.b) >= 2)) chosen.push(q);
  }
  const events = chosen.map((q, i) => {
    const row = track._bandRow[s * bands + q.b];
    const t = clamp((q.v - params.noteMin) / (1 - params.noteMin), 0, 1);
    return {
      voice: 'notes', kind: 'note', midi: track._bandNotes[bands - 1 - q.b],   // band 0 = top = highest
      velocity: 0.22 + 0.6 * Math.pow(t, 0.8), offset: i * 0.05, duration: params.ring,
      x: 0.5, y: (row + 0.5) / rows, pos: track._rowPos[row], vx: 0,
    };
  });
  const beat = s > 0 && track._pulseOf(s) !== track._pulseOf(s - 1) ? 0.5 + 0.3 * level : 0;
  return { events, hum: { level, pan: sum > 0 ? moment / sum : 0, tension: 0 }, beat };
}

// Minutes on NASA's clock between two read steps: the frames in between run evenly (at the start
// the clock moves 87 minutes a frame), unless the clock jumps back or stands still there.
function clockAt(m, s) {
  const i = Math.floor(s), a = m[i], b = m[Math.min(i + 1, m.length - 1)];
  return b > a && b - a < 600 ? a + (s - i) * (b - a) : a;
}

/** The date shown at step s, like "3 Mar 2022", or with NASA's clock "11 Dec 2010, 18:43 UTC". */
export function dateAt(track, s) {
  const d = new Date(track._ms(clamp(s, 0, track.steps - 1)));
  const day = `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
  return track.minutes ? `${day}, ${d.toISOString().slice(11, 16)} UTC` : day;
}
