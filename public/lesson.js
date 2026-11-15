// lesson.js: a guided lesson shown before a track's player (ocean currents: the Gulf Stream, one idea
// at a time: what a current is, then direction, then speed, then change). It reads the lesson the
// score names (score.lesson, made by backend/eic/pipeline/tracks/ocean_lesson.py from NASA's film).
//
// Each sound is explained before it plays, and nothing plays before a key press or click:
//  * direction: a short tone that travels the way the water goes. It rises for north and falls for
//    south, and moves from the left ear to the right for east;
//  * speed: soft ticks in the middle of your head, at one pitch. Faster ticks = faster water;
//  * an optional ocean background. It is off unless the listener turns it on, carries no
//    information, and dips under every lesson sound.
// Speech and sound never overlap: a spoken label comes first, then a pause, then the sound.

const T = window.EJ.Tone;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const end = (t) => (/[.?!]$/.test(t) ? t : `${t}.`);      // "What is an ocean current?" keeps its own mark
const dbOf = (v) => (v <= 0 ? -Infinity : 40 * Math.log10(clamp(v / 100, 0, 1)));   // as the main volume
const SAY_GAP = 1.4;        // seconds from a spoken label to its sound, at normal pace
const BASE = 392;           // G4: the direction tone's middle pitch
const DIRECTION_CUES = new Set(["current", "north", "east", "south", "west", "together"]);

// The example sounds, by cue id: what each one plays (durations at normal pace).
const CUE_SOUNDS = {
  wave: { kind: "bob", dur: 2.6 },
  current: { kind: "glide", dir: 90, dur: 2.6 },
  north: { kind: "glide", dir: 0, dur: 1.5 },
  east: { kind: "glide", dir: 90, dur: 1.5 },
  south: { kind: "glide", dir: 180, dur: 1.5 },
  west: { kind: "glide", dir: 270, dur: 1.5 },
  slow: { kind: "ticks", speed: 0.1, dur: 2.2 },
  medium: { kind: "ticks", speed: 0.5, dur: 2.2 },
  fast: { kind: "ticks", speed: 1, dur: 2.2 },
  together: { kind: "both", dir: 0, speed: 1, dur: 1.8 },
};

const KEYS = "Lesson keys. Right arrow: next step. Left arrow: back. Space: play or pause this step's sound. "
  + "R: replay from the start. W: where am I. D: read this step again. Home and End: first or last step. "
  + "T: go to the full tour. Escape: stop. Tab reaches the buttons, the example sounds and the lesson's sound settings.";

export async function createLesson(src, opts) {
  const r = await fetch(src);
  if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
  return new Lesson(await r.json(), opts);
}

class Lesson {
  constructor(data, { $, say, run, store, onSound }) {
    Object.assign(this, { data, $, say, run, store, onSound });
    this.i = 0;
    this.seq = null;          // the step's sound: { parts, k, playing, ended }
    this.timers = [];
    this.voices = [];         // sounds playing now, so Pause can cut them at once
    this.A = null;            // the audio graph, built on the first sound
    this.ac = new AbortController();
    this.title = data.title;
    this.count = data.steps.length;
    this.wire();
    this.render();
  }

