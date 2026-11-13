// Audio engine, Caldwell 73 style: a deep hum that swells with the light, ringing sampled notes,
// stereo along the scan line (top = left ear, bottom = right), per-voice reverb sends.
// Tone.js comes from the page's own bundle (global EJ), so both engines share one audio context.

import { midiToNote, clamp } from './music.js';

const T = window.EJ.Tone;

const NOTE_FILES = ['C3', 'E3', 'Ab3', 'C4', 'E4', 'Ab4', 'C5', 'E5', 'Ab5', 'C6', 'E6'];
// trim (dB) evens out the soundfont's very quiet samples so every instrument sits at the same level
export const INSTRUMENTS = {
  harp: { label: 'Harp', trim: 12 },
  celesta: { label: 'Celesta', trim: 11 },
  vibraphone: { label: 'Vibraphone', trim: 15 },
  music_box: { label: 'Music box', trim: 10 },
  kalimba: { label: 'Kalimba', trim: 13 },
};
const CELLO = { notes: ['C2', 'E2', 'Ab2', 'C3', 'E3', 'Ab3', 'C4'], trim: 3 };

const BASE_MASTER_DB = 5;
const PAN_SLOTS = 9;          // notes are placed in the nearest of 9 positions along the line
const HUM_GAIN = 0.25;        // hum at full light, before its level trim (set by offline render)
const TENSE_NOTES = [53, 55]; // F3 and G3: a semitone above E3 and below G#3, for gentle dissonance
const TENSE_GAIN = 0.55;      // how much of that the hum takes on at full tension
const BEAT_TRIM_DB = -17;     // soft: felt more than heard (set by offline render)
const dbToGain = (db) => Math.pow(10, db / 20);
const sampleDir = (name) => `samples/${name}/`;

/** Warm the HTTP cache so building the audio graph on first Play is quick. */
export function prefetchSamples(instrument) {
  for (const n of NOTE_FILES) fetch(`${sampleDir(instrument)}${n}.mp3`).catch(() => {});
  for (const n of CELLO.notes) fetch(`${sampleDir('cello')}${n}.mp3`).catch(() => {});
}

function loadBuffers(dir, notes) {
  return new Promise((resolve, reject) => {
    const b = new T.ToneAudioBuffers({
      urls: Object.fromEntries(notes.map((n) => [n, `${n}.mp3`])),
      baseUrl: dir,
      onload: () => resolve(b),
      onerror: (e) => reject(e),
    });
  });
}

// Synth stand-ins if samples cannot load (blocked fetch, offline…).
function fallbackVoice(kind) {
  const s = kind === 'cello'
    ? new T.PolySynth(T.AMSynth, { harmonicity: 1, envelope: { attack: 0.09, decay: 0.4, sustain: 0.6, release: 1.0 } })
    : new T.PolySynth(T.FMSynth, {
      harmonicity: 2, modulationIndex: 1.2,
      envelope: { attack: 0.004, decay: 1.6, sustain: 0, release: 1.2 },
      modulationEnvelope: { attack: 0.004, decay: 0.5, sustain: 0, release: 0.5 },
    });
  s.volume.value = -14;
  return s;
}

export class AudioEngine {
  /** @param {{offline?: boolean, humNotes: number[], settings: object}} opts */
  constructor({ offline = false, humNotes = [], settings }) {
    this.offline = offline;
    this.humNotes = humNotes;
    this.settings = settings;
    this.ready = false;
    this.usingFallback = [];
    this.userDb = 0;
    this.muted = new Set();   // mixer: 'notes' | 'cello' | 'hum'
    this.nodes = [];
  }

