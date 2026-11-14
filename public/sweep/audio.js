// Audio engine, Caldwell 73 style: a deep hum that swells with the light, ringing sampled notes,
// stereo along the scan line (top = left ear, bottom = right), per-voice reverb sends.
// Lightning (settings.bed 'orchestra', settings.sweepPan) instead has a bowed bed, a storm wind,
// and one panner that travels with the scan line: west = left ear, east = right ear.
// Tone.js comes from the page's own bundle (global EJ), so both engines share one audio context.

import { midiToNote, clamp } from './music.js';

const T = window.EJ.Tone;

const NOTE_FILES = ['C3', 'E3', 'Ab3', 'C4', 'E4', 'Ab4', 'C5', 'E5', 'Ab5', 'C6', 'E6'];
// Lightning plays in E flat: these are the notes of its home chord (see fetch_samples.py).
const EB_FILES = ['Eb3', 'G3', 'Bb3', 'Eb4', 'G4', 'Bb4', 'Eb5', 'G5', 'Bb5', 'Eb6', 'G6'];
// trim (dB) evens out the soundfont's very quiet samples so every instrument sits at the same level
export const INSTRUMENTS = {
  harp: { label: 'Harp', trim: 12, notes: EB_FILES },
  celesta: { label: 'Celesta', trim: 11 },
  vibraphone: { label: 'Vibraphone', trim: 15 },
  music_box: { label: 'Music box', trim: 10 },
  kalimba: { label: 'Kalimba', trim: 13 },
};
const CELLO = { notes: ['C2', 'E2', 'Ab2', 'C3', 'E3', 'Ab3', 'C4'], trim: 3 };
// Lightning's orchestra (settings.bed === 'orchestra'): bowed samples in place of the synth hum.
// attack and release (s) are the bow: every note fades in and out slowly, never a sharp start.
// trim: bass 3 dB and strings 5 dB below where they were first set by ear (6 and 7 dB), to make
// room for the marks and the storm wind.
const ORCHESTRA = {
  bass: { dir: 'contrabass', notes: ['D1', 'Eb1', 'Bb1', 'D2', 'Eb2'], trim: 1, attack: 1.0, release: 1.2 },
  // A flat and C as well, so most chord notes need no pitching up (a pitched-up sample is shorter).
  // The strings are a cloud of sustained notes, one per band of latitude (setStrings): each note is
  // re-bowed every `stroke` seconds, and as one stroke fades out over `fade` the next fades in over
  // the same time, so the note never breaks. `enter` is the quicker fade-in of a note that starts.
  strings: { dir: 'strings', notes: [...EB_FILES.slice(0, 8), 'Ab3', 'C4', 'Ab4', 'C5', 'Ab5'], trim: 7, stroke: 1.2, fade: 1.0, enter: 0.3 },
};
// Levels set by offline render: about a third of the energy below 60 Hz, about 70% below 250 Hz,
// and the same average loudness as the other tracks.
const SUB_GAIN = 0.035;       // a sine under the contrabass, on the same note: the sub-bass
const BASS_REVERB = 0.5;      // the bass sends this share of the hum's reverb: low notes blur a hall
// Lightning's storm wind: pink noise in two soft bands that drift like gusts. Its level follows the
// marks near the line through slow glides (seconds to reach about two thirds of a change).
const WIND = { trim: -4, gain: 0.5, rise: 0.5, fall: 1.0, low: 260, high: 620 };
// Lightning's mark notes are "muted": the harp through a gentle low-pass. Compare mode opens it a
// little, so its rising and falling figures are clear.
const NOTE_TONE = { marks: 1700, compare: 3200 };

const BASE_MASTER_DB = 5;
const PAN_SLOTS = 9;          // notes are placed in the nearest of 9 positions along the line
const HUM_GAIN = 0.25;        // hum at full light, before its level trim (set by offline render)
const TENSE_NOTES = [53, 55]; // F3 and G3: a semitone above E3 and below G#3, for gentle dissonance
const TENSE_GAIN = 0.55;      // how much of that the hum takes on at full tension
const BEAT_TRIM_DB = -17;     // soft: felt more than heard (set by offline render)
const dbToGain = (db) => Math.pow(10, db / 20);
const midiHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const sampleDir = (name) => `samples/${name}/`;
const filesFor = (instrument) => INSTRUMENTS[instrument]?.notes ?? NOTE_FILES;

