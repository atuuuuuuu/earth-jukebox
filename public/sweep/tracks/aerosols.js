// The air we share: NASA SVS 5669 (GEOS Aerosols, 19 Aug 2025), four particles, four instruments.
// Sound design from team BoboMimi's TerraJuke (src/lib/air/sonify.ts), on Earth Jukebox's rules.
// Pure planning logic (no Tone.js): backend/build_aerosols.py did the reading.
//
//  * map 1 is Earth turning under the needle, 64 slices west to east; maps 2-7 are NASA's six stories,
//    8 slices each, played at half speed so each box can be heard;
//  * every slice is one chord: each aerosol that is there plays its own instrument;
//  * loudness = how much of it is in the slice, on one fixed scale (full at 0.30); clear air rests;
//  * pitch = where most of it sits: north higher, on one D minor pentatonic scale so the four agree;
//  * stereo = Earth Jukebox's rule on every track: north in the left ear, south in the right.

import { clamp } from '../music.js';

export const HUM_NOTES = [];   // no drone: rhythm comes from where the particles are

/** Tone.js options per voice. Read by audio.js, which builds them; trims follow TerraJuke's mix. */
export const SYNTHS = {
  blackCarbon: { kind: 'Synth', trim: -2, lowpass: 1100, options: { oscillator: { type: 'fatsawtooth', count: 2, spread: 14 }, envelope: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.5 } } },
  dust: { kind: 'Synth', trim: -3, options: { oscillator: { type: 'fattriangle', count: 2, spread: 14 }, envelope: { attack: 0.08, decay: 0.2, sustain: 0.8, release: 0.6 } } },
  seaSalt: { kind: 'Synth', trim: 0, options: { oscillator: { type: 'fatsine', count: 2, spread: 10 }, envelope: { attack: 0.15, decay: 0.3, sustain: 0.8, release: 0.9 } } },
  sulfate: { kind: 'FMSynth', trim: -1, options: { harmonicity: 2.76, modulationIndex: 1.4, envelope: { attack: 0.004, decay: 1.4, sustain: 0, release: 1.2 }, modulationEnvelope: { attack: 0.004, decay: 0.6, sustain: 0, release: 0.5 } } },
};

export const params = { slice: 0.3125, storySlice: 0.625 };

// TerraJuke's default 96 BPM, one eighth note per slice, is Earth Jukebox's "Normal" speed.
export function defaults() { return { sliceSeconds: 0.3125, storySeconds: 0.625, notesReverb: 0.35 }; }

export function configure(settings) {
  params.slice = settings.sliceSeconds;
  params.storySlice = settings.storySeconds;
}

/** Scale degree 0..notes-1 for a latitude: north is higher. */
export function degreeFor(rules, lat) {
  const t = (clamp(lat, rules.latLow, rules.latHigh) - rules.latLow) / (rules.latHigh - rules.latLow);
  return Math.min(rules.notes - 1, Math.floor(t * rules.notes));
}
export function midiFor(rules, voice, lat) {
  const scale = [];
  for (let m = 0; m < 128; m++) if (rules.scale.includes((((m - rules.tonic) % 12) + 12) % 12)) scale.push(m);
  return scale[scale.findIndex((m) => m >= rules.baseMidi[voice]) + degreeFor(rules, lat)];
}
/** 0..1 on the fixed scale, gently compressed so faint air stays audible. */
export const loudnessFor = (rules, amount) => (amount < rules.restAmount ? 0 : Math.min(1, amount / rules.fullAmount) ** 0.6);
export const posForLat = (lat) => clamp(-lat / 90, -1, 1);   // north = -1 = left ear

/** One chord: [{voice, midi, loudness, amount, lat}] for the aerosols present in a mix. */
export function chordFor(track, mix) {
  const out = [];
  mix.forEach(([amount, lat], k) => {
    const loudness = loudnessFor(track.rules, amount);
    if (!loudness || lat === null) return;
    const voice = track.voices[k].id;
    out.push({ voice, midi: midiFor(track.rules, voice, lat), loudness, amount, lat });
  });
  return out;
}

export function prepare(track) {
  for (const f of track.chapters[0].frames) {
    f._chords = f.steps.map((s) => chordFor(track, s.mix));
  }
  return track;
}

export function segments(track) {
  const chapter = track.chapters[0];
  return chapter.frames.map((frame) => ({ chapter, frame, steps: frame.steps.length }));
}

export function segmentSeconds(track, seg, settings) {
  return seg.steps * (seg.frame.box ? settings.storySeconds : settings.sliceSeconds);
}

/** Longitude of the needle at a (fractional) step of a map. */
export function lonAt(seg, step) {
  const s = seg.frame.steps, i = clamp(Math.floor(step), 0, s.length - 1);
  return s[i].lon0 + (s[i].lon1 - s[i].lon0) * clamp(step - i, 0, 1);
}

export function planStep(track, seg, step) {
  const s = seg.frame.steps[step], lon = (s.lon0 + s.lon1) / 2;
  const dur = seg.frame.box ? params.storySlice : params.slice;
  const events = seg.frame._chords[step].map((n) => ({
    voice: n.voice, kind: n.voice, midi: n.midi, velocity: n.loudness, duration: dur * 0.9, offset: 0,
    pos: posForLat(n.lat), lat: n.lat, lon, amount: n.amount,
  }));
  return { events, hum: { level: 0, pan: 0, tension: 0 }, beat: 0 };
}