  // ---------- Controls ----------
  wire() {
    const { $ } = this, on = { signal: this.ac.signal };
    const n = this.count;
    $("lesson-title").textContent = this.data.title;
    $("lesson-img").src = this.data.image;
    $("lesson-mark").setAttribute("viewBox", `0 0 ${this.data.width} ${this.data.height}`);
    $("lesson-caveat").textContent = this.data.caveat;
    $("lesson-back").addEventListener("click", () => this.run("Back", () => this.move(-1), this.i <= 0), on);
    $("lesson-next").addEventListener("click", () => this.run("Next step", () => this.move(1), this.i >= n - 1), on);
    $("lesson-play").addEventListener("click", () => this.run(null, () => this.toggle()), on);
    $("lesson-replay").addEventListener("click", () => this.run("Replay", () => this.replay()), on);
    $("lesson-where").addEventListener("click", () => this.run(null, () => this.where()), on);
    $("lesson-keys").addEventListener("click", () => $("lesson-keys").focus(), on);
    $("lesson").addEventListener("keydown", (e) => this.key(e), on);

    // Lesson sound settings, remembered on this device.
    const pace = this.store.get("lessonPace", 1);
    for (const r of document.querySelectorAll('input[name="lesson-pace"]')) {
      r.checked = Number(r.value) === pace;
      r.addEventListener("change", () => this.store.set("lessonPace", Number(r.value)), on);
    }
    const slider = (id, key, def, apply) => {
      const el = $(id);
      el.value = this.store.get(key, def);
      el.setAttribute("aria-valuetext", `${el.value} percent`);
      el.addEventListener("input", () => {
        el.setAttribute("aria-valuetext", `${el.value} percent`);
        this.store.set(key, Number(el.value));
        apply(Number(el.value));
      }, on);
    };
    slider("lesson-fx", "lessonFx", 80, (v) => this.A?.out.volume.rampTo(dbOf(v), 0.1));
    slider("lesson-bg-vol", "lessonBgVol", 30, (v) => this.A?.bgOut.volume.rampTo(dbOf(v) - 16, 0.2));
    $("lesson-bg").checked = false;   // never on by itself: it would be sound before a key press
    $("lesson-bg").addEventListener("change", (e) => {
      this.background(e.target.checked);
      this.say(e.target.checked ? "Ocean background on. It carries no information." : "Ocean background off.");
    }, on);
  }

  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.closest("input, select, textarea")) return;    // sliders and radios keep their own keys
    const onButton = t.closest("button, a");
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const last = this.count - 1;
    const act = (fn, name = null, edge = false) => { e.preventDefault(); this.run(name, fn, edge); };
    switch (k) {
      case " ": case "Enter": if (!onButton) act(() => this.toggle()); break;
      case "k": act(() => this.toggle()); break;
      case "ArrowRight": act(() => this.move(1), "Next step", this.i >= last); break;
      case "ArrowLeft": act(() => this.move(-1), "Back", this.i <= 0); break;
      case "Home": act(() => this.go(0), "First step"); break;
      case "End": act(() => this.go(last), "Last step"); break;
      case "r": act(() => this.replay(), "Replay"); break;
      case "w": act(() => this.where()); break;
      case "d": act(() => this.say(this.arrival()), "Read the step again"); break;
      case "t": act(() => this.toTour(), "Full tour"); break;
      case "h": case "?": act(() => this.say(KEYS)); break;
      default:
        if (t === this.$("lesson-keys") && k.length === 1) {
          act(() => this.say(`${/[a-z]/.test(k) ? k.toUpperCase() : k} does nothing here. Press H to hear the lesson keys.`), null, true);
        }
    }
  }

  // ---------- Steps ----------
  step() { return this.data.steps[this.i]; }
  pace() { return Number(document.querySelector('input[name="lesson-pace"]:checked')?.value || 1); }
  mono() { return this.$("mono").checked; }

  move(d) {
    const i = this.i + d;
    if (i < 0) { this.say(`Already at the first step: ${end(this.data.steps[0].title)}`); return; }
    if (i >= this.count) { this.say("This is the last step. Press T to go to the full tour, or Left arrow to go back."); return; }
    this.go(i);
  }

  go(i) {
    this.stop();
    this.i = clamp(i, 0, this.count - 1);
    this.seq = null;
    this.render();
    this.say(this.arrival());
  }

  /** What is said on arriving at a step: where you are, the explanation, then what to press. */
  arrival() {
    const st = this.step();
    let s = `Step ${this.i + 1} of ${this.count}: ${end(st.title)} ${st.text}`;
    if (this.mono() && this.usesDirection(st)) s += " Mono is on, so left and right sound the same: listen for rising and falling, and the words say east or west.";
    return `${s} ${this.hint()}`;
  }

  usesDirection(st) { return ["point", "series"].includes(st.kind) || (st.previews || []).some((p) => DIRECTION_CUES.has(p)); }

  hint() {
    const st = this.step(), last = this.i === this.count - 1;
    const next = last ? "This is the last step: press T to go to the full tour." : "Right arrow: next step.";
    if (st.kind === "point") return `Press Space to hear it. ${next}`;
    if (st.kind === "line" || st.kind === "series") return `Press Space to start, and Space again to pause. ${next}`;
    if (st.previews?.length) return `Press Space to hear ${st.previews.length === 1 ? "it" : `all ${st.previews.length}`}, or Tab to the buttons to try one at a time. ${next}`;
    return next;
  }

  /** The step's sound, as parts played one after another: [{ say, sound, info, mark }]. */
  parts() {
    const st = this.step();
    if (st.kind === "point") return [{ sound: { kind: "glide", dir: st.dir, dur: 1.8 }, info: `the water flows ${st.compass}`, mark: st }];
    if (st.kind === "line") {
      return st.samples.map((q, j) => ({
        say: `${q.km} kilometres out.`, sound: { kind: "ticks", speed: q.speed, dur: 2 }, mark: q, sample: j,
        info: `${q.km} kilometres from the coast: ${q.speedWord}, ${q.pct} percent of the fastest`,
      }));
    }
    if (st.kind === "series") {
      return st.parts.map((q) => ({
        say: `${q.date.replace(/ \d{4}$/, "")}.`, sound: { kind: "both", dir: q.dir, speed: q.speed, dur: 1.8 }, mark: q,
        info: `${q.date}: flowing ${q.compass}, ${q.speedWord}, ${q.pct} percent of the fastest`,
      }));
    }
    return (st.previews || []).map((id) => ({ say: `${this.data.cues[id].label}.`, sound: CUE_SOUNDS[id], info: this.data.cues[id].text }));
  }

  /** What is said when the step's sound has finished. */
  after() {
    const st = this.step();
    const next = this.i === this.count - 1 ? "Press T to go to the full tour." : "Press R to hear it again, or Right arrow for the next step.";
    if (st.kind === "point") return `That was ${st.compass}. ${next}`;
    return `${st.after ? `${st.after} ` : ""}${next}`;
  }

  // ---------- Playing ----------
  toggle() {
    this.ensure();                                         // start audio inside the key press (Safari needs this)
    const s = this.seq;
    if (s?.playing) { this.pause(); return; }
    if (!this.parts().length) { this.say(`This step has no sound. ${this.hint()}`); return; }
    this.playFrom(s && !s.ended ? s.k : 0, s && !s.ended && s.k > 0);
  }

  replay() {
    this.ensure();
    if (!this.parts().length) { this.say(`This step has no sound. ${this.hint()}`); return; }
    this.playFrom(0);
  }

  playFrom(k, resumed = false) {
    this.stop();
    this.onSound();                                       // the tour pauses: one thing at a time
    const s = this.seq = { parts: this.parts(), k, playing: true, ended: false };
    if (resumed) this.say(`Going on from ${k + 1} of ${s.parts.length}.`);
    this.update();
    this.later(s, () => this.nextPart(s), resumed ? SAY_GAP * 1000 : 0);
  }

  nextPart(s) {
    if (s.k >= s.parts.length) {
      Object.assign(s, { playing: false, ended: true, k: 0 });
      this.update();
      this.say(this.after());
      return;
    }
    const p = s.parts[s.k], pace = this.pace();
    this.update();
    if (p.say) this.say(p.say);
    this.later(s, async () => {
      const secs = await this.sound(p.sound, pace);
      this.later(s, () => { s.k++; this.nextPart(s); }, (secs + 0.6 * pace) * 1000);
    }, p.say ? SAY_GAP * pace * 1000 : 0);
  }

  later(s, fn, ms) {
    this.timers.push(setTimeout(() => { if (this.seq === s && s.playing) fn(); }, ms));
  }

  pause() {
    const s = this.seq;
    this.stop();
    if (!s) return;
    s.playing = false;
    this.update();
    this.say(s.parts.length > 1
      ? `Paused at ${s.k + 1} of ${s.parts.length}. Press Space to go on, or R to start again.`
      : "Paused. Press Space or R to hear it again.");
  }

  /** Stop every lesson sound and timer at once, silently (Escape, the tour starting, a new step). */
  stop() {
    for (const t of this.timers.splice(0)) clearTimeout(t);
    for (const v of this.voices.splice(0)) v.cut();
    if (this.seq?.playing) { this.seq.playing = false; this.update(); }
  }

  /** One example sound, then its meaning in words. */
  async preview(id) {
    this.ensure();
    this.stop();
    this.seq = null;
    this.onSound();
    const cue = this.data.cues[id];
    this.update(`Trying: ${cue.label}.`);
    const secs = await this.sound(CUE_SOUNDS[id], this.pace());
    const s = this.seq = { parts: [], k: 0, playing: true, ended: false };
    this.later(s, () => { s.playing = false; this.update(); this.say(cue.text); }, (secs + 0.2) * 1000);
  }

  // ---------- Sound ----------
  async ensure() {
    await T.start();                                       // inside the key press or click
    if (this.A) return this.A;
    const out = new T.Volume(dbOf(this.store.get("lessonFx", 80))).toDestination();
    // Ocean background: brown noise breathing slowly through a low filter. Off until asked for.
    const bgOut = new T.Volume(dbOf(this.store.get("lessonBgVol", 30)) - 16).toDestination();
    const bgGain = new T.Gain(0).connect(bgOut);
    const filter = new T.Filter({ type: "lowpass", frequency: 520, rolloff: -24 }).connect(bgGain);
    const breathe = new T.Gain(0.6).connect(filter);
    const lfo = new T.LFO({ frequency: 0.09, min: 0.25, max: 1 }).connect(breathe.gain);
    const noise = new T.Noise("brown").connect(breathe);
    this.A = { out, bgOut, bgGain, filter, breathe, lfo, noise, bgOn: false };
    return this.A;
  }

  async background(on) {
    const A = await this.ensure();
    A.bgOn = on;
    if (on) { if (A.noise.state !== "started") { A.noise.start(); A.lfo.start(); } A.bgGain.gain.rampTo(1, 1.5); }
    else {
      A.bgGain.gain.rampTo(0, 0.4);
      setTimeout(() => { if (!A.bgOn && A.noise.state === "started") { A.noise.stop(); A.lfo.stop(); } }, 600);
    }
  }

  /** Play one sound now; returns its length in seconds. Every node is freed when it ends or is cut. */
  async sound(spec, pace) {
    const A = await this.ensure();
    const gate = new T.Gain(1).connect(A.out), nodes = [gate];
    const keep = (n) => { nodes.push(n); return n; };
    const t = T.now() + 0.05, dur = spec.dur * pace, mono = this.mono();
    const tone = () => {
      const pan = keep(new T.Panner(0)).connect(gate);
      const syn = keep(new T.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.08, decay: 0.1, sustain: 0.9, release: 0.3 }, volume: -4 })).connect(pan);
      return { pan, syn };
    };
    const glide = (dir) => {
      const r = (dir * Math.PI) / 180, north = Math.cos(r), east = mono ? 0 : Math.sin(r) * 0.95;
      const { pan, syn } = tone();
      pan.pan.setValueAtTime(-east, t);
      pan.pan.linearRampToValueAtTime(east, t + dur);
      syn.triggerAttack(BASE * 2 ** (-0.5 * north), t);
      syn.frequency.exponentialRampToValueAtTime(BASE * 2 ** (0.5 * north), t + dur);
      syn.triggerRelease(t + dur);
    };
    const ticks = (speed) => {
      const syn = keep(new T.MembraneSynth({ pitchDecay: 0.008, octaves: 2, envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 }, volume: -10 })).connect(gate);
      const rate = 1.2 + 9 * clamp(speed, 0, 1);         // ticks per second: 1.2 (still) to 10.2 (fastest)
      for (let j = 0, n = Math.max(2, Math.round(dur * rate)); j < n; j++) syn.triggerAttackRelease("C5", 0.03, t + j / rate);
    };
    if (spec.kind === "glide") glide(spec.dir);
    else if (spec.kind === "ticks") ticks(spec.speed);
    else if (spec.kind === "both") { glide(spec.dir); ticks(spec.speed); }
    else {                                                 // bob: a wave, rising and falling in one place
      const { syn } = tone();
      syn.triggerAttack(BASE, t);
      for (let c = 1; c <= 6; c++) syn.frequency.linearRampToValueAtTime(BASE * 2 ** ((c % 2 ? 3 : -3) / 12), t + (dur * c) / 6);
      syn.triggerRelease(t + dur);
    }
    const secs = dur + 0.35;
    if (A.bgOn) {                                          // the background dips under every lesson sound
      A.bgGain.gain.cancelScheduledValues(t);
      A.bgGain.gain.setTargetAtTime(0.2, t - 0.05, 0.08);
      A.bgGain.gain.setTargetAtTime(1, t + secs, 0.5);
    }
    let gone = false;
    const free = () => { if (gone) return; gone = true; for (const n of nodes) { try { n.dispose(); } catch { /* already gone */ } } };
    const v = { cut: () => { gate.gain.cancelScheduledValues(T.now()); gate.gain.setValueAtTime(0, T.now()); setTimeout(free, 300); } };
    this.voices.push(v);
    setTimeout(() => { this.voices = this.voices.filter((x) => x !== v); free(); }, (secs + 0.6) * 1000);
    return secs;
  }

  // ---------- What is shown, and the words for where you are ----------
  render() {
    const { $ } = this, st = this.step();
    $("lesson-pos").textContent = `Step ${this.i + 1} of ${this.count}`;
    $("lesson-step-h").textContent = st.title;
    $("lesson-text").textContent = st.text;
    const box = $("lesson-previews");
    box.innerHTML = "";
    for (const id of st.previews || []) {
      const cue = this.data.cues[id];
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn"; b.dataset.cue = id;
      b.innerHTML = '<b></b><span class="sr-only">: </span><span class="hint"></span>';
      b.querySelector("b").textContent = cue.label;
      b.querySelector(".hint").textContent = cue.text.includes(": ") ? cue.text.split(": ").slice(1).join(": ") : "";
      b.addEventListener("click", () => this.run(cue.label, () => this.preview(id)), { signal: this.ac.signal });
      box.append(b);
    }
    $("lesson-try").hidden = !st.previews?.length;
    this.update();
  }

  /** The visible "Now" line, the Play button, and the marker on NASA's picture. */
  update(now) {
    const { $ } = this, s = this.seq;
    $("lesson-state").textContent = now || this.stateText();
    const playing = !!s?.playing;
    $("lesson-play").dataset.state = playing ? "playing" : "paused";
    $("lesson-play-label").textContent = playing ? "Pause" : s?.ended ? "Play again" : s && s.k > 0 ? "Go on" : "Play";
    const part = s?.parts[s.k];
    this.mark(part?.mark, part?.sample);
  }

  stateText() {
    const st = this.step(), s = this.seq, n = s?.parts.length || 0;
    const at = (k) => (n > 1 ? ` ${k + 1} of ${n}` : "");
    const info = s?.parts[s.k]?.info;
    if (s?.playing && n) return `Playing${at(s.k)}: ${end(info)}`;
    if (s && !s.ended && s.k > 0) return `Paused at${at(s.k)}: ${end(info)}`;
    if (st.kind === "point") return `${cap(st.place)}: the water flows ${st.compass}, ${st.speedWord}, ${st.pct} percent of the fastest water in this view.`;
    if (st.kind === "line") return `${cap(st.place)}: ${st.samples.length} places, from ${st.samples[0].km} to ${st.samples.at(-1).km} kilometres out.`;
    if (st.kind === "series") return `${cap(st.place)}: ${st.parts.length} times, 8 days apart, from ${this.data.from} to ${this.data.to}.`;
    return st.previews?.length ? `${st.previews.length} example ${st.previews.length === 1 ? "sound" : "sounds"} to try.` : "No sound in this step.";
  }

  where() {
    const st = this.step();
    this.say(`You are in the lesson, step ${this.i + 1} of ${this.count}: ${end(st.title)} ${this.stateText()} ${this.seq?.playing ? "Space pauses." : this.hint()}`);
  }

  /** Leave the lesson for the full tour: the listener asked, so focus moves to the player's keys. */
  toTour() {
    this.stop();
    this.$("keys").focus();
    this.say("Full tour player. Press Space to play, or L to come back to the lesson.");
  }

  /** Marker on NASA's picture: the place and an arrow the way the water goes (longer = faster). */
  mark(m, sample) {
    const st = this.step(), W = this.data.width, H = this.data.height;
    let svg = "", words = "";
    const arrow = (q, hot = true) => {
      const x = q.x * W, y = q.y * H, len = 18 + 60 * q.speed, r = (q.dir * Math.PI) / 180;
      const x2 = x + Math.sin(r) * len, y2 = y - Math.cos(r) * len, hx = Math.sin(r), hy = -Math.cos(r);
      const head = `${x2 + hx * 9},${y2 + hy * 9} ${x2 - hy * 6},${y2 + hx * 6} ${x2 + hy * 6},${y2 - hx * 6}`;
      return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="7" stroke-linecap="round"/>`
        + `<polygon points="${head}" fill="#000" stroke="#000" stroke-width="4" stroke-linejoin="round"/>`
        + `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="#ffc861" stroke-width="3.5" stroke-linecap="round"/>`
        + `<polygon points="${head}" fill="#ffc861"/>`
        + `<circle cx="${x}" cy="${y}" r="${hot ? 8 : 5}" fill="#ffc861" stroke="#000" stroke-width="3"/>`;
    };
    if (st.kind === "line") {
      const p = st.samples;
      svg += `<line x1="${p[0].x * W}" y1="${p[0].y * H}" x2="${p.at(-1).x * W}" y2="${p.at(-1).y * H}" stroke="#000" stroke-width="6"/>`
        + `<line x1="${p[0].x * W}" y1="${p[0].y * H}" x2="${p.at(-1).x * W}" y2="${p.at(-1).y * H}" stroke="#ffc861" stroke-width="2.5" stroke-dasharray="6 5"/>`;
      p.forEach((q, j) => { svg += `<circle cx="${q.x * W}" cy="${q.y * H}" r="${j === sample ? 10 : 5}" fill="${j === sample ? "#ffc861" : "#fff"}" stroke="#000" stroke-width="3"/>`; });
      words = ` Marked: a line ${st.place}${sample !== undefined ? `, place ${sample + 1} of ${p.length} highlighted` : ""}.`;
    } else if (st.kind === "point" || (st.kind === "series" && m)) {
      const q = m || st;
      svg += arrow(q);
      words = ` Marked: ${st.place}, with an arrow pointing ${q.compass}.`;
    } else if (st.kind === "series") {                     // before it plays: the place only
      svg += `<circle cx="${st.x * W}" cy="${st.y * H}" r="8" fill="#ffc861" stroke="#000" stroke-width="3"/>`;
      words = ` Marked: ${st.place}.`;
    }
    this.$("lesson-mark").innerHTML = svg;
    this.$("lesson-pic").setAttribute("aria-label", `${this.data.alt}${words}`);
  }

  dispose() {
    this.stop();
    this.ac.abort();
    if (this.A) for (const n of Object.values(this.A)) { if (n?.dispose) try { n.dispose(); } catch { /* gone */ } }
    this.A = null;
    this.$("lesson-mark").innerHTML = "";
    this.$("lesson-previews").innerHTML = "";
  }
}