  /** Build the graph and load samples. Call after a user gesture (or inside Tone.Offline). */
  async init() {
    // Every node goes through k(), so dispose() frees the whole graph when the listener changes track.
    const k = (node) => this._keep(node);
    this.limiter = k(new T.Limiter(-1)).toDestination();
    if (!this.offline) {   // a tap for the on-screen waveform; it changes nothing you hear
      this.wave = k(new T.Waveform(512));
      this.limiter.connect(this.wave);
    }
    this.out = k(new T.Volume(this.userDb)).connect(this.limiter);       // the listener's volume slider
    this.master = k(new T.Volume(BASE_MASTER_DB)).connect(this.out);     // master trim
    this.reverb = k(new T.Reverb({ decay: 6, preDelay: 0.03, wet: 1 })).connect(this.master);

    // A voice bus: level -> master, plus a send to the hall.
    const bus = () => {
      const level = k(new T.Gain(1)).connect(this.master);
      const send = k(new T.Gain(0)).connect(this.reverb);
      level.connect(send);
      return { level, send };
    };
    // Pan positions along the scan line: slot 0 = top (left ear) … last = bottom (right ear).
    const slots = (dest) => [...Array(PAN_SLOTS)].map(() => k(new T.Panner(0)).connect(dest));

    this.notes = { ...bus(), samplers: [], trim: 0 };
    this.notes.panners = slots(this.notes.level);
    this.cello = { ...bus(), samplers: [], trim: CELLO.trim };
    this.cello.panners = slots(this.cello.level);

    // Hum: an open E chord of soft detuned saws through a low-pass that opens with the light.
    this.humBus = bus();
    this.humPanner = k(new T.Panner(0)).connect(this.humBus.level);
    this.humGain = k(new T.Gain(0)).connect(this.humPanner);
    this.humFilter = k(new T.Filter({ type: 'lowpass', frequency: 160, rolloff: -24, Q: 0.5 })).connect(this.humGain);
    const humVolumes = [0, -5, -4, -9];
    this.humNotes.forEach((midi, i) => {
      const osc = k(new T.FatOscillator({
        frequency: T.Frequency(midi, 'midi').toFrequency(), type: 'sawtooth', count: 3, spread: 9,
      })).connect(this.humFilter);
      osc.volume.value = humVolumes[i] ?? -9;
      osc.start();
    });
    // "Bad news gets less calm": clashing notes that fade into the hum as the data turns harmful.
    this.tenseGain = k(new T.Gain(0)).connect(this.humFilter);
    for (const midi of TENSE_NOTES) {
      const osc = k(new T.FatOscillator({
        frequency: T.Frequency(midi, 'midi').toFrequency(), type: 'sawtooth', count: 3, spread: 16,
      })).connect(this.tenseGain);
      osc.volume.value = -3;
      osc.start();
    }
    // Heartbeat: a soft low double thump, dry and centred.
    this.beatGain = k(new T.Gain(1)).connect(this.master);
    this.beatSynth = k(new T.MembraneSynth({
      pitchDecay: 0.045, octaves: 1.6, oscillator: { type: 'sine' },
      envelope: { attack: 0.004, decay: 0.32, sustain: 0, release: 0.1 },
    })).connect(this.beatGain);

    await Promise.all([
      this._loadVoice(this.cello, 'cello', CELLO.notes, 'cello'),
      this.setInstrument(this.settings.instrument),
    ]);
    this.apply();
    await this.reverb.ready;
    this.ready = true;
  }

  async _loadVoice(voice, dirName, notes, kind) {
    let samplers;
    try {
      const buffers = await loadBuffers(sampleDir(dirName), notes);
      const urls = Object.fromEntries(notes.map((n) => [n, buffers.get(n)]));
      samplers = voice.panners.map((p) => this._keep(new T.Sampler({ urls, release: 1 }).connect(p)));
      this.usingFallback = this.usingFallback.filter((k) => k !== kind);
    } catch (err) {
      console.warn(`Samples for ${dirName} failed; using synth fallback`, err);
      if (!this.usingFallback.includes(kind)) this.usingFallback.push(kind);
      const centre = voice.panners[(PAN_SLOTS - 1) / 2];
      samplers = voice.panners.map(() => null);
      samplers[(PAN_SLOTS - 1) / 2] = this._keep(fallbackVoice(kind).connect(centre));
    }
    const old = voice.samplers;
    voice.samplers = samplers;
    for (const s of old) s?.dispose();
  }

  /** Swap the note instrument (dev panel). */
  async setInstrument(name) {
    const inst = INSTRUMENTS[name] ?? INSTRUMENTS.harp;
    await this._loadVoice(this.notes, INSTRUMENTS[name] ? name : 'harp', NOTE_FILES, 'notes');
    this.notes.trim = inst.trim;
    this.instrument = name;
    if (this.master) this.apply();
  }

