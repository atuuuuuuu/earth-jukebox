// engine.js: synthesises a score live in the browser with Tone.js.
import * as Tone from "tone";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const euclid = (hits, steps) => Array.from({ length: steps }, (_, i) => (i * hits) % steps < hits);

// Equal length, so a value keeps its position on the scale when the mode darkens.
const SCALES = {
  calm:  ["C3", "D3", "E3", "G3", "A3", "C4", "D4", "E4", "G4", "A4", "C5", "D5"],
  tense: ["C3", "Db3", "E3", "G3", "Ab3", "C4", "Db4", "E4", "G4", "Ab4", "C5", "Db5"],
};

// Ordered by measured roughness, smoothest first.
const LADDER = [
  ["C3", "G3", "C4", "G4"],
  ["C3", "G3", "E4", "B4"],
  ["C3", "G3", "D4", "A4"],
  ["C3", "Bb3", "E4", "A4"],
  ["C3", "Db4", "Gb4", "G4"],
  ["C3", "Gb3", "Bb3", "E4"],
];

export class Sonifier {
  constructor(score, { mapping = "scan", strict = false, onFrame = () => {} } = {}) {
    Object.assign(this, { score, mapping, strict, onFrame, index: 0, step: 0 });
    this.span = score.range[1] - score.range[0];
    // Track settings. Set them once per track and publish them with the method.
    this.tune = { ladder: [-1, 2], spreadMax: 3, tenseAt: 0.25, ...score.tuning };
    // One fixed range for the whole track. Never rescale per frame: a hot year must sound hot.
    this.norm = (v) => clamp((v - score.range[0]) / this.span);
  }

  frame() { return this.score.frames[this.index]; }

  pitch(v, frame) {
    const n = this.norm(v);
    if (this.strict) return 220 * 2 ** (2 * n);        // Strict: continuous, no scale.
    const scale = frame.hot > this.tune.tenseAt ? SCALES.tense : SCALES.calm;
    return scale[Math.round(n * (scale.length - 1))];
  }

  async wire(transport, realtime) {
    transport.bpm.value = 84;
    const limiter = new Tone.Limiter(-3).toDestination();
    this.master = new Tone.Gain(1.7).connect(limiter);
    let out = this.master;
    if (!this.strict) {
      const reverb = new Tone.Reverb({ decay: 4, wet: 0.25 }).connect(this.master);
      await reverb.ready;
      out = reverb;
    }

    this.pan = new Tone.Panner(0).connect(out);
    this.lead = new Tone.Synth({
      oscillator: { type: this.strict ? "sine" : "triangle" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.25 },
      volume: -8,
    }).connect(this.pan);
    const tick = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
      volume: -24,
    }).connect(out);

    // The reference tone is the sound of "no change": the listener's zero line.
    const zero = Tone.Frequency(this.pitch(0, { hot: 0 })).transpose(-24);
    const drone = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 1, sustain: 1, release: 1 },
      volume: -22,
    }).connect(out);
    drone.triggerAttack(zero, realtime ? Tone.now() + 0.05 : 0);

    const filter = new Tone.Filter({ type: "lowpass", frequency: 800 }).connect(out);
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.6, sustain: 0.8, release: 1.2 },
      volume: -24,
    }).connect(filter);

    const barSeconds = (60 / 84) * 4;
    transport.scheduleRepeat((time) => {
      const f = this.frame();
      const s = this.step;
      if (realtime && s === 0) Tone.getDraw().schedule(() => this.onFrame(f, this.index), time);

      if (this.mapping === "scan") {
        if (s % 4 === 0) tick.triggerAttackRelease("32n", time);   // start, 90W, 0, 90E
        const v = f.columns[s];
        if (v !== null) {
          const loudness = 0.25 + 0.75 * clamp(Math.abs(v) / (this.span / 2));
          this.pan.pan.setValueAtTime(-1 + (2 * (s + 0.5)) / 16, time);
          this.lead.triggerAttackRelease(this.pitch(v, f), "16n", time, loudness);
        }
      } else {
        if (s === 0) {
          const [lo, hi] = this.tune.ladder;
          const rung = Math.round(clamp((f.mean - lo) / (hi - lo)) * (LADDER.length - 1));
          pad.triggerAttackRelease(LADDER[rung], barSeconds * 0.95, time, 0.7);
          filter.frequency.rampTo(300 * 2 ** (3.7 * clamp(f.spread / this.tune.spreadMax)), barSeconds / 2, time);
        }
        if (euclid(Math.min(f.clusters, 13), 16)[s]) tick.triggerAttackRelease("32n", time, 0.8);
      }

      this.step = (s + 1) % 16;
      if (this.step === 0) this.index = (this.index + 1) % this.score.frames.length;
    }, "16n");
  }

  // Live playback. Call this only from a click or key press.
  async play() {
    await Tone.start();
    const transport = Tone.getTransport();
    if (!this.wired) { await this.wire(transport, true); this.wired = true; }
    transport.start();
  }

  pause() { Tone.getTransport().pause(); }

  seek(i) { this.index = clamp(i, 0, this.score.frames.length - 1); this.step = 0; }

  // One note for the map cell under the listening cursor.
  async probe(col, row) {
    await Tone.start();
    if (!this.wired) { await this.wire(Tone.getTransport(), true); this.wired = true; }
    const v = this.frame().grid[row][col];
    if (v === null) return "Land or no data";
    this.pan.pan.rampTo(-1 + (2 * (col + 0.5)) / 36, 0.02);
    this.lead.triggerAttackRelease(this.pitch(v, this.frame()), "8n");
    return `${v > 0 ? "+" : ""}${v.toFixed(1)} ${this.score.units}`;
  }
}

// Render a track to an AudioBuffer: the same engine makes the backup audio files.
export async function renderOffline(score, options, seconds) {
  const buffer = await Tone.Offline(async ({ transport }) => {
    await new Sonifier(score, options).wire(transport, false);
    transport.start(0);
  }, seconds);
  return buffer.get();
}

// Encode an AudioBuffer as 16-bit stereo WAV, for the backup playlist.
export function toWav(buffer) {
  const [l, r] = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const out = new DataView(new ArrayBuffer(44 + l.length * 4));
  const text = (at, s) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); out.setUint32(4, 36 + l.length * 4, true); text(8, "WAVEfmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); text(36, "data");
  out.setUint32(40, l.length * 4, true);
  for (let i = 0; i < l.length; i++) {
    out.setInt16(44 + i * 4, clamp(l[i], -1, 1) * 32767, true);
    out.setInt16(46 + i * 4, clamp(r[i], -1, 1) * 32767, true);
  }
  return new Blob([out], { type: "audio/wav" });
}

export { Tone };
