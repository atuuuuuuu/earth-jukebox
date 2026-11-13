// Track 06 — Carbon dioxide on a turning globe: SPIN SWEEP.
// A fixed line runs pole to pole through the globe's centre; the turning Earth carries the
// data under it. Pure planning logic (no Tone.js).
//
//  * deep hum = all the CO2 on the line; it turns tense over the densest plumes
//    ("bad news gets less calm");
//  * ringing notes = dense plumes, played once as their thickest part crosses the line;
//    pitch = latitude band (north = higher), the very densest ring in E minor;
//  * soft heartbeat = one double beat per day of data (midnight UTC);
//  * stereo runs along the line: top (north) = left ear, bottom (south) = right ear.

import { scaleRange, clamp } from '../music.js';

export const view = 'spin';
export const HUM_NOTES = [40, 47, 52, 56];   // E2 B2 E3 G#3

const ROWS_PER_BAND = 3;                     // 3 rows of 3° = 9° of latitude per note
const E_MAJOR_PENTATONIC = [4, 6, 8, 11, 1];
const SCALE = scaleRange(47, 100, E_MAJOR_PENTATONIC);   // B2 upward
const MINOR_SHIFT = new Set([6, 8, 1]);      // F#, G#, C# -> G, A, D turns the scale into E minor
const HOT = 0.88;                            // plumes this dense ring in minor
const CREST_REACH = 4;                       // a note needs to be the densest moment within ±4 steps (±12 h)
const MAX_NOTES = 2;                         // per step
const HUM_FLOOR = 0.1;                       // carbon dioxide is never absent: the hum only gets quiet
const START = Date.UTC(2020, 0, 14);         // midnight before the first frame; hours are added to it
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Live-tunable (dev panel). */
export const params = { noteMin: 0.45, ring: 2.0, tension: 1 };

export function defaults(track) {
  // notes sit 3 dB lower than on Night Lights: dense plumes often ring two at a time
  return { orbitSeconds: track.media.duration, noteMin: 0.45, tension: 1, beat: 0, notes: -3 };
}

export const devControls = {
  speed: [
    { key: 'orbitSeconds', label: 'Seconds for the whole orbit', min: 20, max: 160, step: 1, unit: 's' },
  ],
  levels: [
    { key: 'beat', label: 'Heartbeat', min: -24, max: 12, step: 0.5, unit: 'dB' },
  ],
  notes: [
    { key: 'noteMin', label: 'CO₂ level needed for a note (lower = more notes)', min: 0.15, max: 0.9, step: 0.01, unit: '' },
    { key: 'tension', label: 'Tension over dense plumes', min: 0, max: 1, step: 0.05, unit: '' },
  ],
};

export function configure(settings) {
  params.noteMin = settings.noteMin;
  params.ring = settings.ring;
  params.tension = settings.tension;
}

export const voices = {
  pad: { label: 'Hum', colour: 'var(--glow)' },
  note: { label: 'Notes', colour: 'var(--lamp)' },
  beat: { label: 'Heartbeat', colour: 'var(--text)' },
};
export const legendVoice = ['pad', 'note', 'beat'];

export function prepare(track) {
  const { rows, steps } = track;
  const toF = (a) => Float32Array.from(a, (v) => v / 100);
  track._line = toF(track.line);
  track._peak = toF(track.peak);
  const bands = Math.ceil(rows / ROWS_PER_BAND);
  track._bands = bands;
  track._bandNotes = SCALE.slice(0, bands);

  // Screen position of each latitude row along the line (orthographic view of the central meridian).
  const g = track.globe;
  track._rowY = new Float32Array(rows);      // 0..1 of frame height
  track._rowPos = new Float32Array(rows);    // -1 (top/north) .. +1 (bottom/south)
  for (let r = 0; r < rows; r++) {
    const lat = track.latTop - track.latStep * (r + 0.5);
    const s = Math.sin(((lat - g.lat0) * Math.PI) / 180);
    track._rowY[r] = g.cy - g.r * s;
    track._rowPos[r] = -s;
  }

  // Per band and step: the densest value, and which row holds it.
  track._bandPeak = new Float32Array(steps * bands);
  track._bandRow = new Uint8Array(steps * bands);
  const sums = [];
  for (let s = 0; s < steps; s++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      const b = Math.floor(r / ROWS_PER_BAND);
      const v = track._peak[s * rows + r];
      if (v > track._bandPeak[s * bands + b]) { track._bandPeak[s * bands + b] = v; track._bandRow[s * bands + b] = r; }
      sum += track._line[s * rows + r];
    }
    sums.push(sum);
  }
  // Hum loudness is relative to this track's own range: clean ocean air (8th percentile of
  // steps) is quiet, the densest crossings (97th percentile) are full.
  sums.sort((a, b) => a - b);
  track._humLo = sums[Math.floor(sums.length * 0.08)];
  track._humHi = Math.max(track._humLo + 1e-6, sums[Math.floor(sums.length * 0.97)]);
  return track;
}

/** One segment per week of data. */
export function segments(track) {
  const chapter = track.chapters[0];
  return chapter.frames.map((frame) => ({ chapter, frame, steps: frame.steps }));
}

export function segmentSeconds(track, seg, settings) {
  return (settings.orbitSeconds * seg.steps) / track.steps;
}

