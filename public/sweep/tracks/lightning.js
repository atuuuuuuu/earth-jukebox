// Track 07 — Lightning, "Orchestral storms": a west->east sweep per part of NASA's record.
// Pure planning logic (no Tone.js): given the data under the scan line, decide what sounds.
//
// Like NASA's Butterfly Nebula sonification, a sustained texture sits under distinct notes
// (dark but calm: lightning is not bad news, so every chord is consonant):
//  * soft harp notes = the MARKS. Every lightning mark in NASA's movie (counted once, in
//    backend/eic) is a quiet, short, muted note as the line crosses it; pitch = latitude. Marks
//    crossed nearly together become a soft, quick flurry, so none is silently dropped;
//  * storm wind = how many marks are CLOSE to the line, with slow swells and fades;
//  * deep bass = HOW MUCH of the map under the line is lit, smoothed over about 2 seconds;
//    a soft floor stays over calm ocean;
//  * strings = WHERE, moment by moment: each band of latitude has its own sustained string note
//    (higher = farther north) that swells while lightning there is under the line, like the
//    Butterfly's strings following the gas; the notes are tones of the E flat, A flat or B flat chord.
// Stereo follows the scan line itself: left ear at the western edge, right ear at the eastern
// edge. North and south are heard as pitch, never as left and right.
//
// Compare mode (params.compare) plays a second kind of sweep over the same places: the change
// from the previous part, a short rising figure where lightning grew and a falling one where it
// shrank, on one fixed scale for the whole track. Places that stayed the same are quiet.

import { scaleRange, clamp } from '../music.js';

export const HUM_NOTES = [];        // no synth hum on this track: the bed is bowed samples
export const COMPARE = true;        // this mapping has a "compare with previous part" pass

// ---- pitch: E flat pentatonic, one note per 6 degrees of latitude, 57 N … 57 S ----
const EB_PENTATONIC = [3, 5, 7, 10, 0];              // Eb F G Bb C
const SCALE = scaleRange(39, 101, EB_PENTATONIC);    // Eb2 … F7: room for figures above and below
export const BANDS = 19;
const BAND_DEG = 6;
const TOP_LAT = 57;
const LOW_NOTE = 46;                                 // Bb2: the southernmost band
export const BAND_NOTES = SCALE.slice(SCALE.indexOf(LOW_NOTE), SCALE.indexOf(LOW_NOTE) + BANDS);  // Bb2 … F6

/** Latitude band of a latitude: 0 = farthest south … 18 = farthest north. */
export const bandOfLat = (lat) => clamp(BANDS - 1 - Math.floor((TOP_LAT - lat) / BAND_DEG), 0, BANDS - 1);
/** The note for a latitude (north = higher). */
export const noteForLat = (lat) => BAND_NOTES[bandOfLat(lat)];

// ---- marks: quiet, short, muted notes ----
// Levels set by offline render: the marks together sit below the bass and strings, a lone mark
// still stands clear of the bass floor over calm ocean, and busier bands murmur a little louder.
const MARK = {
  duration: 0.08,       // held this long, then the sampler's short release (audio.js)
  lone: 0.16,           // velocity of a lone mark: quiet, but clear over calm ocean
  crowd: 0.24,          // velocity of the first note of a crowded band (8 marks or more)
  gap: 0.034,           // seconds between the notes of one flurry
  perBand: 3,           // a flurry in one band is at most this many notes…
  perStep: 14,          // …and one step at most this many, but every band with marks gets a note
};

// ---- the bed: wind, bass and strings ----
export const BED_FLOOR = 0.14;     // bass level over calm ocean: soft, never silent
const SMOOTH_SECONDS = 2;          // the bass follows the lightning averaged over about this long
const WINDOW_SECONDS = 2.5;        // one chord, and one string swell, about this often
const BED_PERCENTILE = 0.95;       // column totals at or above this percentile play the bed in full
const WIND_REACH = 4;              // degrees of longitude each side of the step: the wind's "close to the line"
const WIND_PERCENTILE = 0.95;      // windows with this many marks or more blow the wind in full
// One chord per window, round and round. The bass stays on E flat and drops to D under B flat
// (D is that chord's third), then pulls back up: every chord is a plain major triad.
const PROGRESSION = ['Eb', 'Ab', 'Eb', 'Bb'];
const TRIADS = { Eb: [3, 7, 10], Ab: [8, 0, 3], Bb: [10, 2, 5] };
const BASS = { Eb: 27, Ab: 27, Bb: 26 };   // E flat 1, and D1 under B flat
const BASS_FIFTH = 34;             // B flat 1, added over the heaviest lightning (E flat pedal only)
// Bass bow strokes: seconds held before the sampler's slow fade-out (audio.js).
const BOW = { bass: { duration: 1.6, short: 1.0 } };   // two per chord, overlapping: a steady pedal

