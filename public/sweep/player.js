// Transport + look-ahead scheduler, shared by every track.
// A track's mapping module says how the timeline is cut into segments and steps and what
// each step sounds like; the audio clock drives everything.

const LOOKAHEAD = 0.25;     // seconds of audio scheduled ahead
const TICK_MS = 25;
const NOTE_COOLDOWN = 0.25; // same voice+pitch can't repeat faster than this (one feature = one note)

export class Player {
  constructor({ track, mapping, audio, settings, onVoice, onPad, onBeat, onStep, onEnd, onStateChange }) {
    Object.assign(this, { track, mapping, audio, settings, onVoice, onPad, onBeat, onStep, onEnd, onStateChange });
    this.segments = mapping.segments(track).map((seg, index) => ({ ...seg, index }));
    this.position = 0;
    this.playing = false;
    this._timer = null;
    this._lastNote = new Map();
    this._retime();
  }

  /** Segment lengths come from the (live-tunable) settings. */
  _retime() {
    let start = 0;
    for (const seg of this.segments) {
      seg.dur = this.mapping.segmentSeconds(this.track, seg, this.settings);
      seg.stepDur = seg.dur / seg.steps;
      seg.start = start;
      start += seg.dur;
    }
    this.duration = start;
  }

  /** Apply a speed change live, keeping the scan where it is in the data. */
  retime() {
    const was = this.playing;
    const pos = this.currentPosition;
    const seg = this.segmentAt(pos);
    const frac = Math.min(1, (pos - seg.start) / seg.dur);
    const atEnd = pos >= this.duration;
    if (was) this._stop();
    this._retime();
    this.position = atEnd ? this.duration : seg.start + frac * seg.dur;
    if (was) this.play();
  }

  /** Segment containing timeline position t (clamped). */
  segmentAt(t) {
    const s = this.segments;
    for (let i = s.length - 1; i >= 0; i--) if (t >= s[i].start) return s[i];
    return s[0];
  }

  get currentPosition() {
    if (!this.playing) return this.position;
    const t = this._posStart + (this.audio.now() - this._ctxStart);
    return Math.min(this.duration, Math.max(this._posStart, t));
  }

  async play() {
    if (this.playing) return;
    await this.audio.unlock();
    if (this.position >= this.duration - 0.05) this.position = 0;
    this.playing = true;
    this._ctxStart = this.audio.now() + 0.08;
    this._posStart = this.position;
    const seg = this.segmentAt(this.position);
    const step = Math.ceil((this.position - seg.start) / seg.stepDur - 1e-6);
    this._cursor = { seg: seg.index, step };
    if (step >= seg.steps) this._advanceSegment();
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this.onStateChange?.('playing');
  }

  pause() {
    if (!this.playing) return;
    this.position = this.currentPosition;
    this._stop();
    this.onStateChange?.('paused');
  }

  toggle() { return this.playing ? this.pause() : this.play(); }

  seek(t) {
    const was = this.playing;
    if (was) this._stop();
    this.position = Math.min(Math.max(0, t), this.duration);
    if (was) this.play();
    else this.onStateChange?.('paused');
  }

  seekSegment(i) {
    const s = this.segments[Math.min(Math.max(0, i), this.segments.length - 1)];
    this.seek(s.start);
  }

  /** Schedule every step in [from, to) at once (offline rendering). Timeline `from` = audio time t0. */
  scheduleAll(from, to, t0 = 0.05) {
    for (const seg of this.segments) {
      for (let step = 0; step < seg.steps; step++) {
        const pos = seg.start + step * seg.stepDur;
        if (pos >= from && pos < to) this._scheduleStep(seg, step, t0 + pos - from);
      }
    }
  }

  _stop() {
    clearInterval(this._timer);
    clearTimeout(this._endTimer);
    this._timer = null;
    this.playing = false;
    this.audio.silence();
    this._lastNote.clear();
  }

  _advanceSegment() {
    this._cursor.seg += 1;
    this._cursor.step = 0;
  }

  _scheduleStep(seg, step, time) {
    const plan = this.mapping.planStep(this.track, seg, step);

    for (const ev of plan.events) {
      const t = time + ev.offset;
      const key = `${ev.voice}:${ev.midi}`;
      if (t - (this._lastNote.get(key) ?? -1) < NOTE_COOLDOWN) continue;
      this._lastNote.set(key, t);
      // ev.pos: where the note sits along the scan line (-1 = top = left ear … +1 = bottom = right ear)
      this.audio.play(ev, t, ev.pos);
      this.audio.draw(() => this.onVoice?.(ev, seg), t);
    }
    this.audio.setHum(plan.hum.level, plan.hum.pan, time, seg.stepDur, plan.hum.tension ?? 0);
    this.audio.draw(() => this.onPad?.(plan.hum.level), time);
    this.audio.draw(() => this.onStep?.(seg, step, plan), time);
    if (plan.beat) {
      this.audio.beat(time, plan.beat);
      this.audio.draw(() => this.onBeat?.(plan.beat), time);
    }
  }

  _tick() {
    const horizon = this.audio.now() + LOOKAHEAD;
    while (this.playing) {
      const { seg: si, step } = this._cursor;
      if (si >= this.segments.length) {
        const endAt = this._ctxStart + (this.duration - this._posStart);
        clearInterval(this._timer);
        this._timer = null;
        this._endTimer = setTimeout(() => {
          this.position = this.duration;
          this._stop();
          this.onEnd?.();
          this.onStateChange?.('ended');
        }, Math.max(0, (endAt - this.audio.now()) * 1000 + 200));
        return;
      }
      const seg = this.segments[si];
      const time = this._ctxStart + (seg.start + step * seg.stepDur - this._posStart);
      if (time > horizon) return;
      this._scheduleStep(seg, step, time);
      this._cursor.step += 1;
      if (this._cursor.step >= seg.steps) this._advanceSegment();
    }
  }
}
