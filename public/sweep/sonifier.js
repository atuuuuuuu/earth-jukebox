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
import * as lightning from './tracks/lightning.js';
import * as aerosols from './tracks/aerosols.js';
import * as seaHeat from './tracks/sea-heat.js';

const T = window.EJ.Tone;
const MAPPINGS = { 'night-lights': nightLights, co2, ocean, lightning, aerosols, 'sea-heat': seaHeat };
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
// Lightning's examples follow its legend, in the same order, then the stereo sweep.
DEMOS.lightning = [
  ['marks', 'Lightning marks', 'Lone notes, then a flurry', 'Lightning marks. Each mark in NASA\'s movie plays one quiet, short harp note as the scan line crosses it. A lone mark is a single note; where many marks crowd together they make a soft, quick flurry. Higher notes are farther north.'],
  ['wind', 'Storm wind', 'Swells, then dies away', 'The storm wind. It follows how many lightning marks are close to the scan line: it swells over busy storms and dies away over calm places.'],
  ['bass', 'Deep bass', 'Soft, then full, then soft', 'The deep bass. It is how much of the map under the scan line is lit by lightning. It never stops: it stays soft over calm ocean and swells over storms. It always stays in the middle.'],
  ['strings', 'Strings', 'Climbing from low to high', 'Strings. They say where the storms are, moment by moment: every stretch of latitude has its own string note, higher farther north, and it swells while lightning there is under the scan line. In this example a storm moves from the far south to the far north, and the strings climb with it.'],
  ['sweep', 'West to east', 'Left ear, then right ear', 'West to east. The sound moves with the scan line: it starts in your left ear at the western edge of the map, passes the centre, and ends in your right ear at the eastern edge. With Mono on, it all stays in the centre.'],
  ['rising', 'More than before', 'Short rising notes', 'More than before, heard with Compare with previous part. A short rising figure means more lightning here than in the previous part. A bigger increase is louder and climbs further.'],
  ['falling', 'Less than before', 'Short falling notes', 'Less than before, heard with Compare with previous part. A short falling figure means less lightning here than in the previous part. Places that stayed the same are quiet.'],
];
// Aerosols: the hint on each wind's example button, by the colour of its wind (winds.js).
const WIND_HINTS = {
  smoke: 'Low, dark and rough, with soft crackles',
  sand: 'Grainy, in the middle',
  ocean: 'Low, smooth and airy',
  breath: 'Thin, high and soft',
};
const shortWhen = (when) => when.replace(/ of \d+$/, '');   // "Part 5 of 14" -> "Part 5"
// "About 58,000": two significant figures from 100 up, as the backend says it in the score's text.
const about = (n) => {
  if (n < 100) return String(n);
  const p = 10 ** (String(Math.round(n)).length - 2);
  return (Math.round(n / p) * p).toLocaleString('en-US');
};

class SweepSonifier {
  constructor(score, data, mapping, {
    bpm = 84, volume = 100, mono = false, startIndex = 0, muted = [],
    onFrame = () => {}, onStep = () => {}, onEnd = () => {}, onNote = () => {}, onBeat = () => {},
  } = {}) {
    Object.assign(this, { score, mapping, onFrame, onStep, onEnd, onNote, onBeat, bpm, volume });
    this.kind = mapping === co2 ? 'co2' : mapping === ocean ? 'ocean' : mapping === lightning ? 'lightning'
      : mapping === aerosols ? 'aerosols' : mapping === seaHeat ? 'sea' : score.sweep.chapter === 'change' ? 'change'
        : score.sweep.chapter === 'pollutants' ? 'air' : 'light';
    this.bedWord = this.kind === 'lightning' ? 'bass' : this.kind === 'sea' ? 'chord' : 'hum';   // what "Where am I" calls the low layer
    // Which way the scan line moves (score.sweep.scan): "east" (a north-south line, the default) or
    // "south" (a west-east line moving down the map: west is then the left ear).
    this.scan = score.sweep.scan ?? 'east';
    this.data = data;
    this.whole = { ...data, chapters: [data.chapters.find((c) => c.id === score.sweep.chapter)] };
    this.view = null;              // the view heard now (score.views option), or null for the whole map
    this.settings = { ...SOUND, ...mapping.defaults(data), instrument: score.sweep.instrument || SOUND.instrument, width: mono ? 0 : SOUND.width };
    this.useTrack(this.whole, data);
    this.audio = new AudioEngine({ humNotes: mapping.HUM_NOTES, settings: this.settings });
    this.audio.muted = new Set(muted);
    this.audio.setVolume(dbFor(volume));
    this.player = this.makePlayer();
    this.lastSeg = null;
    this.lastLevel = 0;
    this.seek(startIndex);
  }