export const segmentLabel = (seg) => seg.frame.label;
export const segmentAria = (seg) => `${seg.frame.ariaLabel}, ${Math.round(seg.dur)} seconds`;

function isCrest(track, s, b, v) {
  const { _bandPeak: bp, _bands: bands, steps } = track;
  for (let d = 1; d <= CREST_REACH; d++) {
    if (s - d >= 0 && bp[(s - d) * bands + b] >= v) return false;      // an earlier step was at least as dense
    if (s + d < steps && bp[(s + d) * bands + b] > v) return false;    // a later step is denser
  }
  return true;
}

/**
 * Plan one step (3 hours of data).
 * @returns {{events: Array, hum: {level, pan, tension}, beat: number}}
 */
export function planStep(track, seg, step) {
  const { rows, _bands: bands, globe } = track;
  const s = seg.frame.startStep + step;

  // hum: everything on the line
  let sum = 0, moment = 0, t1 = 0, t2 = 0, t3 = 0;
  for (let r = 0; r < rows; r++) {
    const v = track._line[s * rows + r];
    sum += v;
    moment += v * track._rowPos[r];
    if (v > t1) { t3 = t2; t2 = t1; t1 = v; } else if (v > t2) { t3 = t2; t2 = v; } else if (v > t3) t3 = v;
  }
  const rel = clamp((sum - track._humLo) / (track._humHi - track._humLo), 0, 1);
  const level = HUM_FLOOR + (1 - HUM_FLOOR) * Math.pow(rel, 0.75);
  // tension follows the densest 9° of the line, so only real plumes sour the hum
  const tension = clamp(((t1 + t2 + t3) / 3 - 0.45) / 0.35, 0, 1) * params.tension;

  // notes: plume crests
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
  // the surface drifts east (right) under the line; rings ride along with it
  const degPerSecond = Math.abs(track.lonPerStep) / (seg.stepDur || 0.1);
  const events = chosen.map((q, i) => {
    const row = track._bandRow[s * bands + q.b];
    const hot = q.v >= HOT && params.tension > 0;
    let midi = track._bandNotes[bands - 1 - q.b];           // band 0 is the northernmost = highest note
    if (hot && MINOR_SHIFT.has(((midi % 12) + 12) % 12)) midi += 1;
    const t = clamp((q.v - params.noteMin) / (1 - params.noteMin), 0, 1);
    const cosLat = Math.sqrt(1 - track._rowPos[row] ** 2);
    return {
      voice: 'notes', kind: hot ? 'hot' : 'note', meter: 'note', midi,
      velocity: 0.25 + 0.6 * Math.pow(t, 0.8), offset: i * 0.03, duration: params.ring,
      x: globe.cx, y: track._rowY[row], pos: track._rowPos[row],
      vx: (globe.r / track.media.aspect) * ((degPerSecond * Math.PI) / 180) * cosLat,
    };
  });

  // heartbeat: this step contains midnight UTC
  const h0 = track.startHourUTC + s * track.hoursPerStep;
  const beat = Math.floor((h0 + track.hoursPerStep - 1) / 24) > Math.floor((h0 - 1) / 24) ? 0.55 + 0.35 * level : 0;

  return { events, hum: { level, pan: sum > 0 ? moment / sum : 0, tension }, beat };
}

/** Geometry and CO2 levels of the scan line at fraction p of the segment (for drawing). */
export function lineShape(track, seg, p, shape) {
  const { rows, steps, globe } = track;
  if (!shape.ys || shape.ys.length !== rows) {
    shape.ys = track._rowY;
    shape.levels = new Float32Array(rows);
  }
  const fs = clamp(seg.frame.startStep + p * seg.steps - 0.5, 0, steps - 1);
  const s0 = Math.floor(fs), s1 = Math.min(steps - 1, s0 + 1), f = fs - s0;
  for (let r = 0; r < rows; r++) {
    const a = track._line[s0 * rows + r], b = track._line[s1 * rows + r];
    shape.levels[r] = Math.min(1, Math.sqrt(a + (b - a) * f) * 1.15);
  }
  shape.x = globe.cx; shape.y0 = globe.cy - globe.r; shape.y1 = globe.cy + globe.r;
  shape.dir = -1;          // the surface arrives from the left, so the line bends to meet it
  shape.maxW = 0.05;
  return shape;
}

const fmtLon = (lon) => {
  const a = Math.round(Math.abs(lon) / 5) * 5;
  return a === 0 || a === 180 ? `${a}°` : `${a}° ${lon < 0 ? 'W' : 'E'}`;
};

function dateAt(track, seg, p) {
  const hours = track.startHourUTC + (seg.frame.startStep + p * seg.steps) * track.hoursPerStep;
  const d = new Date(START + hours * 3600e3);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Text over the globe. */
export function readout(track, seg, p) {
  const lon = track.lonAtStep0 + track.lonPerStep * (seg.frame.startStep + p * seg.steps);
  return { frame: dateAt(track, seg, p), sub: seg.chapter.title, scan: `Line over about ${fmtLon(lon)}` };
}

/** Text for the live region when a new week starts. */
export function describe(track, seg) {
  const f = seg.frame;
  return `Week from ${f.from}: the line crosses ${f.region}. Carbon dioxide on the line is ${Math.round(f.relative * 100)}% of the busiest week.`;
}
