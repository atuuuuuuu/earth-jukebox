// sweep/winds.js: soft winds made from noise, one per layer of a map (track 03, aerosols).
// After the wind in NASA's NGC 1300 sonification: band-limited noise, almost nothing above 2 kHz,
// a centre that drifts slowly up as more material passes the line, slow swells, no attacks, and a
// lot of reverb. Each layer's wind has its own colour, so all four can be told apart together:
//
//   noise -> band-pass (register) -> low-pass (how open) -> texture -> gusts -> level -> pan -> bus
//
// The mapping (tracks/aerosols.js) sends, every step, each wind's level, openness and latitude.
// Tone.js comes from the page's own bundle (global EJ), so every engine shares one audio context.

import { clamp } from './music.js';

const T = window.EJ.Tone;
const dbToGain = (db) => Math.pow(10, db / 20);

// One colour per kind of wind. low/high: the band's centre from the far south to the far north
// (Hz); q: how narrow the band is when the wind is faint (it opens as the wind grows); open: how far
// above the centre the low-pass opens at full wind; gust: slow swaying [Hz, lowest share]; trim: dB
// in the mix of all winds. Measured against NGC 1300 (offline render, 14 Nov 2026): its wind's
// centre wanders between about 220 and 790 Hz with about 1 % of the energy above 2 kHz.
export const COLOURS = {
  // Sea salt: a low, airy ocean wind; smooth, the slowest gusts.
  ocean: { noise: 'pink', low: 150, high: 600, q: 0.6, open: 2.0, gust: [0.045, 0.55], trim: 0 },
  // Dust: in the middle, sandy: a fast, tiny, random flutter of its loudness (grain).
  sand: { noise: 'pink', low: 300, high: 1200, q: 1.0, open: 1.4, gust: [0.07, 0.65], grain: 0.1, trim: 0 },
  // Sulfate: higher, thin and breathy, very soft.
  breath: { noise: 'pink', low: 600, high: 1700, q: 2.2, open: 0.8, gust: [0.09, 0.6], trim: -5 },
  // Black carbon (smoke): low and dark, slightly rough; rougher over thick smoke, and it crackles.
  smoke: { noise: 'brown', low: 100, high: 500, q: 0.9, open: 2.0, gust: [0.055, 0.6], rough: 0.35, trim: 0 },
};
const ORDER = ['smoke', 'sand', 'ocean', 'breath'];   // for layers that name no colour
const GAIN = 0.85;                // a wind at full level, before its trim
const SOLO_DB = 2;                // a wind heard alone: its own full level (no mix trim), a little forward
const TOP_HZ = 2000;              // no wind opens above this: soft and dark, like the reference
const REVERB = 0.7;               // send to the hall: the winds sit far back in it
const LAT_SPAN = 60;              // degrees: 60 N and beyond is the top of every band, 60 S the bottom
const RISE = 0.5, FALL = 0.8;     // seconds to reach about two thirds of a change in level
const GLIDE = 0.8;                // the same for register, openness and pan
const ROUGH_HZ = 31;              // the smoke's flutter: fast enough to sound rough, not like a beat
const GRAIN_HZ = 35;              // the dust's flutter: random, below this rate
const CRACKLE = { band: 1300, top: 2200, trim: -6 };