// ---- strings: WHERE, as in NASA's Butterfly Nebula sonification ----
// Each stretch of latitude has its own sustained string note, higher farther north. A note swells
// while the lightning in its latitudes is under the scan line and fades when it leaves, step by step
// (every 3° of the sweep), so the strings rise and fall as the storms do. The notes are the current
// chord's tones, from E flat 3 upward, so they stay consonant with the bass.
export const STRING_BANDS = 8;
const STRING_TOP = 54;                               // band 0 = 54 N to 40.5 N … band 7 = 40.5 S to 54 S
const STRING_DEG = (2 * STRING_TOP) / STRING_BANDS;  // 13.5°
const STRING_REACH = 1;            // columns each side (±3°, about ±0.2 s): steady but still in real time
const STRING_PERCENTILE = 0.95;    // a band this full of lightning plays its note in full
const STRING_GATE = 0.06;          // below this share a band is silent
const LADDERS = Object.fromEntries(Object.entries(TRIADS).map(([name, pcs]) => [name, scaleRange(51, 96, pcs).slice(0, STRING_BANDS)]));
/** String band of a latitude: 0 = farthest north … STRING_BANDS - 1 = farthest south. */
export const stringBandOfLat = (lat) => clamp(Math.floor((STRING_TOP - lat) / STRING_DEG), 0, STRING_BANDS - 1);
/** The string note of a band under a chord: the northernmost band plays the highest chord tone. */
export const stringNote = (band, chord = 'Eb') => (LADDERS[chord] ?? LADDERS.Eb)[STRING_BANDS - 1 - band];
/** Level 0..1 of a band for a share `rel` of the track's fullest bands: quiet spread-out lightning stays soft. */
export const stringLevel = (rel) => (rel < STRING_GATE ? 0 : Math.pow(clamp(rel, 0, 1), 1.3));

// ---- compare mode ----
const DIFF_PERCENTILE = 0.98;      // this share of all changes, over every pair of parts, is below full scale
const CHANGE_MIN = 0.18;           // changes smaller than this (of full scale) stay quiet
const CHANGE_BIG = 0.55;           // from here a figure has three notes and climbs or falls further
const CHANGE_REACH = { cols: 3, rows: 2 };   // one changed area plays once, at its strongest cell
const CHANGE_PER_STEP = 2;         // per direction
const COMPARE_FIRST_SECONDS = 3;   // part 1 has nothing to compare with: a short, quiet pass

/** Live-tunable. */
export const params = { compare: false };

export function defaults(track) {
  return {
    yearSweep: track.chapters[0].secondsPerSweep,
    bed: 'orchestra',              // tells the audio engine to build the wind, bass and strings
    stringBands: STRING_BANDS,     // …one string voice per band of latitude
    sweepPan: true,                // …and to pan with the scan line, west = left
    bedFloor: BED_FLOOR,
    compare: false,
    notesReverb: 0.45,             // the harp notes sit back in the hall, but stay distinct
    notes: -5,                     // the marks murmur under the bed (dB); compare mode adds compareBoost
    compareBoost: 5,               // …so its rising and falling figures, the only notes there, are clear
    ring: 0.5,                     // short release for the muted notes
  };
}

export function configure(settings) {
  params.compare = !!settings.compare;
}

/** One segment per part; one step per 3° column. */
export function segments(track) {
  return track.chapters.flatMap((chapter) => chapter.frames.map((frame) => ({ chapter, frame, steps: track.grid.cols })));
}

export function segmentSeconds(track, seg, settings) {
  const first = seg.index === 0 || (seg.index === undefined && seg.frame === seg.chapter.frames[0]);
  return settings.compare && first ? Math.min(COMPARE_FIRST_SECONDS, settings.yearSweep) : settings.yearSweep;
}

/** Bass level 0..1 for a share `rel` (0..1) of the heaviest lightning: never below the floor. */
export const bedLevel = (rel) => BED_FLOOR + (1 - BED_FLOOR) * Math.pow(clamp(rel, 0, 1), 0.7);
/** Wind level 0..1 for a share `rel` (0..1) of the busiest stretch of marks. */
export const windLevel = (rel) => Math.pow(clamp(rel, 0, 1), 0.8);