  /** Play `track` from now on: its chapter, and the sweep speeds it asks for (scaled by the speed setting). */
  useTrack(track, defaultsFrom = track) {
    this.track = track;
    this.chapter = track.chapters[0];
    const d = this.mapping.defaults(defaultsFrom);
    this.base = Object.fromEntries(SPEED_KEYS.filter((k) => k in d).map((k) => [k, d[k]]));
    this.applyTempo();
    this.mapping.configure(this.settings);
  }

  makePlayer() {
    return new Player({
      track: this.track, mapping: this.mapping, audio: this.audio, settings: this.settings,
      onVoice: (ev) => this.voice(ev),
      onBeat: (v) => this.onBeat(v),
      onStep: (seg, step, plan) => this.stepped(seg, step, plan),
      onEnd: () => this.onEnd(),
    });
  }

  frameIndexOf(seg) { return this.chapter.frames.indexOf(seg.frame); }

  // ---- views: other ways to hear the track (score.views; backend/API.md) ----
  // NASA's zoom regions (night lights) or NASA's stories (aerosols). A view replaces the list of maps:
  // each of its maps is a window of the picture with its own finer grid (in the sweep data).

  /** The view options of this track ({id, name, unit, frames}), or an empty list. */
  get viewOptions() { return this.score.views?.options ?? []; }
  /** The maps heard now: the track's own, or the view's (each with the picture of the map it is read from). */
  get frames() {
    if (!this.view) return this.score.frames;
    this._frames ??= this.view.frames.map((f) => ({ ...this.score.frames[f.base], ...f }));
    return this._frames;
  }
  /** What one map is called now: "map", or "story" in NASA's stories. */
  get unit() { return this.view?.unit ?? 'map'; }

  /** Hear a view (its id), or the whole map (null). Starts again at its first map, paused. */
  setView(id) {
    const opt = this.viewOptions.find((o) => o.id === id) ?? null;
    if (opt === this.view) return;
    this.player.pause();
    this.view = opt;
    this._frames = null;
    if (opt) this.useTrack(this.viewTrack(opt));
    else this.useTrack(this.whole, this.data);
    this.player = this.makePlayer();
    this.seek(0);
  }

  /** The sweep data of a view, built once: each map is its window's fine grid (`geo`), prepared to play. */
  viewTrack(opt) {
    this._viewTracks ??= new Map();
    if (!this._viewTracks.has(opt.id)) {
      const items = new Map((this.data.views?.items ?? []).map((it) => [it.id, it]));
      const ch = this.whole.chapters[0];
      const frames = opt.frames.map((f) => {
        const it = items.get(f.view);
        const fine = (it.chapters[ch.id] ?? Object.values(it.chapters)[0])[f.frame];
        const own = ch.frames[f.base] ?? ch.frames[0];
        return {
          label: own.label, image: own.image, ...fine, geo: { ...it.grid, zoom: true }, box: it.box,
          focus: f.focus ?? null, secondsPerSweep: it.secondsPerSweep,
        };
      });
      const chapter = { id: ch.id, title: ch.title, secondsPerSweep: frames[0].secondsPerSweep, frames };
      this._viewTracks.set(opt.id, this.mapping.prepare({ ...this.data, chapters: [chapter] }));
    }
    return this._viewTracks.get(opt.id);
  }

  /** The window of map i ([west, south, east, north]) while a view is heard, else null. */
  boxOf(i = this.index) { return this.view ? this.frames[i]?.box ?? null : null; }

  /** Longitude under the scan line at `step` (whole or fractional) of segment `seg`. */
  lonAt(seg, step) {
    const t = this.track, g = seg.frame.geo ?? t.grid;
    if (g) return g.lonWest + (step + 0.5) * g.cellDeg;
    return wrapLon(t.lonAtStep0 + t.lonPerStep * (seg.frame.startStep + step));
  }