export class Winds {
  /**
   * @param {{keep: (node) => node, master, reverb, settings: {winds: Array<{id, wind}>, width, solo}}} o
   */
  constructor({ keep: k, master, reverb, settings }) {
    this.settings = settings;
    this.voices = new Map();
    (settings.winds ?? []).forEach(({ id, wind }, i) => {
      const colour = COLOURS[wind] ?? COLOURS[ORDER[i % ORDER.length]];
      const v = { id, colour, last: 0 };
      v.bus = k(new T.Gain(0)).connect(master);
      v.send = k(new T.Gain(REVERB)).connect(reverb);
      v.bus.connect(v.send);
      v.pan = k(new T.Panner(0)).connect(v.bus);
      v.level = k(new T.Gain(0)).connect(v.pan);
      v.sway = k(new T.Gain(1)).connect(v.level);
      const [gustHz, gustLow] = colour.gust;
      k(new T.LFO({ frequency: gustHz, min: gustLow, max: 1, phase: (i * 97) % 360 })).connect(v.sway.gain).start();
      v.texture = k(new T.Gain(1)).connect(v.sway);
      v.tone = k(new T.Filter({ type: 'lowpass', frequency: colour.low * 2, rolloff: -12, Q: 0.3 })).connect(v.texture);
      v.band = k(new T.Filter({ type: 'bandpass', frequency: colour.low, Q: colour.q }));
      v.noise = k(new T.Noise(colour.noise));
      v.noise.connect(v.band);
      if (colour.rough) {
        // Smoke: a little soft clipping for grit, then a fast flutter that deepens over thick smoke.
        const grit = k(new T.Distortion({ distortion: 0.25, wet: 0.3 }));
        v.band.connect(grit);
        grit.connect(v.tone);
        v.rough = k(new T.LFO({ frequency: ROUGH_HZ, min: 1 - colour.rough, max: 1, amplitude: 0 })).connect(v.texture.gain).start();
        // Crackles: short, soft bursts of filtered noise, placed at their own latitude.
        v.crackPan = k(new T.Panner(0)).connect(v.bus);
        const top = k(new T.Filter({ type: 'lowpass', frequency: CRACKLE.top, rolloff: -12 })).connect(v.crackPan);
        const band = k(new T.Filter({ type: 'bandpass', frequency: CRACKLE.band, Q: 0.7 })).connect(top);
        v.crackle = k(new T.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.004, decay: 0.045, sustain: 0, release: 0.03 } })).connect(band);
        v.crackle.volume.value = CRACKLE.trim;
      } else {
        v.band.connect(v.tone);
      }
      if (colour.grain) {
        // Dust: random flutter of the loudness, from slow-filtered white noise added to the gain.
        const grain = k(new T.Noise('white'));
        const slow = k(new T.Filter({ type: 'lowpass', frequency: GRAIN_HZ, rolloff: -12 }));
        // Filtered this low, the noise keeps about 1/40 of its size: scale it back to `grain`.
        const depth = k(new T.Gain(colour.grain * 40));
        grain.chain(slow, depth);
        depth.connect(v.texture.gain);
        grain.start();
      }
      v.noise.start();
      this.voices.set(id, v);
    });
    this.apply(settings);
  }

  /** How loud a wind's bus is under the current settings: muted when another wind is heard alone. */
  _busGain(v, s = this.settings) {
    if (s.solo && s.solo !== v.id) return 0;
    return dbToGain(s.solo ? SOLO_DB : v.colour.trim);
  }

  /** Solo, mono and levels from the settings. */
  apply(s = this.settings) {
    this.settings = s;
    for (const v of this.voices.values()) {
      v.bus.gain.cancelScheduledValues(T.now());   // an example's own level ends here too
      v.bus.gain.rampTo(this._busGain(v), 0.3);
    }
  }

  /** Let one wind be heard alone for `seconds` from `time` (an example), whatever is chosen. */
  hear(id, time, seconds) {
    const v = this.voices.get(id);
    if (!v) return;
    const g = v.bus.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(dbToGain(SOLO_DB), time);
    g.setValueAtTime(this._busGain(v), time + seconds);
  }

  /**
   * The winds for one step: [{id, level 0..1, open 0..1, lat (degrees), tone (degrees, optional),
   * thick 0..1}]. Register and stereo follow `tone` when given (a story's window, stretched), else `lat`.
   * Every value glides there, so the winds swell and turn slowly.
   */
  set(winds, time) {
    const width = this.settings.width ?? 1;
    for (const w of winds) {
      const v = this.voices.get(w.id);
      if (!v) continue;
      const c = v.colour, open = clamp(w.open ?? w.level, 0, 1);
      const lat = w.tone ?? w.lat;
      const north = clamp((lat + LAT_SPAN) / (2 * LAT_SPAN), 0, 1);
      const centre = c.low * Math.pow(c.high / c.low, north) * (1 + 0.2 * open);
      v.level.gain.setTargetAtTime(w.level * GAIN, time, w.level > v.last ? RISE : FALL);
      v.last = w.level;
      if (w.level <= 0) continue;          // a silent wind keeps its place until it returns
      v.band.frequency.setTargetAtTime(centre, time, GLIDE);
      v.band.Q.setTargetAtTime(c.q * (1.2 - 0.5 * open), time, GLIDE);
      v.tone.frequency.setTargetAtTime(Math.min(TOP_HZ, centre * (1.25 + c.open * open)), time, GLIDE);
      v.pan.pan.setTargetAtTime(clamp(-lat / LAT_SPAN, -1, 1) * width, time, GLIDE);
      if (v.rough) v.rough.amplitude.setTargetAtTime(clamp((w.thick - 0.3) / 0.7, 0, 1), time, GLIDE);
    }
  }

  /** One soft crackle of the smoke: ev.layer, ev.velocity, ev.pos (-1 north … +1 south). */
  crackle(ev, time) {
    const v = this.voices.get(ev.layer);
    if (!v?.crackle) return;
    v.crackPan.pan.setValueAtTime(clamp(ev.pos ?? 0, -1, 1) * (this.settings.width ?? 1), time);
    v.crackle.triggerAttackRelease(ev.duration ?? 0.03, time, ev.velocity);
  }

  /** Fade every wind out quickly (pause, seek, stop). */
  silence(t) {
    for (const v of this.voices.values()) {
      const g = v.level.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.3);
      v.last = 0;
    }
  }
}