/** Warm the HTTP cache so building the audio graph on first Play is quick. */
export function prefetchSamples(instrument) {
  for (const n of filesFor(instrument)) fetch(`${sampleDir(instrument)}${n}.mp3`).catch(() => {});
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

    // A voice bus: level -> dest (the master, unless set), plus a send to the hall from `tap`.
    const bus = (dest = this.master, tap = null) => {
      const level = k(new T.Gain(1)).connect(dest);
      const send = k(new T.Gain(0)).connect(this.reverb);
      (tap ?? level).connect(send);
      return { level, send };
    };
    // Pan positions along the scan line: slot 0 = top (left ear) … last = bottom (right ear).
    const slots = (dest) => [...Array(PAN_SLOTS)].map(() => k(new T.Panner(0)).connect(dest));

    // Lightning: one panner that travels with the scan line, west = left ear, east = right ear
    // (setLayers). The notes reach it through a gentle low-pass that mutes them. The hall stays
    // unpanned: the dry sound moves, the room does not.
    if (this.settings.sweepPan) {
      this.sweepPan = k(new T.Panner(0)).connect(this.master);
      this.noteTone = k(new T.Filter({ type: 'lowpass', frequency: NOTE_TONE.marks, rolloff: -12, Q: 0.4 })).connect(this.sweepPan);
      this._panFresh = true;
    }
    // level -> tone -> pan, and the send leaves after the tone, so the hall hears the muted note too
    this.notes = { ...(this.sweepPan ? bus(this.noteTone, this.noteTone) : bus()), samplers: [], trim: 0 };
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
    for (const midi of this.settings.bed === 'orchestra' ? [] : TENSE_NOTES) {
      const osc = k(new T.FatOscillator({
        frequency: T.Frequency(midi, 'midi').toFrequency(), type: 'sawtooth', count: 3, spread: 16,
      })).connect(this.tenseGain);
      osc.volume.value = -3;
      osc.start();
    }
    // The orchestra bed (lightning). Bass: contrabass through a low-pass that opens with the
    // lightning, over a sine on the same note, centred. Strings: one bowed chord. Wind: soft noise.
    // Each sits behind a gain that the data glides, so the data sets how loud they are. With the
    // sweep panner, strings and wind travel with the scan line; the bass always stays centred.
    if (this.settings.bed === 'orchestra') {
      const moving = this.sweepPan ?? this.master;
      const o = this.orch = { bassBus: bus(), stringsBus: bus(moving), windBus: bus(moving) };
      o.bassGain = k(new T.Gain(0)).connect(o.bassBus.level);
      o.bassFilter = k(new T.Filter({ type: 'lowpass', frequency: 120, rolloff: -12, Q: 0.5 })).connect(o.bassGain);
      o.subGain = k(new T.Gain(SUB_GAIN)).connect(o.bassGain);
      o.sub = k(new T.Oscillator({ frequency: midiHz(27), type: 'sine' })).connect(o.subGain);
      o.sub.start();
      // The string cloud's bands each have their own level (setStrings); this only gathers them.
      o.stringsPanner = k(new T.Panner(0)).connect(o.stringsBus.level);
      o.stringsGain = k(new T.Gain(1)).connect(o.stringsPanner);
      // Wind: pink noise -> two band-passes, each with its own slow swaying level (gusts), -> the
      // data's gain. Only the gain and the band's centre follow the data.
      o.windGain = k(new T.Gain(0)).connect(o.windBus.level);
      o.windNoise = k(new T.Noise('pink'));
      o.windBands = [[WIND.low, 0.9, 0.071], [WIND.low * 2.3, 1.3, 0.113]].map(([f, q, rate], i) => {
        const band = k(new T.Filter({ type: 'bandpass', frequency: f, Q: q }));
        const sway = k(new T.Gain(1)).connect(o.windGain);
        k(new T.LFO({ frequency: rate, min: i ? 0.2 : 0.45, max: i ? 0.7 : 1, phase: i * 140 })).connect(sway.gain).start();
        o.windNoise.connect(band);
        band.connect(sway);
        return band;
      });
      o.windNoise.start();
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
      ...(this.orch ? [this._loadBowed('bass', this.orch.bassFilter), this._loadStrings(this.orch.stringsGain)] : []),
    ]);
    this.apply();
    await this.reverb.ready;
    this.ready = true;
  }

  /** One bowed voice of the orchestra: a sampler with slow fades, or a soft synth if samples fail. */
  async _loadBowed(name, dest) {
    const spec = ORCHESTRA[name];
    let voice;
    try {
      const buffers = await loadBuffers(sampleDir(spec.dir), spec.notes);
      const urls = Object.fromEntries(spec.notes.map((n) => [n, buffers.get(n)]));
      // Linear fades: the sampler's default (exponential) is over in a fifth of the time, a jab not a bow.
      voice = new T.Sampler({ urls, attack: spec.attack, release: spec.release, curve: 'linear' });
    } catch (err) {
      console.warn(`Samples for ${spec.dir} failed; using synth fallback`, err);
      if (!this.usingFallback.includes(name)) this.usingFallback.push(name);
      voice = new T.PolySynth(T.AMSynth, {
        harmonicity: 1, envelope: { attack: spec.attack, decay: 0.3, sustain: 0.8, release: spec.release },
      });
      voice.volume.value = -14;
    }
    this.orch[name] = { sampler: this._keep(voice.connect(dest)), strokeAt: -Infinity, tag: null };
  }

  /** The string cloud: one sampler and one level per band of latitude, sharing the same samples. */
  async _loadStrings(dest) {
    const spec = ORCHESTRA.strings, n = this.settings.stringBands ?? 0;
    let make;
    try {
      const buffers = await loadBuffers(sampleDir(spec.dir), spec.notes);
      const urls = Object.fromEntries(spec.notes.map((x) => [x, buffers.get(x)]));
      make = () => new T.Sampler({ urls, attack: spec.fade, release: spec.fade, curve: 'linear' });
    } catch (err) {
      console.warn(`Samples for ${spec.dir} failed; using synth fallback`, err);
      if (!this.usingFallback.includes('strings')) this.usingFallback.push('strings');
      make = () => {
        const s = new T.PolySynth(T.AMSynth, { harmonicity: 1, envelope: { attack: spec.fade, decay: 0.3, sustain: 0.8, release: spec.fade } });
        s.volume.value = -14;
        return s;
      };
    }
    this.orch.stringBands = [...Array(n)].map(() => {
      const gain = this._keep(new T.Gain(0).connect(dest));
      return { gain, sampler: this._keep(make().connect(gain)), note: null, at: -Infinity };
    });
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
    const dir = INSTRUMENTS[name] ? name : 'harp';
    await this._loadVoice(this.notes, dir, filesFor(dir), 'notes');
    this.notes.trim = inst.trim;
    this.instrument = name;
    if (this.master) this.apply();
  }

  /** Push the current settings into the graph. Cheap; call on every dev-panel change. */
  apply() {
    const s = this.settings;
    const on = (id) => (this.muted.has(id) ? 0 : 1);
    this.master.volume.value = BASE_MASTER_DB + s.master;
    this.notes.level.gain.value = on('notes') * dbToGain(this.notes.trim + s.notes + (s.compare ? s.compareBoost ?? 0 : 0));
    this.cello.level.gain.value = on('cello') * dbToGain(this.cello.trim + s.cello);
    this.humBus.level.gain.value = on('hum') * dbToGain(s.hum);
    this.notes.send.gain.value = s.notesReverb;
    this.cello.send.gain.value = s.notesReverb;
    this.humBus.send.gain.value = s.humReverb;
    this.beatGain.gain.value = on('beat') * dbToGain(BEAT_TRIM_DB + (s.beat ?? 0));
    if (this.orch) {   // the bed takes the hum's place in the mix: same level setting, same mute
      const o = this.orch;
      o.bassBus.level.gain.value = on('hum') * dbToGain(ORCHESTRA.bass.trim + s.hum);
      o.stringsBus.level.gain.value = on('hum') * dbToGain(ORCHESTRA.strings.trim + s.hum);
      o.bassBus.send.gain.value = s.humReverb * BASS_REVERB;
      o.stringsBus.send.gain.value = s.notesReverb;
      o.windBus.level.gain.value = on('hum') * dbToGain(WIND.trim + s.hum);
      o.windBus.send.gain.value = s.humReverb;
    }
    if (this.noteTone) this.noteTone.frequency.value = s.compare ? NOTE_TONE.compare : NOTE_TONE.marks;
    // With the sweep panner the slots stay centred: the panner alone places every note.
    const slotWidth = this.sweepPan ? 0 : s.width;
    for (const voice of [this.notes, this.cello]) {
      voice.panners.forEach((p, i) => { p.pan.value = ((i / (PAN_SLOTS - 1)) * 2 - 1) * slotWidth; });
    }
    for (const smp of this.notes.samplers) if (smp && 'release' in smp) smp.release = Math.max(0.3, s.ring * 0.6);
  }

  async unlock() {
    if (!this.offline && T.getContext().state !== 'running') await T.start();
  }

  now() { return T.now(); }

  /**
   * @param pos position along the scan line: -1 = top (north) … +1 = bottom (south).
   *   Ignored with the sweep panner, which places every note where the scan line is.
   */
  play(ev, time, pos) {
    if (ev.bed) { this._bow(ev, time); return; }
    const voice = ev.voice === 'cello' ? this.cello : this.notes;
    const slot = this.sweepPan ? (PAN_SLOTS - 1) / 2 : Math.round(((clamp(pos, -1, 1) + 1) / 2) * (PAN_SLOTS - 1));
    const smp = voice.samplers[slot] ?? voice.samplers[(PAN_SLOTS - 1) / 2];
    smp?.triggerAttackRelease(midiToNote(ev.midi), ev.duration, time, ev.velocity);
  }

  /**
   * One bow stroke of the bass: ev.voice 'bass', ev.notes [[midi, velocity], …].
   * The mapping sends the bed on every step; a voice is bowed again only when its last stroke is
   * ev.period seconds old, or when ev.tag (the chord) has changed and the stroke is past its peak.
   * So the bed starts at once after a pause or a jump, and never piles up.
   */
  _bow(ev, time) {
    const v = this.orch?.[ev.voice];
    if (!v) return;
    const age = time - v.strokeAt;
    if (age < ev.period - 0.02 && !(ev.tag !== v.tag && age >= ev.period * 0.6)) return;
    v.strokeAt = time;
    v.tag = ev.tag;
    for (const [midi, velocity] of ev.notes) v.sampler.triggerAttackRelease(midiToNote(midi), ev.duration, time, velocity);
    if (ev.sub) this.orch.sub.frequency.setTargetAtTime(midiHz(ev.sub), time, 0.4);   // the sine glides to the bass note
  }

  /** Glide the bass to `bass` (0..1); `fullness` (0..1) opens its low-pass over storms. */
  setBed(bass, fullness, time, ramp) {
    const o = this.orch, end = time + ramp;
    if (!o) return;
    o.bassGain.gain.linearRampToValueAtTime(bass, end);
    o.bassFilter.frequency.linearRampToValueAtTime(120 + 520 * fullness, end);
  }

  /**
   * The string cloud for one step: S.levels[b] (0..1) and S.notes[b] (MIDI) for each band of
   * latitude. Each band's level glides there over `ramp`, so the strings follow the lightning as
   * the line moves. A band that sounds is re-bowed every stroke, or at once when its note changes
   * (a new chord); a band that falls silent stops being bowed, and enters again quickly.
   */
  setStrings(S, time, ramp) {
    const bands = this.orch?.stringBands;
    if (!bands?.length || !S) return;
    const spec = ORCHESTRA.strings;
    bands.forEach((v, b) => {
      const level = S.levels[b] ?? 0, note = S.notes[b];
      v.gain.gain.linearRampToValueAtTime(level, time + ramp);
      if (level <= 0) {
        if (v.note !== null) { v.sampler.triggerRelease?.(midiToNote(v.note), time + ramp); v.note = null; }
        return;
      }
      const fresh = v.note === null;
      if (!fresh && v.note === note && time - v.at < spec.stroke - 0.02) return;
      if (!fresh && v.note !== note) v.sampler.triggerRelease?.(midiToNote(v.note), time);   // a new chord: cross-fade
      if ('attack' in v.sampler) v.sampler.attack = fresh ? spec.enter : spec.fade;
      v.sampler.triggerAttackRelease(midiToNote(note), spec.stroke, time, 0.85);
      v.note = note;
      v.at = time;
    });
  }

  /**
   * Lightning's moving layers for one step: where the scan line is (layers.from at `time`,
   * layers.to after `ramp`, -1 = western edge … +1 = eastern edge) and the storm wind (0..1).
   */
  setLayers(layers, time, ramp) {
    if (!this.sweepPan) return;
    const jump = this._panFresh || Math.abs(layers.from - (this._panTo ?? layers.from)) > 0.05;
    this.setPan(layers.to, time + ramp, jump ? { from: layers.from, at: time } : null);
    this._panTo = layers.to;
    this._panFresh = false;
    if (layers.wind !== undefined) this.setWind(layers.wind, time);
    if (layers.strings) this.setStrings(layers.strings, time, ramp);
  }

  /**
   * Move the sweep panner to `pos` (-1 west … +1 east), arriving at time `end`. With `start`, jump
   * there first in 50 ms (a new part begins in the west; a pause or a jump starts anywhere).
   */
  setPan(pos, end, start = null) {
    if (!this.sweepPan) return;
    const p = this.sweepPan.pan, w = this.settings.width;
    if (start) p.linearRampToValueAtTime(clamp(start.from, -1, 1) * w, start.at + 0.05);
    p.linearRampToValueAtTime(clamp(pos, -1, 1) * w, Math.max(end, start ? start.at + 0.06 : end));
    this._panFresh = true;   // an example or a probe moved it: the next sweep starts where its line is
  }

  /** Glide the storm wind towards `level` (0..1): it swells in about half a second, dies away in one. */
  setWind(level, time) {
    const o = this.orch;
    if (!o?.windGain) return;
    const up = level > (this._wind ?? 0);
    o.windGain.gain.setTargetAtTime(level * WIND.gain, time, up ? WIND.rise : WIND.fall);
    o.windBands[0].frequency.setTargetAtTime(WIND.low + (WIND.high - WIND.low) * level, time, 0.8);   // busier = brighter
    this._wind = level;
  }

  /** Glide the hum to a new loudness, brightness and position along the line. */
  setHum(level, pos, time, ramp, tension = 0) {
    if (this.orch) {
      // The bass keeps a floor over calm ocean, and opens up with the lightning above it.
      const floor = this.settings.bedFloor ?? 0;
      const over = level <= floor ? 0 : Math.pow((level - floor) / (1 - floor), 0.8);
      this.setBed(level, over, time, ramp);
      return;
    }
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
    if (this.orch) {
      const o = this.orch;
      for (const p of [o.bassGain.gain, o.bassFilter.frequency]) p.cancelScheduledValues(t);
      o.bassGain.gain.setValueAtTime(o.bassGain.gain.value, t);
      o.bassGain.gain.linearRampToValueAtTime(0, t + 0.25);
      if (o.bass) {
        o.bass.sampler.releaseAll(t);
        o.bass.strokeAt = -Infinity;      // bow again as soon as the sound returns
        o.bass.tag = null;
      }
      for (const v of o.stringBands ?? []) {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setValueAtTime(v.gain.gain.value, t);
        v.gain.gain.linearRampToValueAtTime(0, t + 0.25);
        v.sampler.releaseAll(t);
        v.note = null;
        v.at = -Infinity;
      }
      if (o.windGain) {
        const g = o.windGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(0, t + 0.3);
        o.windBands[0].frequency.cancelScheduledValues(t);
        this._wind = 0;
      }
    }
    if (this.sweepPan) {             // the next sound starts wherever its scan line is
      const p = this.sweepPan.pan;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      this._panFresh = true;
    }
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
