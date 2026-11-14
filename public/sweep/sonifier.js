// sweep/sonifier.js: team RUSTMN's sweep engine (player, audio, track mappings) behind one small
// interface, so app.js drives every track the same way.
//
// The score (api/scores/<id>.json) carries what the page shows and says. score.sweep names the
// fine data this engine plays (public/data/...), its chapter, its mapping and its instrument.

import { AudioEngine } from './audio.js';
import { Player } from './player.js';
import { renderBuffer } from './render.js';
import { clamp } from './music.js';
import * as nightLights from './tracks/night-lights.js';
import * as co2 from './tracks/co2.js';
import * as ocean from './tracks/ocean.js';

const T = window.EJ.Tone;
const MAPPINGS = { 'night-lights': nightLights, co2, ocean };
const SPEED_KEYS = ['yearSweep', 'changeSweep', 'orbitSeconds'];   // seconds the speed setting scales

// The mix chosen by ear on Night Lights (13 Nov 2026), from team RUSTMN's settings.js.
const SOUND = {
  master: 0, notes: 0, hum: 0, cello: 0, beat: 0,
  notesReverb: 0.51, humReverb: 0.27, ring: 2.0, width: 0.85, instrument: 'vibraphone',
};

// Volume 0..100 to dB, squared so the slider feels even to the ear.
const dbFor = (volume) => (volume <= 0 ? -Infinity : 40 * Math.log10(clamp(volume / 100, 0, 1)));
const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