  stepped(seg, step, plan) {
    const i = this.frameIndexOf(seg);
    if (seg !== this.lastSeg) { this.lastSeg = seg; this.onFrame(this.frames[i], i); }
    this.lastLevel = plan.hum.level;
    // `under` is the column itself where the sound is a smoothed level (lightning's bed);
    // `change` is the net change under the line in lightning's compare mode.
    // `winds`: each layer's wind right now (aerosols), for "Where am I?".
    // `sea`: the line's latitude and the water under it (sea heat), for "Where am I?".
    this.onStep(i, {
      lon: this.lonAt(seg, step), light: plan.hum.under ?? plan.hum.level, change: plan.hum.change,
      notes: plan.events.filter((e) => !e.bed).length, winds: plan.layers?.winds, sea: plan.sea,
    });
  }

  voice(ev) {
    // Bow strokes of the bed are not places, and a flurry is marked once: nothing more to show.
    if (ev.bed || ev.echo) return;
    const t = this.track, seg = this.player.segmentAt(this.player.currentPosition), g = seg.frame.geo ?? t.grid;
    const lat = ev.lat ?? (ev.row !== undefined && g
      ? g.latNorth - (ev.row + 0.5) * g.cellDeg
      : (Math.asin(clamp(-ev.pos, -1, 1)) * 180) / Math.PI);
    const lon = ev.lon ?? (ev.col !== undefined && g ? g.lonWest + (ev.col + 0.5) * g.cellDeg : this.lonAt(seg, 0));
    this.lastNote = { kind: ev.kind, midi: ev.midi, lat, lon, pos: ev.pos, velocity: ev.velocity, at: performance.now() };
    this.onNote(this.lastNote);
  }

  get index() { return this.frameIndexOf(this.player.segmentAt(this.player.currentPosition)); }
  get playing() { return this.player.playing; }
  frame() { return this.frames[this.index]; }

  /** Where the scan line is: 0..1 through the current map. */
  progress() {
    const p = this.player, seg = p.segmentAt(p.currentPosition);
    return clamp((p.currentPosition - seg.start) / seg.dur, 0, 1);
  }

  /** Longitude of the scan line while playing (or always), else null. On the audio clock. */
  headLon(always = false) {
    if (!this.player.playing && !always) return null;
    const seg = this.player.segmentAt(this.player.currentPosition), g = seg.frame.geo ?? this.track.grid;
    return g ? g.lonWest + this.progress() * g.cols * g.cellDeg : this.lonAt(seg, this.progress() * seg.steps);
  }

  /** For a line moving south (sea heat): its latitude while playing (or always), else null. */
  headLat(always = false) {
    if (this.scan !== 'south' || (!this.player.playing && !always)) return null;
    const g = this.track.grid, rows = this.track._rows;
    return g.latNorth - (rows[0] + this.progress() * rows.length) * g.cellDeg;
  }