/**
 * The bass bow stroke of the bed at one moment, as a one-event list. The audio engine re-bows
 * when its last stroke is `period` seconds old, or when `tag` changes, so the same event can be
 * sent on every step.
 */
export function bedEvents(rel, chordName, tag, period) {
  const bass = BASS[chordName] ?? BASS.Eb;
  const bassNotes = [[bass, 0.9], [bass + 12, 0.3 + 0.5 * rel]];
  if (bass === 27 && rel > 0.5) bassNotes.push([BASS_FIFTH, 0.7 * (rel - 0.5)]);
  return [{
    voice: 'bass', bed: true, tag, period, midi: bass, sub: bass, notes: bassNotes,
    duration: BOW.bass.duration, velocity: 0.9, offset: 0,
  }];
}

/**
 * The strings for one moment: a level 0..1 and a note for every band of latitude. Bands are
 * 0 = north … STRING_BANDS - 1 = south; `chord` names the harmony, `tag` changes with it.
 */
export function stringsAt(levels, chord, tag) {
  return { levels: Array.from(levels), notes: levels.map((_, b) => stringNote(b, chord)), tag };
}

/** One string band lit at latitude `lat`, at level `level` (for one spot and the examples). */
export function stringsForLat(lat, level, chord = 'Eb', tag = 'spot') {
  const levels = new Array(STRING_BANDS).fill(0);
  levels[stringBandOfLat(lat)] = level;
  return stringsAt(levels, chord, tag);
}

/** How many notes a band's marks get in one step: one each for the first marks, at most MARK.perBand. */
export const notesForMarks = (n) => Math.min(MARK.perBand, n);

/**
 * The notes for `n` marks of one band at times `times` (seconds; one per mark, or fewer when
 * crowded): a lone mark is one quiet note, many marks a soft, quick flurry.
 * Returns [{offset, velocity}] in time order.
 */
export function flurry(n, times, count = notesForMarks(n)) {
  const vel = clamp(MARK.lone + 0.03 * Math.log2(n), MARK.lone, MARK.crowd);
  const out = [];
  // Expand: each mark at its own time, repeats at the same time a short gap apart (no more repeats
  // than notes to play); then thin evenly to `count`, so a crowd keeps its shape in time.
  const all = [];
  for (const [t, k] of times) for (let j = 0; j < Math.min(k, count); j++) all.push(t + j * MARK.gap);
  all.sort((a, b) => a - b);
  const pick = all.length <= count ? all : [...Array(count)].map((_, i) => all[Math.floor(((i + 0.5) * all.length) / count)]);
  let last = -1;
  pick.forEach((t, i) => {
    const at = Math.max(t, last + MARK.gap);   // never two notes of one band closer than the gap
    last = at;
    out.push({ offset: at, velocity: vel * (1 - 0.07 * i) });
  });
  return out;
}

/** A rising (dz > 0) or falling (dz < 0) figure for a change of size |dz| (0..1) at latitude lat. */
export function changeFigure(dz, lat) {
  const up = dz > 0, a = Math.abs(dz);
  const start = SCALE.indexOf(noteForLat(lat));
  const big = a >= CHANGE_BIG;
  const stepSize = big ? 2 : 1;
  const count = big ? 3 : 2;
  const velocity = 0.2 + 0.55 * Math.pow(clamp(a, 0, 1), 0.8);
  return [...Array(count)].map((_, i) => ({
    midi: SCALE[clamp(start + (up ? 1 : -1) * i * stepSize, 0, SCALE.length - 1)],
    offset: i * 0.075,
    velocity: velocity * (i === count - 1 ? 1 : 0.85),
    duration: 0.12,
  }));
}

const percentile = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };

/** Decode the compact int arrays once; add up columns and bands; set the track's own fixed scales. */
export function prepare(track) {
  const g = track.grid, mg = track.markGrid;
  const lats = Float32Array.from({ length: g.rows }, (_, r) => g.latNorth - (r + 0.5) * g.cellDeg);
  const sums = [];
  const frames = track.chapters.flatMap((ch) => ch.frames);
  for (const fr of frames) {
    const v = fr._v = Float32Array.from(fr.core, (x) => x / 100);
    fr._sum = new Float32Array(g.cols);       // all the lightning in the column
    fr._mom = new Float32Array(g.cols);       // the same, weighted by latitude
    for (let c = 0; c < g.cols; c++) {
      for (let r = 0; r < g.rows; r++) {
        const x = v[r * g.cols + c];
        if (x <= 0) continue;
        fr._sum[c] += x;
        fr._mom[c] += x * lats[r];
      }
      sums.push(fr._sum[c]);
    }
  }
  // One scale for the whole track, never per part.
  track._bedNorm = Math.max(1e-6, percentile(sums, BED_PERCENTILE));

  // Strings: the lightning in each band of latitude, per column, and one scale for every band.
  const bandOfRow = lats.map((lat) => stringBandOfLat(lat));
  const bandSums = [];
  for (const fr of frames) {
    fr._str = new Float32Array(g.cols * STRING_BANDS);
    for (let c = 0; c < g.cols; c++) {
      for (let r = 0; r < g.rows; r++) fr._str[c * STRING_BANDS + bandOfRow[r]] += fr._v[r * g.cols + c];
    }
  }
  for (const fr of frames) {
    for (let c = 0; c < g.cols; c++) for (const x of stringSums(track, fr, c)) if (x > 0) bandSums.push(x);
  }
  track._stringNorm = Math.max(1e-6, percentile(bandSums, STRING_PERCENTILE));

  // Marks: per 1° column and pitch band, and a running total for the wind's window.
  if (mg) {
    const markLat = (r) => mg.latNorth - (r + 0.5) * mg.latDeg;
    const windows = [];
    for (const fr of frames) {
      const m = fr.marks || [];
      fr._bandMarks = new Uint16Array(mg.cols * BANDS);
      fr._colMarks = new Float32Array(mg.cols);
      for (let r = 0; r < mg.rows; r++) {
        const b = bandOfLat(markLat(r));
        for (let k = 0; k < mg.cols; k++) {
          const n = m[r * mg.cols + k] || 0;
          if (!n) continue;
          fr._bandMarks[k * BANDS + b] += n;
          fr._colMarks[k] += n;
        }
      }
      for (let c = 0; c < g.cols; c++) windows.push(windowMarks(track, fr, c));
    }
    track._windNorm = Math.max(1, percentile(windows, WIND_PERCENTILE));
  }

  // Compare: the change in each 3° cell from the previous part, on one scale for every pair.
  const diffs = [];
  frames.forEach((fr, i) => {
    if (!i) return;
    const prev = frames[i - 1]._v;
    fr._d = Float32Array.from(fr._v, (x, j) => x - prev[j]);
    for (let j = 0; j < fr._d.length; j++) if (fr._v[j] > 0 || prev[j] > 0) diffs.push(Math.abs(fr._d[j]));
  });
  track._diffNorm = Math.max(1e-3, percentile(diffs, DIFF_PERCENTILE));
  return track;
}

/** Marks within WIND_REACH degrees of 3° step c (east and west edges join). */
function windowMarks(track, frame, c) {
  const mg = track.markGrid, per = mg.cols / track.grid.cols, reach = Math.round(WIND_REACH / mg.lonDeg);
  let s = 0;
  for (let k = c * per - reach; k < (c + 1) * per + reach; k++) s += frame._colMarks[((k % mg.cols) + mg.cols) % mg.cols];
  return s;
}

/** The lightning in each string band at column c, lightly averaged over STRING_REACH columns each side. */
function stringSums(track, frame, c) {
  const cols = track.grid.cols, out = new Float32Array(STRING_BANDS);
  let wsum = 0;
  for (let d = -STRING_REACH; d <= STRING_REACH; d++) {
    const w = STRING_REACH + 1 - Math.abs(d), k = (((c + d) % cols) + cols) % cols;
    for (let b = 0; b < STRING_BANDS; b++) out[b] += w * frame._str[k * STRING_BANDS + b];
    wsum += w;
  }
  for (let b = 0; b < STRING_BANDS; b++) out[b] /= wsum;
  return out;
}

/** The string band levels (0..1) at column c: each band swells with the lightning in its latitudes. */
export function stringLevels(track, frame, c) {
  return Array.from(stringSums(track, frame, c), (x) => stringLevel(x / track._stringNorm));
}

