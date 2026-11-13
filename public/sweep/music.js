// Shared musical helpers. Pure functions — no Tone.js, so they run in Node tests too.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

/** All MIDI notes in [low, high] that belong to the scale (pitch classes relative to C). */
export function scaleRange(low, high, scale = MAJOR_PENTATONIC) {
  const out = [];
  for (let m = low; m <= high; m++) if (scale.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

export function midiToNote(m) {
  return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Map a value in [lo, hi] onto a note list (north/higher = higher pitch). */
export function pickNote(notes, value, lo, hi) {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return notes[Math.round(t * (notes.length - 1))];
}

/** The next note above/below `midi` within `notes`. */
export function stepNote(notes, midi, dir) {
  const i = notes.indexOf(midi);
  if (i < 0) return midi;
  return notes[clamp(i + dir, 0, notes.length - 1)];
}