const loaded = new Map();
function loadSweep(src, mapping) {
  if (!loaded.has(src)) {
    loaded.set(src, fetch(src)
      .then((r) => { if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`); return r.json(); })
      .then((d) => mapping.prepare(d))
      .catch((e) => { loaded.delete(src); throw e; }));
  }
  return loaded.get(src);
}

/** What the sounds mean, read from the score's legend (written by backend/build_sweep.py). */
export function keyText(score) {
  const L = score.legend;
  const items = L.items.map((i) => `${i.sound}: ${i.meaning.replace(/\.?$/, '.')}`).join(' ');
  return `${L.summary.trim()} ${L.method.trim()} ${items} ${L.caveat.trim()}`.replace(/\s+/g, ' ');
}

export async function createSweep(score, opts) {
  const mapping = MAPPINGS[score.sweep.mapping] ?? nightLights;
  return new SweepSonifier(score, await loadSweep(score.sweep.src, mapping), mapping, opts);
}

// Example sounds, per kind of track: [id, button label, what it plays, what it means].
const DEMOS = {
  light: [
    ['city', 'A bright place', 'One ringing note', 'A bright place. When the scan line crosses it, one note rings. Brighter rings louder.'],
    ['north', 'North and south', 'High left, then low right', 'North and south. Places in the north ring higher notes, in your left ear. Places in the south ring lower notes, in your right ear.'],
    ['hum', 'Deep hum', 'Swells, then fades', 'The deep hum. It grows with everything under the scan line, and fades to silence over empty ocean.'],
  ],
  change: [
    ['gain', 'New light', 'A rising pair of notes', 'New light. A rising pair of notes means light that is new or brighter since 2012.'],
    ['loss', 'Light dimmed', 'A low falling cello', 'Light dimmed. A low falling cello means light that dimmed or went out since 2012.'],
    ['north', 'North and south', 'High left, then low right', 'North and south. Changes in the north ring higher, in your left ear; in the south, lower, in your right ear.'],
  ],
  co2: [
    ['hum', 'Deep hum', 'Quiet, then full', 'The deep hum is all the carbon dioxide on the scan line. It is never silent: it gets louder and brighter as carbon dioxide builds.'],
    ['tense', 'Dense plume', 'The hum turns sour', 'A dense plume. Over the thickest carbon dioxide, clashing notes creep into the hum.'],
    ['city', 'Ringing note', 'One note', 'A ringing note marks the thickest part of a plume as it crosses the line. North is higher and in your left ear.'],
    ['beat', 'Heartbeat', 'A soft double beat', 'The heartbeat. One soft double beat for each day of data, at midnight.'],
  ],
};
DEMOS.air = [
  ['city', 'Thick pollution', 'One ringing note', 'Thick pollution. Where a pollutant is thick, a note rings as the scan line crosses it. Thicker rings louder.'],
  ['tense', 'The worst air', 'The drone turns sour', 'The worst air. Where pollution is thickest, clashing notes creep into the drone and it turns harsh.'],
  DEMOS.light[1],
];
DEMOS.ocean = [
  ['city', 'A current', 'One harp note', 'A current or eddy. When bright, fast water crosses the line, a harp note rings. Brighter water rings louder.'],
  ['swell', 'The swell', 'Grows, then settles', 'The swell. It follows all the moving water on the line: soft over calm sea, full over strong currents.'],
  ['beat', 'A new month', 'A soft low pulse', 'A new month. One soft low pulse at the start of each month of the tour.'],
  ['top', 'Top and bottom', 'High left, then low right', 'Top and bottom of the picture. Water near the top rings higher, in your left ear; near the bottom, lower, in your right ear.'],
];
DEMOS.lightning = [
  ['city', 'Storms', 'One drop-like note', 'Storms. Each place with a lot of lightning plays one drop-like note as the line crosses it. More lightning rings louder.'],
  DEMOS.light[1],
  DEMOS.light[2],
];

class SweepSonifier {
  constructor(score, data, mapping, {
    bpm = 84, volume = 100, mono = false, startIndex = 0, muted = [],
    onFrame = () => {}, onStep = () => {}, onEnd = () => {}, onNote = () => {}, onBeat = () => {},
  } = {}) {
    Object.assign(this, { score, mapping, onFrame, onStep, onEnd, onNote, onBeat, bpm, volume });
    this.kind = score.sweep.mapping === 'co2' ? 'co2' : score.sweep.mapping === 'ocean' ? 'ocean'
      : score.sweep.chapter === 'change' ? 'change' : score.sweep.chapter === 'pollutants' ? 'air'
        : score.sweep.instrument === 'kalimba' ? 'lightning' : 'light';
    this.chapter = data.chapters.find((c) => c.id === score.sweep.chapter);
    this.track = { ...data, chapters: [this.chapter] };
    const d = mapping.defaults(data);
    this.base = Object.fromEntries(SPEED_KEYS.filter((k) => k in d).map((k) => [k, d[k]]));
    this.settings = { ...SOUND, ...d, instrument: score.sweep.instrument || SOUND.instrument, width: mono ? 0 : SOUND.width };
    this.applyTempo();
    mapping.configure(this.settings);
    this.audio = new AudioEngine({ humNotes: mapping.HUM_NOTES, settings: this.settings });
    this.audio.muted = new Set(muted);
    this.audio.setVolume(dbFor(volume));
    this.player = new Player({
      track: this.track, mapping, audio: this.audio, settings: this.settings,
      onVoice: (ev) => this.voice(ev),
      onBeat: (v) => this.onBeat(v),
      onStep: (seg, step, plan) => this.stepped(seg, step, plan),
      onEnd: () => this.onEnd(),
    });
    this.lastSeg = null;
    this.lastLevel = 0;
    this.seek(startIndex);
  }

  frameIndexOf(seg) { return this.chapter.frames.indexOf(seg.frame); }

  /** Longitude under the scan line at `step` (whole or fractional) of segment `seg`. */
  lonAt(seg, step) {
    const t = this.track;
    if (t.grid) return t.grid.lonWest + (step + 0.5) * t.grid.cellDeg;
    return wrapLon(t.lonAtStep0 + t.lonPerStep * (seg.frame.startStep + step));
  }

  stepped(seg, step, plan) {
    const i = this.frameIndexOf(seg);
    if (seg !== this.lastSeg) { this.lastSeg = seg; this.onFrame(this.score.frames[i], i); }
    this.lastLevel = plan.hum.level;
    this.onStep(i, { lon: this.lonAt(seg, step), light: plan.hum.level, notes: plan.events.length });
  }

  voice(ev) {
    const t = this.track, seg = this.player.segmentAt(this.player.currentPosition);
    const lat = ev.row !== undefined && t.grid
      ? t.grid.latNorth - (ev.row + 0.5) * t.grid.cellDeg
      : (Math.asin(clamp(-ev.pos, -1, 1)) * 180) / Math.PI;
    const lon = ev.col !== undefined && t.grid ? t.grid.lonWest + (ev.col + 0.5) * t.grid.cellDeg : this.lonAt(seg, 0);
    this.lastNote = { kind: ev.kind, midi: ev.midi, lat, lon, pos: ev.pos, velocity: ev.velocity, at: performance.now() };
    this.onNote(this.lastNote);
  }

  get index() { return this.frameIndexOf(this.player.segmentAt(this.player.currentPosition)); }
  get playing() { return this.player.playing; }
  frame() { return this.score.frames[this.index]; }

  /** Where the scan line is: 0..1 through the current map. */
  progress() {
    const p = this.player, seg = p.segmentAt(p.currentPosition);
    return clamp((p.currentPosition - seg.start) / seg.dur, 0, 1);
  }

  /** Longitude of the scan line while playing (or always), else null. On the audio clock. */
  headLon(always = false) {
    if (!this.player.playing && !always) return null;
    const seg = this.player.segmentAt(this.player.currentPosition);
    return this.track.grid ? this.track.grid.lonWest + this.progress() * 360 : this.lonAt(seg, this.progress() * seg.steps);
  }

  /** For the ocean tour: where the camera is and the date on screen, in words; else null. */
  placeNow() {
    if (this.kind !== 'ocean') return null;
    const seg = this.player.segmentAt(this.player.currentPosition);
    const s = Math.floor(seg.frame.startStep + this.progress() * (seg.steps - 1));
    return { place: seg.frame.place, date: ocean.dateAt(this.track, s) };
  }

  /** For tracks played from a NASA video: the video time that matches the sound, in seconds. */
  mediaTime() {
    const t = this.track;
    if (!t.media || t.grid) return null;
    const seg = this.player.segmentAt(this.player.currentPosition);
    return ((seg.frame.startStep + this.progress() * seg.steps) * t.framesPerStep) / t.media.fps;
  }
  /** Video seconds per second of sound, at the current speed. */
  mediaRate() { return this.track.media ? this.track.media.duration / this.settings.orbitSeconds : 1; }

  /** Start audio inside the click or key press, then load the samples once. */
  ensureAudio() {
    const started = T.start();
    if (!this.ready) this.ready = started.then(() => this.audio.init()).catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  async play() {
    try { await this.ensureAudio(); } catch (e) { console.error(e); return false; }
    if (this.disposed) return false;
    this.lastSeg = null;
    await this.player.play();
    return true;
  }

  pause() { this.player.pause(); }

  seek(i) {
    this.lastSeg = null;
    this.player.seekSegment(clamp(Math.round(i), 0, this.chapter.frames.length - 1));
  }

  waveform() { return this.audio.wave ? this.audio.wave.getValue() : null; }

  applyTempo() {
    for (const [k, v] of Object.entries(this.base)) this.settings[k] = (v * 84) / this.bpm;
  }
  setTempo(bpm) { this.bpm = bpm; this.applyTempo(); this.player.retime(); }
  setVolume(volume) { this.volume = volume; this.audio.setVolume(dbFor(volume)); }
  setMono(mono) { this.settings.width = mono ? 0 : SOUND.width; if (this.audio.ready) this.audio.apply(); }

  // ---- one spot, and the example sounds ----

  noteForLat(lat) {
    const r = clamp(Math.floor((90 - lat) / 3), 0, 59);
    return nightLights.BAND_NOTES[nightLights.bandOfRow(r)];
  }
  posForLat(lat) { return clamp(((90 - lat) / 180) * 2 - 1, -1, 1); }

  /** Play one 10-degree cell of frame i, the way the sweep would, and say what it holds. */
  async probe(c, r, i = this.index) {
    const v = this.score.frames[i]?.grid?.[r]?.[c];
    if (v === undefined) return null;
    try { await this.ensureAudio(); } catch { return null; }
    const w = this.score.words;
    if (v === null) return w.missing;
    const lat = 90 - (r + 0.5) * 10, t = T.now() + 0.05, a = this.audio;
    const midi = this.noteForLat(lat), pos = this.posForLat(lat);
    const pct = Math.round(Math.abs(v) * 100);
    if (this.kind === 'change') {
      if (v >= 0.05) {
        a.play({ voice: 'notes', midi, velocity: 0.3 + 0.5 * v, duration: 1.5 }, t, pos);
        a.play({ voice: 'notes', midi: midi + 2, velocity: 0.25 + 0.4 * v, duration: 1.5 }, t + 0.11, pos);
        return `light grew, ${pct} percent of the strongest change on this map.`;
      }
      if (v <= -0.05) {
        a.play({ voice: 'cello', midi: midi - 12, velocity: 0.3 + 0.5 * -v, duration: 1.4 }, t, pos);
        a.play({ voice: 'cello', midi: midi - 14, velocity: 0.2 + 0.3 * -v, duration: 1.6 }, t + 0.3, pos);
        return `light dimmed, ${pct} percent of the strongest change on this map.`;
      }
      a.play({ voice: 'notes', midi, velocity: 0.15, duration: 0.8 }, t, pos);
      return 'about the same as in 2012.';
    }
    a.play({ voice: 'notes', midi, velocity: v < 0.05 ? 0.1 : 0.22 + 0.62 * Math.pow(v, 0.8), duration: 2 }, t, pos);
    a.setHum(Math.max(0.1, Math.sqrt(v)), pos, t, 0.3);
    a.setHum(0, pos, t + 1.2, 0.8);
    const how = v >= 0.5 ? 'high' : v >= 0.05 ? 'some' : 'almost none';
    return `${how}: ${pct} percent of the ${w.top} ${w.what} in this track.`;
  }

  /** The example sounds for this track: [{id, label, hint, text}]. */
  demos() { return DEMOS[this.kind].map(([id, label, hint, text]) => ({ id, label, hint, text })); }

  /** Play one example. Returns how long it takes, in seconds. */
  async demo(id) {
    try { await this.ensureAudio(); } catch { return 0; }
    const a = this.audio, t = T.now() + 0.05, N = nightLights.BAND_NOTES, mid = N[10];
    const note = (midi, at, pos, vel = 0.6, voice = 'notes', dur = 2) => a.play({ voice, midi, velocity: vel, duration: dur }, t + at, pos);
    switch (id) {
      case 'city': note(mid, 0, 0, 0.7); return 2.2;
      case 'north': note(N[18], 0, -1, 0.6); note(N[2], 1.2, 1, 0.6); return 3.2;
      case 'hum':
        a.setHum(0.15, 0, t, 0.2); a.setHum(0.9, 0, t + 0.2, 1.6); a.setHum(this.kind === 'co2' ? 0.1 : 0, 0, t + 2.2, 1.4);
        a.setHum(0, 0, t + 3.8, 0.3); return 4;
      case 'tense':
        a.setHum(0.6, 0, t, 0.3); a.setHum(0.8, 0, t + 0.4, 1.2, 1); a.setHum(0, 0, t + 2.6, 0.6, 0); return 3.4;
      case 'beat': a.beat(t, 0.9); if (this.kind !== 'ocean') a.beat(t + 1.2, 0.9); return 2;
      case 'swell':
        a.setHum(0.1, 0, t, 0.2); a.setHum(0.85, 0, t + 0.2, 1.8); a.setHum(0.1, 0, t + 2.4, 1.6);
        a.setHum(0, 0, t + 4.2, 0.4); return 4.4;
      case 'top': note(N[17], 0, -1, 0.6); note(N[3], 1.2, 1, 0.6); return 3.4;
      case 'gain': note(mid, 0, 0, 0.6); note(N[11], 0.11, 0, 0.45); return 2.2;
      case 'loss': note(mid - 12, 0, 0, 0.6, 'cello', 1.4); note(N[9] - 12, 0.3, 0, 0.4, 'cello', 1.6); return 2.6;
      default: return 0;
    }
  }

  /** A short, quiet click that confirms a key press: 'ok' (an action), 'edge' (nothing there). */
  async earcon(kind = 'ok') {
    try { await this.ensureAudio(); } catch { return; }
    if (!this.click) this.click = new T.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.06, sustain: 0, release: 0.03 }, volume: -22 }).toDestination();
    this.click.triggerAttackRelease(kind === 'edge' ? 'A3' : 'E6', 0.05, T.now() + 0.01);
  }

  /** Stop any example or one-spot sound at once. */
  hush() { if (this.audio.ready) this.audio.silence(); }

  // ---- Save as WAV ----

  passSeconds() { return this.player.duration; }
  async renderOffline(seconds) {
    return renderBuffer({ track: this.track, mapping: this.mapping, settings: { ...this.settings }, from: 0, seconds });
  }

  dispose() {
    this.disposed = true;
    this.player.pause();
    this.audio.dispose();
    this.click?.dispose();
  }
}