/** The lightning near column c, averaged over `reach` columns each side (east and west edges join). */
function smoothed(track, frame, c, reach) {
  const cols = track.grid.cols;
  let sum = 0, mom = 0, wsum = 0;
  for (let d = -reach; d <= reach; d++) {
    const w = reach + 1 - Math.abs(d);
    const k = (((c + d) % cols) + cols) % cols;
    sum += w * frame._sum[k];
    mom += w * frame._mom[k];
    wsum += w;
  }
  return { total: sum / wsum, lat: sum > 0 ? mom / sum : 0 };
}

/** Is the cell at (r, c) the strongest of its area in `v` (sign 1) or the weakest (sign -1)? */
function isCrest(track, v, r, c, sign) {
  const { cols, rows } = track.grid, x = sign * v[r * cols + c];
  for (let dr = -CHANGE_REACH.rows; dr <= CHANGE_REACH.rows; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= rows) continue;
    for (let dc = -CHANGE_REACH.cols; dc <= CHANGE_REACH.cols; dc++) {
      const cc = c + dc;
      if ((!dr && !dc) || cc < 0 || cc >= cols) continue;
      const y = sign * v[rr * cols + cc];
      if (dc < 0 || (dc === 0 && dr < 0) ? y >= x : y > x) return false;
    }
  }
  return true;
}

const rowLat = (g, r) => g.latNorth - (r + 0.5) * g.cellDeg;
const stepDurOf = (track, seg) => seg.stepDur || seg.dur / seg.steps || 20 / track.grid.cols;

/** Where the scan line is at the start and end of step c: -1 = western edge … +1 = eastern edge. */
function sweepAt(track, c) {
  const cols = track.grid.cols;
  return { from: (c / cols) * 2 - 1, to: ((c + 1) / cols) * 2 - 1 };
}

/** The mark notes of step c: every band with marks gets at least one note. */
function markNotes(track, seg, c, stepDur) {
  const { frame } = seg, mg = track.markGrid;
  if (!mg || !frame._bandMarks) return [];
  const per = mg.cols / track.grid.cols;
  const bands = [];
  for (let b = 0; b < BANDS; b++) {
    const times = [];
    let n = 0;
    for (let j = 0; j < per; j++) {
      const k = c * per + j, m = frame._bandMarks[k * BANDS + b];
      if (!m) continue;
      times.push([((j + 0.5) / per) * stepDur, m]);
      n += m;
    }
    if (n) bands.push({ b, n, times, count: 1, want: notesForMarks(n) });
  }
  // Spend what is left of the step's notes on the busiest bands first, one at a time.
  let spare = Math.max(0, MARK.perStep - bands.length);
  const byCount = [...bands].sort((x, y) => y.n - x.n);
  while (spare > 0 && byCount.some((x) => x.count < x.want)) {
    for (const x of byCount) if (spare > 0 && x.count < x.want) { x.count++; spare--; }
  }
  const events = [];
  const lonWest = mg.lonWest + c * per * mg.lonDeg;
  for (const x of bands) {
    // Bands start a few milliseconds apart, so marks crossed together are a quick spread, not a chord.
    const stagger = ((x.b * 7) % 5) * 0.007;
    const lat = TOP_LAT - (BANDS - 1 - x.b + 0.5) * BAND_DEG;
    flurry(x.n, x.times, x.count).forEach((nt, i) => {
      const offset = Math.min(nt.offset + stagger, stepDur * 1.5);
      events.push({
        voice: 'notes', kind: 'mark', free: true, echo: i > 0, midi: BAND_NOTES[x.b],
        velocity: nt.velocity, offset, duration: MARK.duration,
        lat, lon: lonWest + (offset / stepDur) * per * mg.lonDeg,
        pos: ((c + offset / stepDur) / track.grid.cols) * 2 - 1,
      });
    });
  }
  return events;
}

/** The bass bow stroke of step c, the smoothed level it follows, and the chord of the moment. */
function bed(track, seg, c, stepDur, quiet) {
  const g = track.grid;
  const reach = clamp(Math.round(SMOOTH_SECONDS / stepDur / 2), 1, g.cols / 4);
  const near = smoothed(track, seg.frame, c, reach);
  const rel = quiet ? 0 : clamp(near.total / track._bedNorm, 0, 1);
  const windows = Math.max(1, Math.round((stepDur * seg.steps) / WINDOW_SECONDS));
  const half = Math.floor((c * windows * 2) / seg.steps);     // two bass strokes per chord window
  const w = half >> 1;
  const chordName = PROGRESSION[w % PROGRESSION.length];
  const period = (stepDur * seg.steps) / windows;
  const [bass] = bedEvents(rel, chordName, `${seg.index ?? 0}:${w}`, period);
  // The second stroke on D is short, so the D has nearly faded when the bass pulls back up to E flat.
  // The pedal keeps the same weight through every chord: only the lightning changes how loud it is.
  const events = [{
    ...bass, tag: `${seg.index ?? 0}:${half}`, period: period / 2,
    duration: chordName === 'Bb' && half % 2 ? BOW.bass.short : BOW.bass.duration,
  }];
  return { events, rel, chordName, chordTag: `${seg.index ?? 0}:${w}` };
}

