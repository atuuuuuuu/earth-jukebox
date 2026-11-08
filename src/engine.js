// engine.js: synthesises a score live in the browser with Tone.js.
import * as Tone from "tone";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const euclid = (hits, steps) => Array.from({ length: steps }, (_, i) => (i * hits) % steps < hits);

export const TEMPO = 84;      // Normal speed. One bar (16 steps) per frame.
export const STEPS = 16;

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

// Volume 0..100 to master gain. Squared so the slider feels even to the ear; 100 = the tuned level.
const gainFor = (volume) => 1.7 * (clamp(volume / 100)) ** 2;

export class Sonifier {
  constructor(score, {
    mapping = "scan", strict = false, bpm = TEMPO, volume = 100, mono = false, startIndex = 0,
    onFrame = () => {}, onStep = () => {},
  } = {}) {
    Object.assign(this, { score, mapping, strict, bpm, volume, mono, onFrame, onStep, index: 0, step: 0 });
    this.span = score.range[1] - score.range[0];
    // Track settings. Set them once per track and publish them with the method.
    this.tune = { ladder: [-1, 2], spreadMax: 3, tenseAt: 0.25, ...score.tuning };
    // One fixed range for the whole track. Never rescale per frame: a hot year must sound hot.
    this.norm = (v) => clamp((v - score.range[0]) / this.span);
    this.nodes = [];
    this.disposed = false;
    // Then-vs-now tracks: the first label heard is "then" (low cue), the other is "now" (high cue).
    const labels = [...new Set(score.frames.map((f) => f.label).filter(Boolean))];
    this.thenLabel = labels[0] ?? null;
    this.seek(startIndex);
  }

  frame() { return this.score.frames[this.index]; }

  pitch(v, frame) {
    const n = this.norm(v);
    if (this.strict) return 220 * 2 ** (2 * n);        // Strict: continuous, no scale.
    const scale = frame.hot > this.tune.tenseAt ? SCALES.tense : SCALES.calm;
    return scale[Math.round(n * (scale.length - 1))];
  }

  // True when this frame should ring the El Niño bell. Data, not decoration.
  bellFor(f) {
    const line = this.score.ninoLine;
    return typeof f.nino34Relative === "number" && typeof line === "number" && f.nino34Relative > line;
  }

  panFor(x) { return this.mono ? 0 : x; }

  async wire(transport, realtime) {
    const keep = (node) => { this.nodes.push(node); return node; };
    transport.bpm.value = this.bpm;
    // The limiter stays last in the chain, so nothing (the bell included) can clip.
    const limiter = keep(new Tone.Limiter(-3).toDestination());
    this.master = keep(new Tone.Gain(gainFor(this.volume)).connect(limiter));
    let out = this.master;
    if (!this.strict) {
      const reverb = keep(new Tone.Reverb({ decay: 4, wet: 0.25 }).connect(this.master));
      await reverb.ready;
      // The listener may have switched track while the reverb was being built.
      if (this.disposed) { this.free(); return false; }
      out = reverb;
    }

    this.pan = keep(new Tone.Panner(0).connect(out));
    this.lead = keep(new Tone.Synth({
      oscillator: { type: this.strict ? "sine" : "triangle" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.25 },
      volume: -8,
    }).connect(this.pan));
    const tick = keep(new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
      volume: -24,
    }).connect(out));

    // The reference tone is the sound of "no change": the listener's zero line.
    this.zero = Tone.Frequency(this.pitch(0, { hot: 0 })).transpose(-24);
    this.drone = keep(new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 1, sustain: 1, release: 1 },
      volume: -22,
    }).connect(out));
    // Live: the drone follows play / pause. Offline: it sounds for the whole render.
    if (!realtime) this.drone.triggerAttack(this.zero, 0);

    const filter = keep(new Tone.Filter({ type: "lowpass", frequency: 800 }).connect(out));
    const pad = keep(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.6, sustain: 0.8, release: 1.2 },
      volume: -24,
    }).connect(filter));

    // The El Niño bell: short, bright and metallic, nothing like the lead or the tick.
    // Centred, so it reads the same with one earbud.
    const bell = keep(new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 14,
      oscillator: { type: "sine" },
      modulation: { type: "square" },
      envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
      volume: -10,
    }).connect(out));
    // The then / now cue: one plain note, quieter than the bell.
    const cue = keep(new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.1 },
      volume: -20,
    }).connect(out));

    const draw = Tone.getDraw();
    transport.scheduleRepeat((time) => {
      const f = this.frame();
      const s = this.step;
      const index = this.index;
      if (realtime) {
        if (s === 0) draw.schedule(() => { if (!this.disposed) this.onFrame(f, index); }, time);
        draw.schedule(() => { if (!this.disposed) this.onStep(s, index); }, time);
      }

      if (s === 0) {
        if (this.bellFor(f)) bell.triggerAttackRelease("C6", "8n", time, 0.9);
        if (f.label) cue.triggerAttackRelease(f.label === this.thenLabel ? "C3" : "C5", "16n", time, 0.6);
      }

      if (this.mapping === "scan") {
        if (s % 4 === 0) tick.triggerAttackRelease("32n", time);   // the four quarters of the map
        const v = f.columns[s];
        if (v !== null) {
          const loudness = 0.25 + 0.75 * clamp(Math.abs(v) / (this.span / 2));
          this.pan.pan.setValueAtTime(this.panFor(-1 + (2 * (s + 0.5)) / STEPS), time);
          this.lead.triggerAttackRelease(this.pitch(v, f), "16n", time, loudness);
        }
      } else {
        if (s === 0 && f.mean !== null) {
          const barSeconds = (60 / this.bpm) * 4;
          const [lo, hi] = this.tune.ladder;
          const rung = Math.round(clamp((f.mean - lo) / (hi - lo)) * (LADDER.length - 1));
          pad.triggerAttackRelease(LADDER[rung], barSeconds * 0.95, time, 0.7);
          filter.frequency.rampTo(300 * 2 ** (3.7 * clamp(f.spread / this.tune.spreadMax)), barSeconds / 2, time);
        }
        if (euclid(Math.min(f.clusters, 13), STEPS)[s]) tick.triggerAttackRelease("32n", time, 0.8);
      }

      this.step = (s + 1) % STEPS;
      if (this.step === 0) this.index = (this.index + 1) % this.score.frames.length;
    }, "16n");
    return true;
  }

  // Build the live graph once, even if play() and probe() race.
  ensureWired() {
    if (!this.wiring) this.wiring = this.wire(Tone.getTransport(), true).then((ok) => (this.wired = ok));
    return this.wiring;
  }

  // Live playback. Call this only from a click or key press.
  async play() {
    await Tone.start();
    if (this.disposed) return false;
    if (!(await this.ensureWired()) || this.disposed) return false;
    this.drone.triggerAttack(this.zero, Tone.now() + 0.05);
    Tone.getTransport().start();
    this.playing = true;
    return true;
  }

  pause() {
    Tone.getTransport().pause();
    if (this.drone) this.drone.triggerRelease(Tone.now());
    this.playing = false;
  }

  seek(i) { this.index = clamp(Math.round(i), 0, this.score.frames.length - 1); this.step = 0; }

  // Live settings. They apply within one step; pass them to the next Sonifier too.
  setTempo(bpm) { this.bpm = bpm; Tone.getTransport().bpm.value = bpm; }
  setVolume(volume) {
    this.volume = volume;
    if (this.master) this.master.gain.rampTo(gainFor(volume), 0.05);
  }
  setMono(mono) {
    this.mono = mono;
    if (mono && this.pan) this.pan.pan.rampTo(0, 0.02);
  }

  // One note for the map cell under the listening cursor.
  async probe(col, row) {
    await Tone.start();
    if (!(await this.ensureWired()) || this.disposed) return "";
    const v = this.frame().grid[row][col];
    if (v === null) return "Land or no data";
    this.pan.pan.rampTo(this.panFor(-1 + (2 * (col + 0.5)) / 36), 0.02);
    this.lead.triggerAttackRelease(this.pitch(v, this.frame()), "8n");
    return `${v > 0 ? "+" : ""}${v.toFixed(1)} ${this.score.units}`;
  }

  free() {
    for (const node of this.nodes.splice(0)) {
      try { node.dispose(); } catch { /* already gone */ }
    }
  }

  // Stop everything this Sonifier scheduled and release its nodes. Call before building the next one.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.playing = false;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    Tone.getDraw().cancel(0);
    this.free();
  }
}