  /** Sea heat: the line and the water under it where the line is now, playing or not. */
  seaNow() {
    if (this.kind !== 'sea') return null;
    const seg = this.player.segmentAt(this.player.currentPosition);
    const s = clamp(Math.floor(this.progress() * seg.steps), 0, seg.steps - 1);
    return this.mapping.planStep(this.track, seg, s).sea;
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

  // ---- layers heard alone (aerosols) ----

  /** The layers of this track ({id, name, key, ...}) from its score, or an empty list. */
  get layers() { return this.score.layers ?? []; }
  /** The layer heard alone (its id), or null when all are heard. */
  get solo() { return this.settings.solo ?? null; }

  /** Hear one layer alone (its id), or all of them (null). The sweep keeps going. */
  setSolo(id) {
    this.settings.solo = this.layers.some((L) => L.id === id) ? id : null;
    this.mapping.configure(this.settings);
    if (this.audio.ready) this.audio.apply();
  }

  /** Each layer's wind under the scan line where it is now, playing or not: [{id, level, open, lat}]. */
  windsNow() {
    if (!this.layers.length) return null;
    const seg = this.player.segmentAt(this.player.currentPosition);
    const c = clamp(Math.floor(this.progress() * seg.steps), 0, seg.steps - 1);
    return this.mapping.planStep(this.track, seg, c).layers?.winds ?? null;
  }

  // ---- compare with the previous part (lightning) ----

  /** Whether this track has a compare pass. */
  get canCompare() { return !!this.mapping.COMPARE && this.chapter.frames.length > 1; }
  get comparing() { return !!this.settings.compare; }

  /** Switch between the map itself and its change from the previous map. Keeps the scan where it is. */
  setCompare(on) {
    this.settings.compare = !!on && this.canCompare;
    this.mapping.configure(this.settings);
    if (this.audio.ready) this.audio.apply();
    this.player.retime();
  }

  /** The map's spoken name in compare mode ("Part 6 of 14 compared with Part 5"), else null. */
  mapName(i) {
    if (!this.comparing) return null;
    const F = this.score.frames;
    return i <= 0
      ? `${F[0].when}: the first part, with no previous part to compare it with`
      : `${F[i].when} compared with ${shortWhen(F[i - 1].when)}`;
  }

  /** What D says: the map's own text, or in compare mode what changed since the map before. */
  describeText(i = this.index) { return this.comparing ? this.compareText(i) : this.frames[i].text; }

  /** What changed from map i - 1 to map i, from the score's 10-degree grids (one fixed scale). */
  compareText(i) {
    const F = this.score.frames;
    if (i <= 0) {
      return `${F[0].when} is the first part, so there is no previous part to compare it with. `
        + `Press Right arrow for ${this.mapName(1)}, or press C to hear ${shortWhen(F[0].when)} itself.`;
    }
    const a = F[i - 1].grid, b = F[i].grid;
    let all = 0, more = 0, less = 0;
    const cells = [];
    for (let r = 0; r < b.length; r++) {
      const w = Math.cos(((90 - (r + 0.5) * 10) * Math.PI) / 180);
      for (let c = 0; c < b[r].length; c++) {
        if (a[r][c] === null || b[r][c] === null) continue;
        const d = b[r][c] - a[r][c];
        all += w;
        if (d >= 0.05) more += w;
        if (d <= -0.05) less += w;
        cells.push([r, c, d]);
      }
    }
    const pct = (x) => Math.round((1000 * x) / (all || 1)) / 10;
    const ups = cells.filter((x) => x[2] >= 0.05).sort((x, y) => y[2] - x[2]).slice(0, 3);
    const downs = cells.filter((x) => x[2] <= -0.05).sort((x, y) => x[2] - y[2]).slice(0, 3);
    return `${this.mapName(i)}. Lightning grew in ${pct(more)} percent of the area the sensor sees and fell in ${pct(less)} percent. `
      + (ups.length ? `Biggest increases: ${this.listing(ups)}. ` : 'No square grew. ')
      + (downs.length ? `Biggest decreases: ${this.listing(downs)}.` : 'No square fell.');
  }

  /** "around Kinshasa, around Lagos and around 5 degrees south, 25 degrees east", as the backend says it. */
  listing(cells) {
    const deg = (lat, lon) => {
      const a = Math.round(lat) ? `${Math.abs(Math.round(lat))} degrees ${lat > 0 ? 'north' : 'south'}` : 'the equator';
      const b = `${Math.abs(Math.round(lon))} degrees ${lon > 0 ? 'east' : lon < 0 ? 'west' : ''}`.trim();
      return `${a}, ${b}`;
    };
    const names = cells.map(([r, c]) => `around ${this.score.places?.[`${r},${c}`] ?? deg(90 - (r + 0.5) * 10, -180 + (c + 0.5) * 10)}`);
    if (names.length === 1) return names[0];
    const sep = names.some((n) => n.includes('degrees')) ? ['; ', '; and '] : [', ', ' and '];
    return names.slice(0, -1).join(sep[0]) + sep[1] + names[names.length - 1];
  }

  /** Lightning marks that first appear in 10-degree square (r, c) during map i. */
  marksInSquare(r, c, i) {
    const mg = this.track.markGrid, m = this.chapter.frames[i]?.marks;
    if (!mg || !m) return 0;
    let n = 0;
    for (let j = 0; j < mg.rows; j++) {
      const lat = mg.latNorth - (j + 0.5) * mg.latDeg;
      if (lat >= 90 - r * 10 || lat < 80 - r * 10) continue;
      for (let k = Math.round((c * 10) / mg.lonDeg); k < Math.round(((c + 1) * 10) / mg.lonDeg); k++) n += m[j * mg.cols + k] || 0;
    }
    return n;
  }

  /** The 95th percentile of marks per 10-degree square over the whole track: a full storm wind. */
  squareNorm() {
    if (this._squareNorm === undefined) {
      const counts = [];
      this.chapter.frames.forEach((_, i) => {
        for (let r = 0; r < 18; r++) for (let c = 0; c < 36; c++) { const n = this.marksInSquare(r, c, i); if (n) counts.push(n); }
      });
      counts.sort((a, b) => a - b);
      this._squareNorm = Math.max(1, counts[Math.floor(counts.length * 0.95)] ?? 1);
    }
    return this._squareNorm;
  }

  // ---- one spot, and the example sounds ----

  noteForLat(lat) {
    if (this.mapping.noteForLat) return this.mapping.noteForLat(lat);
    const r = clamp(Math.floor((90 - lat) / 3), 0, 59);
    return nightLights.BAND_NOTES[nightLights.bandOfRow(r)];
  }
  posForLat(lat) { return clamp(((90 - lat) / 180) * 2 - 1, -1, 1); }

  /** Play one 10-degree cell of frame i, the way the sweep would, and say what it holds. */
  async probe(c, r, i = this.index) {
    const v = this.frames[i]?.grid?.[r]?.[c];
    if (v === undefined) return null;
    try { await this.ensureAudio(); } catch { return null; }
    const w = this.score.words;
    if (v === null) return w.missing;
    const lat = 90 - (r + 0.5) * 10, t = T.now() + 0.05, a = this.audio;
    if (this.kind === 'sea') return this.probeSea(c, v, t);
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
    const how = v >= 0.5 ? 'high' : v >= 0.05 ? 'some' : 'almost none';
    if (this.kind === 'lightning') return this.probeLightning(c, r, i, v, { lat, midi, t, how, pct });
    if (this.kind === 'aerosols') return this.probeLayers(c, r, i, { lat, t });
    a.play({ voice: 'notes', midi, velocity: v < 0.05 ? 0.1 : 0.22 + 0.62 * Math.pow(v, 0.8), duration: 2 }, t, pos);
    a.setHum(Math.max(0.1, Math.sqrt(v)), pos, t, 0.3);
    a.setHum(0, pos, t + 1.2, 0.8);
    return `${how}: ${pct} percent of the ${w.top} ${w.what} in this track.`;
  }

  /**
   * One 10-degree square of lightning, heard the way the sweep plays it: placed left to right by
   * its longitude; in compare mode its change from the part before.
   */
  probeLightning(c, r, i, v, { lat, midi, t, how, pct }) {
    const a = this.audio, w = this.score.words, F = this.score.frames;
    const x = clamp((-180 + (c + 0.5) * 10) / 180, -1, 1);
    a.setPan(x, t + 0.06, { from: x, at: t });
    const mark = (m, at, vel) => a.play({ voice: 'notes', midi: m, velocity: vel, duration: 0.08 }, t + at, 0);
    if (this.comparing) {
      if (i === 0) return `${shortWhen(F[0].when)} is the first part, so there is no previous part to compare it with.`;
      const before = F[i - 1].grid?.[r]?.[c];
      if (before === null || before === undefined) return w.missing;
      const d = v - before, prev = shortWhen(F[i - 1].when), was = Math.round(before * 100);
      if (Math.abs(d) >= 0.05) {
        for (const nt of lightning.changeFigure(clamp(d / 0.5, -1, 1), lat)) a.play({ voice: 'notes', ...nt }, t + nt.offset, 0);
        return `${d > 0 ? 'more' : 'less'} lightning than in ${prev}: ${pct} percent of the ${w.top} ${w.what} in this track, ${d > 0 ? 'up' : 'down'} from ${was}.`;
      }
      mark(midi, 0, 0.18);
      return `about the same as in ${prev}: ${pct} percent of the ${w.top} ${w.what} in this track.`;
    }
    // The same layers as the sweep: bass for how much, the string note of this latitude, the wind
    // and the marks for how many marks appear here.
    for (const ev of lightning.bedEvents(v, 'Eb', 'spot', 0)) a.play(ev, t);
    const level = lightning.bedLevel(v);
    a.setHum(level, 0, t, 0.4);
    a.setHum(level, 0, t + 1.6, 0);    // hold, then fade
    a.setHum(0, 0, t + 1.6, 1.1);
    const strings = lightning.stringsForLat(lat, lightning.stringLevel(v));
    a.setStrings(strings, t, 0.4);
    a.setStrings(strings, t + 1.6, 0);
    a.setStrings(lightning.stringsForLat(lat, 0), t + 1.6, 1.1);
    const marks = this.marksInSquare(r, c, i);
    if (marks) {
      a.setWind(lightning.windLevel(marks / this.squareNorm()), t);
      a.setWind(0, t + 1.4);
      for (const nt of lightning.flurry(marks, [[0, marks]])) mark(midi, 0.3 + nt.offset, nt.velocity);
    }
    return `${how}: ${pct} percent of the ${w.top} ${w.what} in this track. `
      + (marks ? `About ${about(marks)} lightning ${marks === 1 ? 'mark appears' : 'marks appear'} here during this part.` : 'No lightning marks appear here during this part.');
  }

  /**
   * One 10-degree square of a map with layers (aerosols), heard the way the sweep plays it: the wind
   * of each layer heard (all, or the one alone) swells to that square's amount at its latitude, then
   * fades. Says how much of each is there, each against its own thickest places.
   */
  probeLayers(c, r, i, { lat, t }) {
    const w = this.audio.winds, F = this.frames[i];
    const vals = this.layers.map((L) => ({ L, v: F.layers?.[L.id]?.[r]?.[c] ?? 0 }));
    const heard = vals.filter((x) => !this.solo || x.L.id === this.solo);
    const winds = heard.map(({ L, v }) => ({ id: L.id, level: aerosols.windLevel(v), open: v, lat, thick: v }));
    w?.set(winds, t);
    w?.set(winds.map((x) => ({ ...x, level: 0 })), t + 1.6);
    // Thick smoke crackles here too, as in the sweep (the wind colour is in the data's layers).
    const smoke = heard.find((x) => this.track.layers?.find((y) => y.id === x.L.id)?.wind === 'smoke');
    if (smoke && smoke.v >= 0.6) w?.crackle({ layer: smoke.L.id, velocity: 0.3, pos: this.posForLat(lat), duration: 0.03 }, t + 0.7);
    const pct = (v) => `${Math.round(v * 100)} percent of its thickest`;
    const name = (L) => L.name.toLowerCase();
    if (this.solo) {
      const me = vals.find((x) => x.L.id === this.solo);
      const others = vals.filter((x) => x !== me && x.v >= 0.05).map((x) => name(x.L));
      return (me.v >= 0.05 ? `${name(me.L)}, ${pct(me.v)}.` : `almost no ${name(me.L)}.`)
        + (others.length ? ` Also here: ${others.join(', ')}.` : '');
    }
    const here = vals.filter((x) => x.v >= 0.05).sort((a, b) => b.v - a.v);
    return here.length ? `${here.map((x) => `${name(x.L)}, ${pct(x.v)}`).join('; ')}.` : `almost no ${this.score.words.what}.`;
  }

  /**
   * One 10-degree square of sea (sea heat): the chord of its temperature, placed west to east by its
   * longitude, for a moment; says the temperature and how many voices that is.
   */
  probeSea(c, v, t) {
    const ch = this.audio.chords;
    const x = clamp((-180 + (c + 0.5) * 10) / 180, -1, 1);
    const chord = seaHeat.chordFor(this.track, v, 1, () => x);
    ch?.set(chord, t);
    ch?.set({ levels: chord.levels.map(() => 0), pans: chord.pans }, t + 2.2);
    const voices = chord.levels.filter((l) => l > 0.05).length;
    const feel = v >= 28 ? 'among the warmest seas on Earth' : v >= 24 ? 'warm' : v >= 18 ? 'mild' : v >= 12 ? 'cool' : v >= 6 ? 'cold' : 'very cold';
    return `${Math.round(v * 10) / 10} degrees Celsius on NASA's key, ${feel}: ${voices === 1 ? 'the deep base note alone' : `${voices} chord voices`}.`;
  }

  /** Sea heat's examples: cold sea, warm sea, and west and east. */
  seaDemos() {
    const items = this.score.legend.items;
    const say = (start) => items.find((it) => it.sound.startsWith(start));
    return [
      { id: 'cold', label: 'Cold sea', hint: 'Deep base note only', text: `Cold sea, near the poles: the deep base note alone. ${say('Deep base')?.meaning ?? ''}`.trim() },
      { id: 'warm', label: 'Warm sea', hint: 'The full chord, voice by voice', text: `From cold to warm sea: the voices join one by one, from 0 to 30 degrees, until the full chord of the tropics. ${say('Chord voices')?.meaning ?? ''}`.trim() },
      { id: 'sides', label: 'West and east', hint: 'Left ear, then right ear', text: `West and east. On this track the scan line lies on its side, so warm water in the west sounds in your left ear and warm water in the east in your right ear. In this example warm water moves from the far west to the far east.` },
    ];
  }

  /** Play one sea heat example on the chords. Returns how long it takes, in seconds. */
  seaDemo(id, t) {
    const ch = this.audio.chords;
    if (!ch) return 0;
    const at = (temp, time, x = 0) => ch.set(seaHeat.chordFor(this.track, temp, 1, () => x), time);
    const off = (time) => ch.set({ levels: this.track._voices.map(() => 0), pans: null }, time);
    switch (id) {
      case 'cold': at(2, t); off(t + 3.2); return 4.5;
      case 'warm':
        for (let k = 0; k <= 30; k++) at(k, t + k * 0.25);
        off(t + 9.5); return 11;
      case 'sides':
        for (let k = 0; k <= 16; k++) at(29, t + k * 0.3, -1 + k / 8);
        off(t + 5.5); return 7;
      default: return 0;
    }
  }

  /** The example sounds for this track: [{id, label, hint, text}]. */
  demos() {
    if (this.kind === 'aerosols') return this.layerDemos();
    if (this.kind === 'sea') return this.seaDemos();
    return (DEMOS[this.kind] ?? []).map(([id, label, hint, text]) => ({ id, label, hint, text }));
  }

  /**
   * Aerosols: one example per layer, its wind alone, in the order of the legend, with the legend's
   * own words; then north and south. Built from the data, so no layer is named here.
   */
  layerDemos() {
    const items = this.score.legend.items, L = this.track.layers ?? [];
    const out = L.map((x) => {
      const item = items.find((it) => it.sound.startsWith(x.name));
      return { id: `wind:${x.id}`, label: x.name, hint: WIND_HINTS[x.wind] ?? 'Its wind alone', text: item ? `${item.sound}. ${item.meaning}` : `${x.name}.` };
    });
    const where = items.find((it) => !L.some((x) => it.sound.startsWith(x.name)));
    const mover = L.find((x) => x.wind === 'sand') ?? L[0];
    if (mover) {
      out.push({
        id: 'north', label: 'North and south', hint: 'Low and right, rising to high and left',
        text: `North and south. ${where ? where.meaning : ''} In this example the ${mover.name.toLowerCase()} wind moves from the far south to the far north.`.replace(/\s+/g, ' '),
      });
    }
    return out;
  }

  /** Play one aerosol example on the winds. Returns how long it takes, in seconds. */
  layerDemo(id, t) {
    const w = this.audio.winds, L = this.track.layers ?? [];
    if (!w) return 0;
    const at = (x, level, time, lat = 0, thick = level) => w.set([{ id: x.id, level, open: level, lat, thick }], time);
    if (id === 'north') {
      const x = L.find((y) => y.wind === 'sand') ?? L[0];
      w.hear(x.id, t, 7);
      for (let k = 0; k <= 20; k++) at(x, 0.8, t + k * 0.25, -50 + 5 * k);
      at(x, 0, t + 5.4, 50);
      return 7;
    }
    const x = L.find((y) => `wind:${y.id}` === id);
    if (!x) return 0;
    w.hear(x.id, t, 6.5);
    at(x, 0.25, t); at(x, 1, t + 1.2); at(x, 0.25, t + 3.4); at(x, 0, t + 4.6);
    if (x.wind === 'smoke') for (const [dt, vel] of [[1.9, 0.3], [2.6, 0.4], [3.1, 0.25]]) w.crackle({ layer: x.id, velocity: vel, pos: 0, duration: 0.03 }, t + dt);
    return 6;
  }

  /** Play one example. Returns how long it takes, in seconds. */
  async demo(id) {
    try { await this.ensureAudio(); } catch { return 0; }
    const a = this.audio, t = T.now() + 0.05, N = nightLights.BAND_NOTES, mid = N[10];
    if (this.kind === 'aerosols') return this.layerDemo(id, t);
    if (this.kind === 'sea') return this.seaDemo(id, t);
    const note = (midi, at, pos, vel = 0.6, voice = 'notes', dur = 2) => a.play({ voice, midi, velocity: vel, duration: dur }, t + at, pos);
    // Lightning: one bass bow stroke; one mark note; and the sweep panner set to `x` (-1 west … +1 east).
    const bow = (at, rel) => a.play(lightning.bedEvents(rel, 'Eb', `demo${at}`, 0)[0], t + at);
    const mark = (lat, at, vel) => a.play({ voice: 'notes', midi: lightning.noteForLat(lat), velocity: vel, duration: 0.08 }, t + at, 0);
    const place = (x) => a.setPan?.(x, t + 0.06, { from: x, at: t });
    const floor = lightning.BED_FLOOR;
    switch (id) {
      // Each glide runs from the end of the one before it, so a level is held by naming it twice.
      case 'bass':
        for (const at of [0, 1.25, 2.5]) bow(at, 0.6);
        a.setHum(floor, 0, t, 0.3); a.setHum(1, 0, t + 0.9, 1.5); a.setHum(floor, 0, t + 2.8, 1.4);
        a.setHum(0, 0, t + 4.6, 0.4); return 5;
      case 'strings': {
        // A storm moving from the far south to the far north: the strings climb with it, step by step.
        place(0);
        const n = lightning.STRING_BANDS, steps = 25;
        for (let k = 0; k <= steps; k++) {
          const centre = (n - 1) * (1 - k / steps);                       // band n - 1 = south … 0 = north
          const levels = Array.from({ length: n }, (_, b) => 0.9 * Math.exp(-((b - centre) ** 2) / 0.7));
          a.setStrings(lightning.stringsAt(levels, 'Eb', 'demo'), t + k * 0.2, 0.2);
        }
        a.setStrings(lightning.stringsAt(new Array(n).fill(0), 'Eb', 'demo'), t + steps * 0.2 + 0.2, 0.7);
        return 6;
      }
      case 'marks': {
        place(0);
        mark(40, 0, 0.32); mark(-20, 0.7, 0.32); mark(8, 1.3, 0.32);       // three lone marks: north, south, middle
        // then a crowd of marks in two bands, as a quick flurry
        for (const [lat, at] of [[2, 2.0], [14, 2.02]]) for (const nt of lightning.flurry(40, [[0, 20], [0.06, 20]])) mark(lat, at + nt.offset, nt.velocity);
        return 3.2;
      }
      case 'wind':
        place(0);
        a.setWind(1, t); a.setWind(0, t + 2.6); return 5.5;
      case 'sweep': {
        a.setPan(1, t + 3.6, { from: -1, at: t });
        for (let k = 0; k <= 8; k++) mark([10, 30, -5, 20, 0, -25, 15, 5, -10][k], k * 0.45, 0.32);
        return 4.2;
      }
      case 'rising': case 'falling': {
        place(0);
        const sign = id === 'rising' ? 1 : -1;
        for (const [dz, at] of [[0.3, 0], [0.9, 1.0]]) {
          for (const nt of lightning.changeFigure(sign * dz, 0)) a.play({ voice: 'notes', ...nt }, t + at + nt.offset, 0);
        }
        return 2.2;
      }
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
    // Keys pressed while the sounds first load all wake up together: give each click its own moment.
    const at = Math.max(T.now() + 0.01, (this.lastClick ?? 0) + 0.06);
    this.lastClick = at;
    this.click.triggerAttackRelease(kind === 'edge' ? 'A3' : 'E6', 0.05, at);
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