/** The rising and falling figures of step c in compare mode. */
function changeNotes(track, seg, c) {
  const { frame } = seg, g = track.grid, d = frame._d;
  if (!d) return [];
  const norm = track._diffNorm, events = [];
  for (const sign of [1, -1]) {
    const crests = [];
    for (let r = 0; r < g.rows; r++) {
      const dz = clamp(d[r * g.cols + c] / norm, -1, 1);
      if (sign * dz >= CHANGE_MIN && isCrest(track, d, r, c, sign)) crests.push({ r, dz });
    }
    crests.sort((a, b) => Math.abs(b.dz) - Math.abs(a.dz));
    const chosen = [];
    for (const q of crests) {
      if (chosen.length >= CHANGE_PER_STEP) break;
      if (chosen.every((o) => Math.abs(bandOfLat(rowLat(g, o.r)) - bandOfLat(rowLat(g, q.r))) >= 3)) chosen.push(q);
    }
    chosen.forEach((q, i) => {
      const lat = rowLat(g, q.r);
      for (const nt of changeFigure(q.dz, lat)) {
        events.push({
          voice: 'notes', kind: sign > 0 ? 'gain' : 'loss', free: true, echo: nt.offset > 0,
          midi: nt.midi, velocity: nt.velocity, duration: nt.duration,
          offset: nt.offset + i * 0.04 + (sign > 0 ? 0 : 0.02), lat, lon: g.lonWest + (c + 0.5) * g.cellDeg,
          pos: ((c + 0.5) / g.cols) * 2 - 1, change: q.dz,
        });
      }
    });
  }
  return events;
}

/** Net change under the line in compare mode, on the track's fixed scale (for "Where am I"). */
function netChange(track, frame, c) {
  if (!frame._d) return 0;
  const g = track.grid;
  let s = 0;
  for (let r = 0; r < g.rows; r++) s += frame._d[r * g.cols + c];
  return clamp(s / (track._diffNorm * 4), -1, 1);
}

/**
 * Plan one scan step (one column).
 * @returns {{events: Array, hum: {level, pan, under, change?}, layers: {wind, strings, from, to}}}
 *   events: mark notes and change figures {voice: 'notes', kind, midi, velocity, offset, duration, lat, lon, pos}
 *           and the bass bow stroke {voice: 'bass', bed: true, notes, tag, period}
 *   hum: level = the bass level (smoothed, with its floor); under = this column alone, 0..1
 *   layers: wind 0..1; strings {levels, notes, tag}, one per band of latitude; and where the
 *           scan line is at the step's start and end (-1 west … +1 east)
 */
export function planStep(track, seg, c) {
  const { frame } = seg;
  const stepDur = stepDurOf(track, seg);
  const sweep = sweepAt(track, c);

  if (params.compare) {
    // Only the change, over a quiet bass pedal: no marks, no wind, no strings.
    const { events, chordName, chordTag } = bed(track, seg, c, stepDur, true);
    events.push(...changeNotes(track, seg, c));
    return {
      events,
      hum: { level: BED_FLOOR, pan: 0, under: 0, change: netChange(track, frame, c) },
      layers: { wind: 0, strings: stringsAt(new Array(STRING_BANDS).fill(0), chordName, chordTag), ...sweep },
    };
  }

  const events = markNotes(track, seg, c, stepDur);
  const { events: bow, rel, chordName, chordTag } = bed(track, seg, c, stepDur, false);
  events.push(...bow);
  const wind = track._windNorm ? windLevel(windowMarks(track, frame, c) / track._windNorm) : 0;
  return {
    events,
    hum: { level: bedLevel(rel), pan: 0, under: clamp(frame._sum[c] / track._bedNorm, 0, 1) },
    layers: { wind, strings: stringsAt(stringLevels(track, frame, c), chordName, chordTag), ...sweep },
  };
}
