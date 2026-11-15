// sweep/chords.js: the sound of the sea temperature track (track 7, "Warm and cold seas"): a warm
// chord pad with a temperature melody, both built from the measured timbre of the reference pad
// (NASA reference instrument.mp3), not from a soundfont.
//
// What was measured in the reference (backend/eic notes, 15 Nov 2026):
//  * each note is nearly a pure tone: fundamental, a faint 2nd partial (-19 dB), 3rd (-23 dB), 7th (-21 dB);
//  * a voice swells in over about 1 to 2 seconds and fades over several, with nothing above ~1.5 kHz;
//  * a slow tremolo of about 20 % depth at 0.6 to 2.4 Hz.
//
//   pad voice:    custom oscillator -> tremolo -> level -> pan -> chord bus -> low-pass -> master (+ reverb send)
//   melody note:  the same timbre, swelling in over a third of a second (no struck attack), one voice
//                 from a small pool, panned per note
//
// The mapping (tracks/sea-heat.js) glides each pad voice's level and pan and sends melody notes. Tone.js
// is the page's bundle (EJ).

import { clamp } from './music.js';

const T = window.EJ.Tone;

// The reference's harmonic profile, fitted by non-negative least squares over all its chords.
export const PARTIALS = [1, 0.11, 0.07, 0.01, 0.03, 0.005, 0.09, 0.02, 0.005, 0.02, 0.02];
const TOP_HZ = 1500;              // the reference has almost nothing above this
const FADE = 0.4;                 // time constant (s): a pad voice reaches 95 % of a change in about 1.2 s
const PAN_FADE = 0.6;
const REVERB = 0.55;
const GAIN = 0.13;                // the whole sound, to sit at the loudness of the other tracks (offline render)
const TREMOLO = { depth: 0.2, low: 0.6, high: 1.6 };   // 20 % deep, 0.6 to 1.6 Hz, each voice its own rate
const POOL = 6;                   // melody notes that can sound at once
// Each note breathes in like the pad (no hammer, no pluck) and still ends before the next one starts.
const SWELL = { attack: 0.35, attackCurve: 'sine', decay: 0.5, sustain: 0.5, release: 1.4 };
// Each voice's level at full strength: lower voices fuller, upper voices softer, so the pad stays dark
// (about 85 % of its energy below 500 Hz, as in the reference).
const weight = (midi) => clamp(1.05 - (midi - 38) * 0.01, 0.7, 1);
const noteName = (midi) => T.Frequency(midi, 'midi').toNote();

export class Chords {
  /**
   * @param {{keep: (node) => node, master, reverb, settings: {chordNotes: number[], width}}} o
   *   chordNotes: the MIDI notes of every pad voice, low to high (from the data, via the mapping).
   */
  constructor({ keep: k, master, reverb, settings }) {
    this.k = k;
    this.settings = settings;
    this.notes = settings.chordNotes ?? [];
    this.bus = k(new T.Gain(GAIN));
    this.tone = k(new T.Filter({ type: 'lowpass', frequency: TOP_HZ, rolloff: -24, Q: 0.4 })).connect(master);
    this.bus.connect(this.tone);
    this.send = k(new T.Gain(REVERB)).connect(reverb);
    this.tone.connect(this.send);
    this.voices = this.notes.map((midi, i) => {
      const pan = k(new T.Panner(0)).connect(this.bus);
      const level = k(new T.Gain(0)).connect(pan);
      const trem = k(new T.Gain(1)).connect(level);
      // Each voice sways at its own rate, so the chord shimmers instead of pulsing as one.
      k(new T.LFO({ frequency: TREMOLO.low + ((i * 0.37) % 1) * (TREMOLO.high - TREMOLO.low), min: 1 - TREMOLO.depth, max: 1, phase: (i * 83) % 360 })).connect(trem.gain).start();
      const osc = k(new T.Oscillator({ frequency: T.Frequency(midi, 'midi').toFrequency(), type: 'custom', partials: PARTIALS })).connect(trem);
      osc.start();
      return { midi, level, pan, last: 0 };
    });
    this.pool = Array.from({ length: POOL }, () => {
      const pan = k(new T.Panner(0)).connect(this.bus);
      const synth = k(new T.Synth({ oscillator: { type: 'custom', partials: PARTIALS }, envelope: SWELL })).connect(pan);
      return { synth, pan, at: -Infinity };
    });
    this.next = 0;
    this.usingFallback = false;
  }

  /** Nothing to load: the voices are synthesised. */
  async load() {}

  /**
   * The pad for one step: levels[i] (0..1) and pans[i] (-1 west ... +1 east) for each voice, in the
   * order of chordNotes. Each glides there.
   */
  set({ levels, pans }, time) {
    const width = this.settings.width ?? 1;
    this.voices.forEach((v, i) => {
      const target = clamp(levels[i] ?? 0, 0, 1) * weight(v.midi);
      v.level.gain.setTargetAtTime(target, time, FADE);
      v.last = target;
      if (target > 0 && pans) v.pan.pan.setTargetAtTime(clamp(pans[i] ?? 0, -1, 1) * width, time, PAN_FADE);
    });
  }

  /** One melody note: ev.midi, ev.velocity (0..1), ev.duration (s), ev.pan (-1 west ... +1 east). */
  note(ev, time) {
    const v = this.pool[this.next];
    this.next = (this.next + 1) % POOL;
    if (time <= v.at) return;                 // a voice is scheduled forwards only: skip, never click
    v.at = time + (ev.duration ?? 1) + 0.05;
    v.pan.pan.setValueAtTime(clamp(ev.pan ?? 0, -1, 1) * (this.settings.width ?? 1), time);
    v.synth.triggerAttackRelease(noteName(ev.midi), ev.duration ?? 1, time, clamp(ev.velocity ?? 0.6, 0, 1));
  }

  /** Fade every voice out quickly (pause, seek, stop). */
  silence(t) {
    for (const v of this.voices) {
      const g = v.level.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.3);
      v.last = 0;
    }
    for (const m of this.pool) { m.synth.triggerRelease(t); m.at = -Infinity; }
  }
}