  /** Push the current settings into the graph. Cheap; call on every dev-panel change. */
  apply() {
    const s = this.settings;
    const on = (id) => (this.muted.has(id) ? 0 : 1);
    this.master.volume.value = BASE_MASTER_DB + s.master;
    this.notes.level.gain.value = on('notes') * dbToGain(this.notes.trim + s.notes);
    this.cello.level.gain.value = on('cello') * dbToGain(this.cello.trim + s.cello);
    this.humBus.level.gain.value = on('hum') * dbToGain(s.hum);
    this.notes.send.gain.value = s.notesReverb;
    this.cello.send.gain.value = s.notesReverb;
    this.humBus.send.gain.value = s.humReverb;
    this.beatGain.gain.value = on('beat') * dbToGain(BEAT_TRIM_DB + (s.beat ?? 0));
    for (const voice of [this.notes, this.cello]) {
      voice.panners.forEach((p, i) => { p.pan.value = ((i / (PAN_SLOTS - 1)) * 2 - 1) * s.width; });
    }
    for (const smp of this.notes.samplers) if (smp && 'release' in smp) smp.release = Math.max(0.3, s.ring * 0.6);
  }

  async unlock() {
    if (!this.offline && T.getContext().state !== 'running') await T.start();
  }

  now() { return T.now(); }

  /** @param pos position along the scan line: -1 = top (north) … +1 = bottom (south) */
  play(ev, time, pos) {
    const voice = ev.voice === 'cello' ? this.cello : this.notes;
    const slot = Math.round(((clamp(pos, -1, 1) + 1) / 2) * (PAN_SLOTS - 1));
    const smp = voice.samplers[slot] ?? voice.samplers[(PAN_SLOTS - 1) / 2];
    smp?.triggerAttackRelease(midiToNote(ev.midi), ev.duration, time, ev.velocity);
  }

  /** Glide the hum to a new loudness, brightness and position along the line. */
  setHum(level, pos, time, ramp, tension = 0) {
    const end = time + ramp;
    this.humGain.gain.linearRampToValueAtTime(level * HUM_GAIN, end);
    this.humFilter.frequency.linearRampToValueAtTime(160 + 1500 * level * level + 700 * tension, end);
    this.humPanner.pan.linearRampToValueAtTime(clamp(pos, -1, 1) * this.settings.width, end);
    this.tenseGain.gain.linearRampToValueAtTime(tension * TENSE_GAIN, end);
  }

  /** One heartbeat: "lub-dub". */
  beat(time, velocity) {
    // The drum is one voice and can only be scheduled forwards in time; after a seek, a beat
    // that would land before the previous beat's second thump is simply skipped.
    if (time <= (this._beatBusyUntil ?? -1)) return;
    this._beatBusyUntil = time + 0.4;
    this.beatSynth.triggerAttackRelease('E2', 0.2, time, velocity);
    this.beatSynth.triggerAttackRelease('B1', 0.2, time + 0.19, velocity * 0.6);
  }

  /** Fade everything quickly (pause / seek). */
  silence() {
    const t = T.now();
    for (const p of [this.humGain.gain, this.humFilter.frequency, this.humPanner.pan, this.tenseGain.gain]) p.cancelScheduledValues(t);
    this.humGain.gain.setValueAtTime(this.humGain.gain.value, t);
    this.humGain.gain.linearRampToValueAtTime(0, t + 0.25);
    for (const voice of [this.notes, this.cello]) for (const s of voice.samplers) s?.releaseAll(t);
    if (!this.offline) T.getDraw().cancel(0);
  }

  setVolume(db) {
    this.userDb = db;
    this.out?.volume.rampTo(db, 0.1);
  }

  _keep(node) { this.nodes.push(node); return node; }

  /** Free every node. The engine cannot be used afterwards. */
  dispose() {
    this.ready = false;
    if (!this.offline) T.getDraw().cancel(0);
    for (const n of this.nodes.splice(0)) { try { n.dispose(); } catch { /* already gone */ } }
  }

  /** Run a callback in sync with the audio clock (for visuals). */
  draw(cb, time) { if (!this.offline) T.getDraw().schedule(cb, time); }
}
