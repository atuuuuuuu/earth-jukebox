// sweep/chords.js: warm chords for the sea surface temperature track (track 02, "Warm and cold seas").
// After the reference pad (instrument.mp3): a soft, sustained chord on one white-key scale, a deep
// D2 root with voices added on top, dark (nothing above about 1.5 kHz), no attacks, steady loudness.
//
//   each chord note: a looped pad sample -> its level -> its pan -> the chord bus -> low-pass -> master
//                                                                                 \-> reverb send
//
// Every voice runs all the time; the mapping (tracks/sea-heat.js) only glides each voice's level and
// pan, so voices fade in and out over about a second and nothing ever clicks. The samples are
// FluidR3_GM "Pad 2 (warm)", one file per chord note (no repitching); each 3 s note is looped from its
// steady middle by overlapping grains, so the loop has no seam. Tone.js is the page's bundle (EJ).

import { clamp } from './music.js';

const T = window.EJ.Tone;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const DIR = 'samples/pad/';
const LOOP = [1.0, 3.0];          // the steady middle of each 3.1 s sample (seconds)
const GRAIN = { size: 0.5, overlap: 0.25 };
const TOP_HZ = 1500;              // the reference has almost nothing above this
const FADE = 0.4;                 // time constant (s): a voice reaches 95 % of a change in about 1.2 s
const PAN_FADE = 0.6;
const REVERB = 0.55;
const GAIN = 1.5;                 // the whole chord, to sit at the same loudness as the other tracks
// Each voice's level at full strength: lower voices fuller, upper voices softer, so the pad stays dark
// (about 85 % of its energy below 500 Hz, as in the reference). By offline render, 15 Nov 2026.
const weight = (midi) => clamp(1.05 - (midi - 38) * 0.01, 0.7, 1);

export class Chords {
  /**
   * @param {{keep: (node) => node, master, reverb, settings: {chordNotes: number[], width}}} o
   *   chordNotes: the MIDI notes of every voice, low to high (from the data, via the mapping).
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
    this.voices = this.notes.map((midi) => {
      const pan = k(new T.Panner(0)).connect(this.bus);
      const level = k(new T.Gain(0)).connect(pan);
      return { midi, level, pan, last: 0 };
    });
    this.usingFallback = false;
  }

  /** Load the samples and start every voice, silent. Falls back to a soft synth if loading fails. */
  async load() {
    const k = this.k;
    let buffers = null;
    try {
      buffers = await new Promise((resolve, reject) => {
        const b = new T.ToneAudioBuffers({
          urls: Object.fromEntries(this.notes.map((m) => [noteName(m), `${noteName(m)}.mp3`])),
          baseUrl: DIR, onload: () => resolve(b), onerror: reject,
        });
      });
    } catch (err) {
      console.warn('Pad samples failed; using a soft synth for the chords', err);
      this.usingFallback = true;
    }
    for (const v of this.voices) {
      if (buffers) {
        v.src = k(new T.GrainPlayer({
          url: buffers.get(noteName(v.midi)), loop: true, loopStart: LOOP[0], loopEnd: LOOP[1],
          grainSize: GRAIN.size, overlap: GRAIN.overlap,
        })).connect(v.level);
        v.src.start(T.now(), LOOP[0]);
      } else {
        v.src = k(new T.FatOscillator({ frequency: T.Frequency(v.midi, 'midi').toFrequency(), type: 'triangle', count: 2, spread: 12 })).connect(v.level);
        v.src.volume.value = -10;
        v.src.start();
      }
    }
  }

  /**
   * The chord for one step: levels[i] (0..1) and pans[i] (-1 west … +1 east) for each voice, in the
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

  /** Fade every voice out quickly (pause, seek, stop). */
  silence(t) {
    for (const v of this.voices) {
      const g = v.level.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.3);
      v.last = 0;
    }
  }
}