const signed = (v, d = 1) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(d)}`;
const lonName = (lon) => {
  const l = ((lon + 540) % 360) - 180;
  if (Math.abs(l) < 0.01) return "0 degrees";
  if (Math.abs(Math.abs(l) - 180) < 0.01) return "180 degrees";
  return `${Math.round(Math.abs(l))} degrees ${l < 0 ? "west" : "east"}`;
};

// The spoken key: what every sound means, built from the score's own numbers.
export function keyText(score) {
  const [lo, hi] = score.range;
  const u = score.units;
  const t = { ladder: [-1, 2], spreadMax: 3, tenseAt: 0.25, ...score.tuning };
  const left = score.leftLon ?? -180;
  const quarters = [0, 4, 8, 12].map((s) => lonName(left + s * 22.5));
  const parts = [
    `Key. Higher pitch means warmer than normal. The lowest note is ${signed(lo, 0)} ${u}, the highest ${signed(hi, 0)} ${u}, on one fixed scale for the whole track.`,
    `Scan mode plays each map moment as ${STEPS} notes, west to east, moving from your left ear to your right. Louder notes are further from normal.`,
    `Silence is land, or no data.`,
    `A soft tick marks each quarter of the map: ${quarters.join(", ")}.`,
    `The low steady hum is the zero line: 0 ${u}, no change from normal.`,
    `When more than ${Math.round(t.tenseAt * 100)} percent of the ocean is above the hot line of ${signed(score.hotLine)} ${u}, the scale turns darker.`,
    `Planet Chord mode plays the whole map at once: the chord grows rougher as the map average rises from ${signed(t.ladder[0], 0)} to ${signed(t.ladder[1], 0)} ${u}, brighter when the map is uneven, and the ticks count the hot patches.`,
  ];
  if (typeof score.ninoLine === "number") {
    parts.push(`A bright bell at the start of a moment means El Niño: the Niño 3.4 box in the Pacific is more than ${signed(score.ninoLine)} ${u} warmer than the tropical ocean as a whole.`);
  }
  const labels = [...new Set(score.frames.map((f) => f.label).filter(Boolean))];
  if (labels.length >= 2) {
    parts.push(`Moments come in pairs. A low note before a moment means ${labels[0]}, a high note means ${labels[1]}.`);
  }
  return parts.join(" ");
}

// Seconds for one full pass of a score at a tempo: one bar per frame.
export const passSeconds = (score, bpm = TEMPO) => score.frames.length * (60 / bpm) * 4;

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
  const [l, r] = [buffer.getChannelData(0), buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)];
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
