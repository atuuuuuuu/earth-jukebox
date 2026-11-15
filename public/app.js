// app.js: the page. Loads the track list and scores (backend/API.md), plays them with the sweep
// engine (public/sweep/), and shows them on the globe (globe.js). Every action is a button or a
// form control; single-key shortcuts work only inside the player, so they never fight a screen reader.
(async () => {
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`ej:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`ej:${k}`, JSON.stringify(v)); } catch { /* private mode: not remembered */ } },
  };

  // ---------- Speaking ----------
  // One polite live region. Clearing it first makes a repeated message speak again.
  // "Read aloud" uses the device's voice, at the volume and speed set in the lesson's settings.
  const voice = { vol: store.get("voiceVol", 100), rate: store.get("voiceRate", 100) };
  let sayTimer, echo = null;
  const say = (text) => {
    // Key echo: the name of the key or button just used, said once before its answer.
    if (echo) { text = `${echo}. ${text}`; echo = null; }
    clearTimeout(sayTimer);
    $("live").textContent = "";
    sayTimer = setTimeout(() => { $("live").textContent = text; }, 60);
    if ($("speak").checked && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = voice.rate / 100;
      u.volume = voice.vol / 100;
      speechSynthesis.speak(u);
    }
  };
  const showError = (text, retry) => {
    const el = $("alert");
    el.hidden = false;
    el.innerHTML = "";
    const p = document.createElement("p"); p.textContent = text; p.style.margin = "0";
    el.append(p);
    if (retry) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn"; b.textContent = "Try again";
      b.addEventListener("click", () => location.reload());
      el.append(b);
    }
  };

  // ---------- Words ----------
  const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;
  const lonWords = (l) => { l = wrapLon(l); const a = Math.round(Math.abs(l)); return a === 0 || a === 180 ? `${a} degrees` : `${a} degrees ${l < 0 ? "west" : "east"}`; };
  const latWords = (l) => (Math.abs(l) < 0.5 ? "the equator" : `${Math.round(Math.abs(l))} degrees ${l < 0 ? "south" : "north"}`);
  const NOTE_NAMES = ["C", "C sharp", "D", "D sharp", "E", "F", "F sharp", "G", "G sharp", "A", "A sharp", "B"];
  const noteName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
  const hertz = (m) => Math.round(440 * 2 ** ((m - 69) / 12));
  const sentences = (t) => t.split(/(?<=\.)\s+(?=[A-Z])/);
  const earOf = (pos) => ($("mono").checked || Math.abs(pos) < 0.33 ? "in the centre" : pos < 0 ? "in your left ear" : "in your right ear");

  // ---------- Settings, remembered on this device ----------
  const settings = {
    volume: store.get("volume", 80), bpm: store.get("bpm", 84), mono: store.get("mono", false), continuous: store.get("continuous", false),
  };
  $("volume").value = settings.volume;
  $("mono").checked = settings.mono;
  $("continuous").checked = settings.continuous;
  $("announce").checked = store.get("announce", true);
  $("speak").checked = store.get("speak", false);
  for (const id of ["keyecho", "clicks", "vibrate"]) {
    $(id).checked = store.get(id, true);
    $(id).addEventListener("change", (e) => store.set(id, e.target.checked));
  }
  // Vibration only where the device has it (Android phones); hide the option elsewhere.
  const canBuzz = "vibrate" in navigator;
  $("vibrate-row").hidden = $("vibrate-hint").hidden = !canBuzz;
  let lastBuzz = 0;
  const buzz = (ms) => {
    if (!canBuzz || !$("vibrate").checked || document.hidden) return;
    const now = performance.now();
    if (now - lastBuzz < 70) return;            // phones cannot follow faster than this
    lastBuzz = now;
    navigator.vibrate(ms);
  };
  const speedRadio = document.querySelector(`input[name="speed"][value="${settings.bpm}"]`);
  if (speedRadio) speedRadio.checked = true;
  const volText = () => `${settings.volume} percent`;
  $("volume").setAttribute("aria-valuetext", volText());

  // ---------- Load the tracks ----------
  let index;
  try {
    const r = await fetch("api/tracks.json");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    index = await r.json();
  } catch (e) {
    $("track-list").innerHTML = "";
    say("");
    showError("The tracks could not load. Check your connection and that the page is served by a web server, then try again.", true);
    return;
  }
  const tracks = (index.tracks || []).filter((t) => t.engine === "sweep");
  if (!tracks.length) {
    $("track-list").innerHTML = '<p class="muted">There are no tracks yet.</p>';
    say("There are no tracks yet.");
    return;
  }
  const scores = new Map();
  const getScore = (t) => {
    if (!scores.has(t.id)) {
      scores.set(t.id, fetch(t.score).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .catch((e) => { scores.delete(t.id); throw e; }));
    }
    return scores.get(t.id);
  };

  // Track list: native radios, so arrow keys move between tracks.
  $("track-list").innerHTML = "";
  tracks.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "track";
    div.innerHTML = `<input type="radio" name="track"><label><span class="t-no"></span> <span class="t-title"></span><span class="sr-only">. </span><span class="t-sub"></span></label>`;
    const input = div.querySelector("input");
    input.id = `track-${t.id}`; input.value = t.id; input.checked = i === 0;
    input.setAttribute("aria-describedby", `${input.id}-desc`);
    div.querySelector("label").htmlFor = input.id;
    div.querySelector(".t-no").textContent = `${i + 1}.`;
    div.querySelector(".t-title").textContent = t.title;
    const sub = div.querySelector(".t-sub");
    sub.textContent = t.subtitle;
    const desc = document.createElement("span");
    desc.id = `${input.id}-desc`; desc.hidden = true; desc.textContent = t.description;   // read once, as the radio's description
    div.append(desc);
    $("track-list").append(div);
  });

  // Credits, one per NASA source.
  const seen = new Set();
  for (const t of tracks) {
    if (seen.has(t.source.url)) continue;
    seen.add(t.source.url);
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = t.source.url; a.textContent = t.source.title;
    li.append(a, `. ${t.source.credit}.`);
    $("credits").append(li);
  }

  // ---------- The globe (or a flat image when WebGL is missing) ----------
  let globe = null;
  try {
    globe = new Globe($("globe"), { onPick: (hit) => pickSpot(hit) });
    globe.follow = true;
    globe.spin = !reduced.matches;
    const earth = new Image();
    earth.onload = () => globe.setEarth(earth);
    earth.src = "textures/blue-marble.jpg";
  } catch {
    globe = null;
    $("globe").hidden = true;
  }
  window.globe = globe;
  window.globeReady = !!globe;
  const frameImgs = new Map();
  const loadImg = (src) => {
    if (!frameImgs.has(src)) {
      frameImgs.set(src, new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }));
    }
    return frameImgs.get(src);
  };

  // ---------- Player state ----------
  let track = null, score = null, son = null, playing = false, gen = 0, sweepMod = null;
  let lesson = null, lessonMod = null;   // the guided lesson before the player, for tracks that have one
  window.lesson = null;                   // a global, not the <section id="lesson"> the browser would give
  const usesVideo = () => !!score?.frames && score.sweep.mapping === "co2";
  // The maps heard now: the track's own, or those of the region or stories chosen (score.views).
  const frames = () => son?.frames ?? score.frames;
  const n = () => frames().length;
  const pos = () => tracks.indexOf(track) + 1;
  const unit = () => son?.unit ?? "map";
  // A map's spoken name; in lightning's compare mode, "Part 6 of 14 compared with Part 5".
  const whenOf = (i) => son?.mapName?.(i) ?? frames()[i].when;
  // "Part 4 of 14" already counts itself; other names get "map 4 of 14" (or "story 4 of 6").
  const mapText = (i) => (/ of \d+\b/.test(whenOf(i)) ? whenOf(i) : `${whenOf(i)}, ${unit()} ${i + 1} of ${n()}`);
  // Views: the whole map, or one of the score's options (NASA's zoom regions, NASA's stories).
  const views = () => son?.viewOptions ?? [];
  const viewName = () => son?.view?.name ?? "Whole map";
  // Layers of one map, heard all together or one alone (aerosols): from the score, never hardcoded.
  const layers = () => son?.layers ?? [];
  const layerName = (id) => layers().find((L) => L.id === id)?.name ?? "";
  const countWord = (k) => ["no", "one", "two", "three", "four", "five", "six"][k] ?? String(k);
  const allText = () => `all ${countWord(layers().length)} ${score.words.what}s`;
  const listenText = (id = son?.solo) => (id ? `${layerName(id)} only` : `${allText()[0].toUpperCase()}${allText().slice(1)}`);
  // The picture of the map, or of the one layer heard alone.
  const imageOf = (i) => (son?.solo && layers().find((L) => L.id === son.solo)?.image) || frames()[i].image;

  const setPlayButton = () => {
    $("play").dataset.state = playing ? "playing" : "paused";
    $("play-label").textContent = playing ? "Pause" : "Play";
  };

  const showFrame = (i) => {
    const f = frames()[i];
    $("map").value = i;
    $("map").setAttribute("aria-valuetext", mapText(i));
    const where = son?.view && son.view.unit === "map" ? `${son.view.name} · ` : "";
    $("stage-when").textContent = son?.comparing ? (i ? `${f.when} − ${frames()[i - 1].when.replace(/ of \d+$/, "")}` : `${f.when}: nothing before it`) : `${where}${f.when}`;
    const box = son?.boxOf(i) ?? null;
    const inBox = box ? ` Only the ${son.view.unit === "story" ? `window around ${f.when}` : son.view.name} is heard, ${latWords(box[3])} to ${latWords(box[1])}, ${lonWords(box[0])} to ${lonWords(box[2])}.` : "";
    const label = `${(f.alt || score.words.map).replace(/\.$/, "")}.${inBox} ${n() > 1 ? `${unit()[0].toUpperCase()}${unit().slice(1)} ${i + 1} of ${n()}.` : ""}`.trim();
    if (globe) {
      const was = globe.box;
      globe.box = box;
      if (box && (!was || was.join() !== box.join())) globe.lookAt((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    }
    if (usesVideo()) $("video-wrap").setAttribute("aria-label", label);
    else $("globe").setAttribute("aria-label", `3D globe: ${label}`);
    $("map-img").alt = label;
    if (!usesVideo()) {
      const src = imageOf(i);
      if (globe) loadImg(src).then((im) => { if (im && frames()[i] === f && imageOf(i) === src) globe.setFrame(im); });
      else { $("map-img").src = src; }
      loadImg(frames()[(i + 1) % n()].image);   // the next map, ready before it is needed
    }
    syncVideo(true);
    showViewMap(i);
  };

  // Carbon dioxide is NASA's own turning-globe video: keep it in step with the sound.
  const syncVideo = (jump = false) => {
    if (!usesVideo() || !son) return;
    const v = $("video"), t = son.mediaTime();
    if (t === null) return;
    // Never seek again while a seek is still loading, or the video never gets to play.
    if (jump || (!v.seeking && Math.abs(v.currentTime - t) > 0.3)) v.currentTime = t;
    if (playing) { v.playbackRate = son.mediaRate(); if (v.paused) v.play().catch(() => {}); } else v.pause();
  };

  // While playing: the progress bar, the flat image's line, and the video.
  const tick = () => {
    if (!playing || !son) return;
    $("stage-fill").style.width = `${son.progress() * 100}%`;
    syncVideo();
    moveNeedle();
    const sea = son.info?.sea;
    if (sea && Number.isFinite(sea.temp)) $("readout").textContent = `${Math.round(sea.temp)} °C · note ${noteName(son.mapping.melodyMidi(sea.temp))} · ${son.mapping.chordFor(son.track, sea.temp, sea.share).levels.filter((l) => l > 0.02).length} chord voices · ${latWords(sea.lat)}`;
    const d = son.info?.decade;
    if (d && son.isDecade() && $("view-map-note")) $("view-map-note").textContent = decadeText(d);
    if (d && son.isDecade()) drawDecade(d.year + 1);
    requestAnimationFrame(tick);
  };

  // ---------- Building the sonifier for a track ----------
  let lastNote = null;
  // What is said as a map starts: its name; for one of NASA's stories, also what it is about.
  const startText = (i) => (unit() === "story" ? `${whenOf(i)}. ${sentences(frames()[i].text)[1] ?? ""}`.trim() : `${whenOf(i)}.`);
  const onFrame = (f, i) => {
    showFrame(i);
    window.framesSeen = (window.framesSeen || 0) + 1;
    if (playing && $("announce").checked && son?.started) say(startText(i));
    if (son) son.started = true;
  };
  const onStep = (i, info) => { son.info = info; };
  const onNote = (note) => {
    lastNote = note;
    if (note.midi) $("readout").textContent = `${noteName(note.midi)} · ${hertz(note.midi)} Hz · ${latWords(note.lat)}`;
    buzz(Math.round(12 + 30 * (note.velocity ?? 0.5)));
    const ring = score.sweep.chapter === "anomaly" ? { gain: 2, loss: 3 } : { gain: 1, loss: 2 };
    if (globe && !usesVideo()) globe.ping(note.lon, note.lat, ring[note.kind] ?? 0);
  };
  const onEnd = () => {
    playing = false; setPlayButton(); idle();
    say(`End of track ${pos()}, ${track.title}. Press Space in the player to play it again, or choose another track.`);
  };
  const idle = () => {
    $("stage-fill").style.width = son ? `${son.progress() * 100}%` : "0";
    syncVideo();
    moveNeedle();
    drawDecade();
  };

  // The decade as a picture, for sighted listeners: time runs left to right, and each year's note is a
  // dot, higher when the place had more light than in its first year. The dots appear as the notes play;
  // at rest all of them show. Drawn from the same numbers the notes are made from (son.decadeSeries).
  const SVG = "http://www.w3.org/2000/svg";
  let decadeDrawn = null;
  const drawDecade = (upTo = Infinity) => {
    const fig = $("decade-chart"), series = son?.isDecade() && !$("view-map").hidden ? son.decadeSeries() : null;
    fig.hidden = !series;
    if (!series) { decadeDrawn = null; return; }
    const W = Math.max(260, fig.clientWidth || 320), H = 230, m = { l: 50, r: 16, t: 16, b: 36 };
    const n = series.length, shown = Math.min(n, upTo);
    const key = `${W}|${shown}|${upTo === Infinity}|${son.index}|${son.view?.id ?? ""}`;
    if (key === decadeDrawn) return;
    decadeDrawn = key;
    const start = series.find((v) => v > 0) ?? 0, ratio = series.map((v) => (start ? v / start : 0));
    const lo = Math.min(1, ...ratio) - 0.04, hi = Math.max(1, ...ratio) + 0.04;
    const x = (i) => m.l + (n > 1 ? i / (n - 1) : 0.5) * (W - m.l - m.r);
    const y = (r) => m.t + (1 - (r - lo) / (hi - lo)) * (H - m.t - m.b);
    const svg = $("decade-svg"), first = frames()[0].when;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);
    const add = (tag, attrs, text) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
    svg.replaceChildren();
    // Light compared with the first year: gridlines every 10 or 20 percent, the first year's level dashed.
    const span = (hi - lo) * 100, stepP = span > 60 ? 20 : span > 24 ? 10 : 5;
    for (let p = Math.ceil((lo - 1) * 100 / stepP) * stepP; p <= (hi - 1) * 100; p += stepP) {
      const yy = y(1 + p / 100);
      add("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: p === 0 ? "dc-base" : "dc-grid" });
      add("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end", class: "dc-text" }, p === 0 ? first : `${p > 0 ? "+" : ""}${p}%`);
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - m.l - m.r) / 56))));
    for (let i = 0; i < n; i += every) add("text", { x: x(i), y: H - 12, "text-anchor": "middle", class: "dc-text" }, frames()[i].when);
    add("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: "dc-axis" });
    add("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "dc-axis" });
    if (shown > 1) add("polyline", { points: ratio.slice(0, shown).map((r, i) => `${x(i)},${y(r)}`).join(" "), class: "dc-line" });
    ratio.slice(0, shown).forEach((r, i) => {
      const now = upTo !== Infinity && i === shown - 1;
      const dot = add("circle", { cx: x(i), cy: y(r), r: now ? 7 : 5, class: now ? "dc-dot is-now" : "dc-dot" });
      const pct = Math.round((r - 1) * 100);
      dot.append(Object.assign(document.createElementNS(SVG, "title"), { textContent: `${frames()[i].when}: ${Math.abs(pct) < 3 ? "about the same light" : `${Math.abs(pct)} percent ${pct > 0 ? "more" : "less"} light`} than ${first}` }));
    });
    $("decade-caption").textContent = `Time runs left to right, one dot for each year's note. A dot higher up means more light than in ${first}, lower means less.`;
  };
  window.addEventListener("resize", () => { decadeDrawn = null; if (!playing) drawDecade(); });

  const loadTrack = async (t, { announce = true, fromShow = false } = {}) => {
    if (!fromShow) showing = false;       // choosing a track ends the show
    const mine = ++gen;
    if (son) { son.dispose(); son = null; }
    if (lesson) { lesson.dispose(); lesson = window.lesson = null; }
    $("lesson").hidden = $("to-lesson").hidden = true;
    playing = false; setPlayButton();
    $("play").disabled = true;
    $("alert").hidden = true;
    track = t;
    $("np-title").textContent = t.title;
    let s;
    try {
      s = await getScore(t);
      sweepMod ||= await import("./sweep/sonifier.js");
      if (mine !== gen) return;
      score = s;
      son = await sweepMod.createSweep(score, { ...settings, startIndex: 0, onFrame, onStep, onEnd, onNote, onBeat: () => buzz(60) });
    } catch (e) {
      console.error(e);
      if (mine !== gen) return;
      showError(`Track ${t.title} could not load. Check your connection, then try again.`, true);
      say(`Track ${t.title} could not load.`);
      return;
    }
    if (mine !== gen) { son.dispose(); son = null; return; }
    window.son = son;
    lastNote = null;
    $("continuous-row").hidden = $("continuous-hint").hidden = !son.hasNotes;

    // A guided lesson comes before the player where the track has one (ocean currents).
    if (score.lesson) {
      try {
        lessonMod ||= await import("./lesson.js");
        const l = await lessonMod.createLesson(score.lesson, { $, say, run, store, onSound: () => pauseForSpeech() });
        if (mine !== gen) { l.dispose(); return; }
        lesson = window.lesson = l;
        $("lesson").hidden = $("to-lesson").hidden = false;
      } catch (e) {
        console.error(e);   // the track still plays without its lesson
      }
    }

    // The picture: NASA's video for carbon dioxide, the globe for map tracks.
    const video = usesVideo();
    $("video-wrap").hidden = !video;
    $("globe").hidden = video || !globe;
    $("map-img").hidden = video || !!globe;
    document.querySelector(".stage-hint").hidden = video || !globe;
    if (video) {
      const v = $("video");
      const data = await (await fetch(score.sweep.src)).json().catch(() => null);
      if (mine !== gen) return;               // another track was chosen while this one loaded
      if (data?.media) { v.poster = data.media.poster; if (!v.src.endsWith(data.media.src)) v.src = data.media.src; }
    }
    if (globe) {
      // A line moving south (sea heat) is drawn as a circle of latitude; the others as a meridian.
      globe.scanLat = son.scan === "south";
      globe.headFn = video ? null : globe.scanLat ? () => son?.headLat() : () => son?.headLon();
      // Sea maps: NASA paints land plain grey (no reading there), so the planet's own land shows instead.
      globe.full = !["anomaly", "currents"].includes(score.sweep.chapter);
      globe.pings = [];
    }

    // The map slider, and buttons that make no sense for a one-map track.
    $("map").max = n() - 1;
    $("map-field").hidden = n() < 2;
    $("prev").disabled = $("next").disabled = n() < 2;
    // Compare with previous part: only where the track has it, and always off when a track loads.
    $("compare").checked = false;
    $("compare-field").hidden = !son.canCompare;
    renderListen();
    renderViews();
    renderDecadeButton();
    renderAbout();
    renderMystery();
    renderStories();
    renderViewMap();
    renderSounds();
    showFrame(0);
    idle();
    $("play").disabled = false;
    window.ready = true;
    if (announce) {
      // A track with layers says how to hear one alone: "Press B, U, T or L for black carbon, dust, …"
      const L = layers();
      const choose = L.length
        ? `${listenText(null)} play together. Press ${orList(L.map((x) => x.key.toUpperCase()))} for ${orList(L.map((x) => x.name.toLowerCase()))} alone. `
        : "";
      const inPlayer = document.activeElement?.closest?.("#player");
      say(lesson
        ? `Track ${pos()} of ${tracks.length}, ${t.title}. It starts with a guided lesson, ${lesson.title}, in ${lesson.count} short steps. `
          + (inPlayer ? "Press L to go to the lesson, or Space to play the full tour." : "Press Tab to reach the lesson. The full tour player comes after it.")
        : `Track ${pos()} of ${tracks.length}, ${t.title}. ${n()} ${n() === 1 ? "map" : "maps"}, about ${Math.round(son.passSeconds())} seconds. ${choose}${viewTip()}${sidewaysTip()}${decadeIndex() >= 0 ? "The last map is the change over the decade: press End, or the Hear the change over the decade button. " : ""}`
          + (inPlayer ? "Press Space to play." : "Press Tab to reach the player, then Space to play."));
    }
  };
  const orList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
  // A line moving south (sea heat) turns the ears round: say so whenever the track comes up.
  const sideways = () => son?.scan === "south";
  const sidewaysTip = () => (sideways() ? "On this track the scan line moves from north to south, so west is your left ear and east your right ear. " : "");
  // "2016: 12 percent more light than 2012" (the decade, from the year's light against the first year)
  const decadeText = (d) => {
    const pct = Math.round((d.ratio - 1) * 100), first = frames()[0].when;
    const how = Math.abs(pct) < 3 ? `about the same light as ${first}` : `${Math.abs(pct)} percent ${pct > 0 ? "more" : "less"} light than ${first}`;
    return `${frames()[d.year].when}: ${how}${d.figure ? `. Then NASA's change map: ${d.figure === "more" ? "more light" : d.figure === "less" ? "less light" : "little change"}` : ""}`;
  };
  // Night lights' last map is the change over the decade: a button that goes there and plays it, so nobody has to find it.
  const decadeIndex = () => frames().findIndex((_, i) => son.isDecade(i));
  const renderDecadeButton = () => { $("decade-go").hidden = !son || decadeIndex() < 0; };
  $("decade-go").addEventListener("click", () => run("Change over the decade", () => {
    const i = decadeIndex();
    if (i < 0) return;
    goTo(i, false);
    if (!playing) play(); else say(`Playing ${whenOf(i)}.`);
  }));
  const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

  // ---------- Region or stories: other ways to hear the track (score.views) ----------
  // Native radios in a fieldset, "Whole map" first, built from the score; its letter (R) moves to the next.
  const viewKey = () => (views().length && score.views.key ? score.views.key.toLowerCase() : null);
  const viewTip = () => {
    if (!viewKey()) return "";
    const what = views().length === 1 ? views()[0].name : `one ${score.views.legend.toLowerCase()}`;
    return `Press ${viewKey().toUpperCase()} to hear ${what} instead. `;
  };
  const renderViews = () => {
    const opts = views();
    $("view-field").hidden = !opts.length;
    $("view-options").innerHTML = "";
    if (!opts.length) return;
    $("view-legend").textContent = score.views.legend;
    const key = viewKey() ? ` In the player, ${viewKey().toUpperCase()} moves to the next one.` : "";
    $("view-hint").textContent = (opts.length === 1
      ? `${opts[0].name} play one after another, each in its own window, each with its own instrument. Or choose one below.`
      : `Hear the track inside one ${score.views.legend.toLowerCase()} instead of the whole map. The notes stretch to fit it.`) + key;
    for (const o of [{ id: "whole", name: "Whole map" }, ...opts]) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio"; input.name = "view"; input.value = o.id; input.id = `view-${o.id}`;
      input.checked = (son.view?.id ?? "whole") === o.id;
      if (viewKey()) input.setAttribute("aria-keyshortcuts", viewKey().toUpperCase());
      label.append(input, o.name);
      $("view-options").append(label);
    }
  };
  // "Ukraine, change from 2012 to 2023", "India: 12 maps, 2012 to 2023", "NASA's stories: 6 stories, …"
  const viewText = () => {
    const name = viewName();
    if (unit() === "story") return `${name}: ${n()} stories, one after another. First: ${whenOf(0)}`;
    // Night lights: the years, then the decade (its last map), said as such.
    if (n() > 1 && son.isDecade(n() - 1)) return `${name}: ${n() - 1} years, ${whenOf(0)} to ${whenOf(n() - 2)}, then the decade`;
    return n() > 1 ? `${name}: ${n()} maps, ${whenOf(0)} to ${whenOf(n() - 1)}` : `${name}, ${lowerFirst(whenOf(0))}`;
  };
  const setView = (id, { quiet = false } = {}) => {
    if (!son || !views().length) return;
    if (playing) { playing = false; setPlayButton(); }
    son.setView(id && id !== "whole" ? id : null);
    const r = $(`view-${son.view?.id ?? "whole"}`);
    if (r) r.checked = true;
    $("map").max = n() - 1;
    $("map-field").hidden = n() < 2;
    $("prev").disabled = $("next").disabled = n() < 2;
    son.started = false;
    lastNote = null;
    renderDecadeButton();
    showFrame(0);
    idle();
    if (!quiet) say(`${viewText()}. About ${Math.round(son.passSeconds())} seconds. Press Space to play.`);
  };

  // ---------- NASA's stories: one button each, and the flat map of every window ----------
  const storyOption = () => views().find((o) => o.unit === "story") ?? null;
  const layerOf = (id) => layers().find((L) => L.id === id);
  const renderStories = () => {
    const opt = storyOption();
    $("story-list").hidden = !opt;
    $("story-buttons").innerHTML = "";
    if (!opt) return;
    $("story-list-h").textContent = `${opt.name}: choose one to hear it now`;
    opt.frames.forEach((f, i) => {
      const L = layerOf(f.focus);
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn story-btn"; b.id = `story-${i + 1}`; b.dataset.story = i;
      b.setAttribute("aria-pressed", "false");
      if (L?.colour) b.style.setProperty("--c", L.colour);
      b.innerHTML = '<span class="swatch" aria-hidden="true"></span><span><span class="name"></span><span class="sr-only">, </span><span class="aero"></span></span>';
      b.querySelector(".name").textContent = f.when;
      b.querySelector(".aero").textContent = L ? L.name.toLowerCase() : "";
      b.addEventListener("click", () => run(null, () => playStory(i)));
      $("story-buttons").append(b);
    });
  };
  // Play one story now: switch to the stories if need be, go to it, and play (or keep playing).
  const playStory = (i) => {
    const opt = storyOption();
    if (!opt || !son) return;
    if (son.view?.id !== opt.id) setView(opt.id, { quiet: true });
    if (playing) { goTo(i, false); say(`Playing ${startText(i)}`); return; }
    goTo(i, false);
    play();
  };

  // The flat map: every window of the track's regions or stories, the one heard lit.
  const viewBoxes = () => {
    const opt = storyOption();
    if (opt) return opt.frames.map((f, i) => ({ box: f.box, colour: layerOf(f.focus)?.colour, label: f.when, story: i }));
    return views().map((o) => ({ box: o.frames[0].box, colour: null, label: o.name, id: o.id }));
  };
  const pct = (box) => ({ left: ((box[0] + 180) / 360) * 100, top: ((90 - box[3]) / 180) * 100, width: ((box[2] - box[0]) / 360) * 100, height: ((box[3] - box[1]) / 180) * 100 });
  const renderViewMap = () => {
    // Every track drawn on a flat world map gets it beside the globe (not NASA's videos: no flat map).
    $("view-map").hidden = usesVideo();
    $("view-map-boxes").innerHTML = "";
    if (usesVideo() || !views().length) return;
    for (const v of viewBoxes()) {
      const p = pct(v.box), el = document.createElement("span");
      el.className = "view-box";
      Object.assign(el.style, { left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%` });
      if (v.colour) el.style.setProperty("--c", v.colour);
      el.dataset.label = v.label;
      $("view-map-boxes").append(el);
    }
  };
  const showViewMap = (i) => {
    // Night lights' change map is NASA's own flat EIC picture, heard as the decade: the flat map alone.
    const decade = !$("view-map").hidden && !!son?.isDecade(i);
    $("stage").hidden = decade;
    if ($("view-map").hidden) return;
    $("view-map-boxes").hidden = decade;
    const f = frames()[i], box = son?.boxOf(i);
    const src = imageOf(i);
    if (!$("view-map-img").src.endsWith(src)) $("view-map-img").src = src;
    for (const el of $("view-map-boxes").children) el.classList.toggle("is-on", !!box && el.dataset.label === (unit() === "story" ? f.when : son.view?.name));
    const L = unit() === "story" ? layerOf(f.focus) : null;
    $("view-map-caption").innerHTML = "";
    if (L?.colour) { const s = document.createElement("span"); s.className = "swatch"; s.style.setProperty("--c", L.colour); $("view-map-caption").append(s); }
    $("view-map-caption").append(son?.view ? (unit() === "story" ? f.when : son.view.name) : views().length ? "Whole map" : f.when);
    const small = document.createElement("small");
    small.id = "view-map-note";
    small.textContent = decade ? "The decade: one note per year, then the change"
      : son?.view ? (L ? `${L.name.toLowerCase()}, ${unit()} ${i + 1} of ${n()}` : f.when)
        : views().length ? `${viewBoxes().length} ${storyOption() ? "stories" : "regions"}: press ${viewKey()?.toUpperCase() ?? "a button"} to choose` : "Flat map";
    $("view-map-caption").append(small);
    for (const b of $("story-buttons").children) b.setAttribute("aria-pressed", String(unit() === "story" && Number(b.dataset.story) === i));
    moveNeedle();
    drawDecade();
  };
  // The scan line on the flat map: inside the window heard, or from top to bottom on the whole map.
  const moveNeedle = () => {
    const needle = $("view-map-needle");
    if (!son || $("view-map").hidden || son.isDecade() || (!playing && !son.started && son.progress() === 0)) { needle.hidden = true; return; }
    const d = son.info?.decade;
    if (playing && d && son.isDecade()) return;
    if (son.scan === "south") {
      const lat = son.headLat(true);
      Object.assign(needle.style, { left: "0%", width: "100%", height: "2px", top: `${((90 - lat) / 180) * 100}%`, marginLeft: "0" });
    } else {
      const lon = son.headLon(true), p = pct(son.boxOf(son.index) ?? [-180, -90, 180, 90]);
      Object.assign(needle.style, { left: `${((lon + 180) / 360) * 100}%`, top: `${p.top}%`, height: `${p.height}%`, width: "", marginLeft: "" });
    }
    needle.hidden = false;
  };
  $("view-options").addEventListener("change", (e) => { if (e.target.name === "view") setView(e.target.value); });
  const nextView = () => {
    const ids = ["whole", ...views().map((o) => o.id)];
    setView(ids[(ids.indexOf(son.view?.id ?? "whole") + 1) % ids.length]);
  };

  // ---------- Listen to: all layers, or one alone (aerosols) ----------
  // Native radios in a fieldset, built from the score's layers; each also has a letter in the player.
  const renderListen = () => {
    const L = layers();
    $("listen-field").hidden = !L.length;
    $("listen-options").innerHTML = "";
    for (const o of L.length ? [{ id: "", name: "All", key: "A" }, ...L] : []) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio"; input.name = "listen"; input.value = o.id;
      input.id = `listen-${o.id || "all"}`;
      input.checked = (son.solo ?? "") === o.id;
      input.setAttribute("aria-keyshortcuts", o.key.toUpperCase());
      const key = document.createElement("span");
      key.className = "key-hint"; key.setAttribute("aria-hidden", "true"); key.textContent = o.key.toUpperCase();
      label.append(input, o.name, key);
      $("listen-options").append(label);
    }
  };
  const setListen = (id) => {
    if (!son || !layers().length) return;
    son.setSolo(id || null);
    const r = $(`listen-${son.solo || "all"}`);
    if (r) r.checked = true;
    showFrame(son.index);                 // the globe shows the layer heard alone
    say(`${listenText()}.${playing ? "" : " Press Space to play."}`);
  };
  $("listen-options").addEventListener("change", (e) => { if (e.target.name === "listen") setListen(e.target.value); });
  // Letter -> layer id ("" for all), for the track playing now.
  const listenKeys = () => new Map(layers().length ? [["a", ""], ...layers().map((L) => [L.key.toLowerCase(), L.id])] : []);

  // ---------- Actions ----------
  const play = async () => {
    if (!son || $("play").disabled) return;
    if (playing) {
      son.pause(); playing = false; setPlayButton(); idle();
      say(`Paused at ${whenOf(son.index)}.`);
      return;
    }
    lesson?.stop();   // one thing at a time
    if (!son.ready) say("Loading sounds.");
    playing = true; setPlayButton();
    son.started = false;
    const me = son;
    const ok = await son.play();
    if (me !== son) return;
    if (!ok) {
      playing = false; setPlayButton();
      showError("Sound could not start in this browser. Try a recent Chrome, Edge, Firefox or Safari, and check the volume.", false);
      say("Sound could not start.");
      return;
    }
    say(`Playing ${startText(son.index)}`);
    requestAnimationFrame(tick);
  };

  const goTo = (i, speak = true) => {
    if (!son) return;
    i = clamp(i, 0, n() - 1);
    son.seek(i);
    son.started = false;
    showFrame(i);
    idle();
    if (speak) say(`${mapText(i)}.${playing ? "" : " Press Space to play."}`);
  };
  const step = (d) => {
    if (n() < 2) { say(`${son?.view ? `${son.view.name} has` : "This track has"} only one map. ${viewTip()}`.trim()); return; }
    const i = son.index + d;
    if (i < 0) { say(`Already at the first ${unit()}, ${whenOf(0)}.`); return; }
    if (i >= n()) { say(`Already at the last ${unit()}, ${whenOf(n() - 1)}.`); return; }
    goTo(i);
  };

  const pauseForSpeech = () => {
    if (playing) { son.pause(); playing = false; setPlayButton(); idle(); return "Paused. "; }
    return "";
  };

  const describe = () => {
    if (!son) return;
    const pre = pauseForSpeech();
    say(`${pre}${son.describeText?.() ?? son.frame().text} Press Space to play.`);
  };

  // Lightning: play each part itself, or what changed since the part before.
  const setCompare = (on) => {
    if (!son?.canCompare) { say("Compare with previous part is only for the Lightning track."); return; }
    $("compare").checked = on;
    son.setCompare(on);
    const i = son.index;
    showFrame(i);
    const next = playing ? "" : " Press Space to play.";
    if (!on) { say(`Compare off. Each sweep plays the lightning in the part itself. ${mapText(i)}.${next}`); return; }
    const what = "Compare with previous part on. Each sweep now plays what changed since the part before: "
      + "short rising notes where there is more lightning, falling notes where there is less, quiet where it stayed the same.";
    say(i === 0
      ? `${what} ${score.frames[0].when} is the first part, so there is nothing to compare it with: playing starts with ${whenOf(1)}.${next}`
      : `${what} ${mapText(i)}.${next}`);
  };
  $("compare").addEventListener("change", (e) => setCompare(e.target.checked));

  // What is under the scan line now, for a track with layers: "dust, strong, around 20 degrees north; …"
  const strength = (rel) => (rel >= 0.6 ? "strong" : rel >= 0.25 ? "moderate" : "faint");
  const underText = () => {
    const winds = (son.windsNow() ?? []).filter((w) => w.level > 0 && (!son.solo || w.id === son.solo)).sort((a, b) => b.open - a.open);
    if (!winds.length) return son.solo ? ` No ${layerName(son.solo).toLowerCase()} under it.` : ` No ${score.words.what} under it.`;
    return ` Under it: ${winds.map((w) => `${layerName(w.id).toLowerCase()}, ${strength(w.open)}, mostly ${Math.abs(w.lat) < 0.5 ? "at the equator" : `around ${latWords(w.lat)}`}`).join("; ")}.`;
  };

  const whereText = () => {
    if (!son) return "The player is still loading.";
    const i = son.index;
    let s = `You are in the player. Track ${pos()} of ${tracks.length}, ${track.title}. `
      + (son.view ? `${score.views.legend}: ${son.view.name}. ` : "") + `${mapText(i)}. `;
    // How far across: the map, or the region or story window heard now.
    const across = son.view ? (unit() === "story" ? " this story's window" : ` ${son.view.name}`) : "";
    // Sea heat: a level line moving south; what is under it is the water's temperature.
    if (sideways()) {
      const sea = son.seaNow();
      const at = `The scan line is at ${latWords(sea.lat)}, ${Math.round(son.progress() * 100)} percent of the way down from the Arctic.`;
      let under;
      if (!sea.share || Number.isNaN(sea.temp)) under = " Under it: only land or ice, so the chord is almost silent.";
      else {
        const w = sea.warmest;
        const ear = $("mono").checked ? "" : `, ${w.x < -0.33 ? "in your left ear" : w.x > 0.33 ? "in your right ear" : "in the centre"}`;
        const voices = son.mapping.chordFor(son.track, sea.temp, sea.share).levels.filter((l) => l > 0.02).length || null;
        under = ` Under it, ${Math.round(sea.share * 100)} percent of the line is sea, at ${Math.round(sea.temp)} degrees Celsius on average`
          + (voices ? `: ${voices === 1 ? "the deep base note alone" : `${voices} chord voices`}.` : ".")
          + ` The warmest water on the line is ${Math.round(w.temp)} degrees, at ${lonWords(w.lon)}${ear}.`;
      }
      return `${s}${playing ? "Playing. " : "Paused. "}${at}${under}${playing ? "" : " Press Space to play."} West is your left ear, east your right. Press H for keys.`;
    }
    if (layers().length) {
      s += `Listening to ${son.solo ? `${layerName(son.solo).toLowerCase()} only` : allText()}. `;
      const at = `The scan line is at ${lonWords(son.headLon(true))}, ${Math.round(son.progress() * 100)} percent of the way across${across}.`;
      return `${s}${playing ? `Playing. ${at}` : `Paused. ${at}`}${underText()}${playing ? "" : " Press Space to play."} Press H for keys.`;
    }
    if (playing) {
      if (son.isDecade() && son.info?.decade) {
        s += `Playing the decade, one note per year. ${decadeText(son.info.decade)}.`;
      } else {
        s += `Playing. The scan line is at ${lonWords(son.headLon())}, ${Math.round(son.progress() * 100)} percent of the way across${across}.`;
        if (son.info?.change !== undefined) {
          const c = son.info.change;
          s += c > 0.05 ? " Under it: more lightning than in the previous part." : c < -0.05 ? " Under it: less lightning than in the previous part." : " Under it: about the same as the previous part.";
        } else if (son.info) s += son.info.light > 0.05 ? ` Under it: ${Math.round(son.info.light * 100)} percent of the loudest ${son.bedWord}.` : " It is crossing a quiet stretch.";
        if (lastNote && performance.now() - lastNote.at < 4000) s += ` The last note was ${noteName(lastNote.midi)}, ${hertz(lastNote.midi)} hertz, at ${latWords(lastNote.lat)}, ${earOf(lastNote.pos)}.`;
      }
    } else {
      s += "Paused. Press Space to play.";
    }
    return `${s} Press H for keys.`;
  };

  // The keys; on a track with layers, also the letter of each layer.
  const helpText = () => "Player keys. Space: play or pause. Left and Right arrows: previous or next map. Home and End: first or last map. "
    + `W: where am I. D: describe this map. S: what the sounds mean. 1 to ${tracks.length}: choose a track. M: mono on or off. `
    + "C: on the Lightning track, compare each part with the previous part, or go back to the part itself. "
    + (layers().length ? `A: ${allText()}. ${layers().map((L) => `${L.key.toUpperCase()}: ${L.name.toLowerCase()} only.`).join(" ")} ` : "")
    + (viewKey() ? `${viewKey().toUpperCase()}: ${score.views.legend.toLowerCase()}: ${orList(["whole map", ...views().map((o) => o.name)])}, in turn. ` : "")
    + sidewaysTip()
    + (lesson ? "L: go to the guided lesson. " : "")
    + "Escape: stop. Tab moves to the buttons. Below the player: examples of each sound, places to explore, and settings.";

  const soundsText = () => {
    const pre = pauseForSpeech();
    return `${pre}${sweepMod.keyText(score)}`;
  };

  const stopAll = () => {
    showing = false;
    if (son) { if (playing) { son.pause(); playing = false; setPlayButton(); idle(); } son.hush(); }
    lesson?.stop();
    clearTimeout(demoTimer);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    say("Stopped.");
  };

  // Every key and player button confirms itself: a soft click (a low one when nothing is there),
  // and, if "Name each key I press" is on, its name before the answer: "Next map. 2014, map 3 of 12."
  const atEdge = (d) => !son || n() < 2 || son.index + d < 0 || son.index + d >= n();
  const run = (name, fn, edge = false) => {
    if ($("clicks").checked) son?.earcon(edge ? "edge" : "ok");
    echo = $("keyecho").checked ? name : null;
    fn();
    echo = null;
  };
  $("play").addEventListener("click", () => run(null, play));
  $("prev").addEventListener("click", () => run("Previous map", () => step(-1), atEdge(-1)));
  $("next").addEventListener("click", () => run("Next map", () => step(1), atEdge(1)));
  $("map").addEventListener("input", (e) => goTo(Number(e.target.value), false));
  $("map").addEventListener("change", (e) => say(`${mapText(Number(e.target.value))}.`));
  $("describe").addEventListener("click", () => run("Describe", describe));
  $("where").addEventListener("click", () => run(null, () => say(whereText())));
  $("help").addEventListener("click", () => run(null, () => say(helpText())));

  document.querySelector("#track-list").addEventListener("change", (e) => {
    if (e.target.name === "track") loadTrack(tracks.find((t) => t.id === e.target.value));
  });

  // ---------- Keys: only inside the player ----------
  // The keyboard area is role="application", so NVDA and JAWS pass keys straight to it.
  // Space stays native on buttons; sliders keep their own arrow keys.
  $("player").addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Form controls keep their own keys. On a radio or checkbox (they take no letters), the
    // layer letters still work, so "Listen to" can be changed by letter from inside the group.
    const field = t.closest("input, select, textarea");
    if (field && !((field.type === "radio" || field.type === "checkbox") && (listenKeys().has(k) || k === viewKey()))) return;
    const onButton = t.closest("button, a");
    const act = (fn, name = null, edge = false) => { e.preventDefault(); run(name, fn, edge); };
    if (listenKeys().has(k)) { act(() => setListen(listenKeys().get(k))); return; }
    if (k === viewKey()) { act(nextView, score.views.legend); return; }
    switch (k) {
      case " ": case "Enter": if (!onButton) act(play); break;
      case "k": act(play); break;
      case "ArrowLeft": act(() => step(-1), "Previous map", atEdge(-1)); break;
      case "ArrowRight": act(() => step(1), "Next map", atEdge(1)); break;
      case "Home": act(() => goTo(0), "First map"); break;
      case "End": act(() => goTo(n() - 1), "Last map"); break;
      case "w": act(() => say(whereText())); break;
      case "d": act(describe, "Describe"); break;
      case "h": case "?": act(() => say(helpText())); break;
      case "s": act(() => say(soundsText()), "What the sounds mean"); break;
      case "m": act(() => { $("mono").click(); say(`Mono ${$("mono").checked ? "on" : "off"}.`); }); break;
      case "c": act(() => setCompare(!$("compare").checked)); break;
      case "l": act(() => {
        if (!lesson) { say(`Track ${pos()}, ${track.title}, has no guided lesson.`); return; }
        $("lesson-keys").focus();
        lesson.where();
      }, "Lesson"); break;
      default:
        // A letter or digit with no job: say so, so a key press is never met with silence.
        if (t === $("keys") && k.length === 1 && !(/^[1-9]$/.test(k) && tracks[Number(k) - 1])) {
          act(() => say(`${/[a-z]/.test(k) ? k.toUpperCase() : k === " " ? "Space" : k} does nothing here. Press H to hear the keys.`), null, true);
          break;
        }
        if (/^[1-9]$/.test(k) && tracks[Number(k) - 1]) {
          act(() => {
            const r = $(`track-${tracks[Number(k) - 1].id}`);
            if (r.checked) { say(`Track ${k}, ${track.title}, is already chosen.`); return; }
            r.checked = true;
            loadTrack(tracks[Number(k) - 1]);
          });
        }
    }
  });
  // Escape stops sound and speech anywhere (it is not a character key, so it cannot clash).
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { showing = false; closeGuide(false); stopAll(); } });
  $("keys").addEventListener("click", () => $("keys").focus());

  // ---------- What the sounds mean, and examples ----------
  let demoTimer;
  const renderSounds = () => {
    const L = score.legend;
    $("sounds-summary").textContent = `${L.summary.trim()} ${L.method.trim()}`;
    $("legend").innerHTML = "";
    for (const item of L.items) {
      const li = document.createElement("li");
      const b = document.createElement("b"); b.textContent = item.sound;
      const sep = document.createElement("span"); sep.className = "sr-only"; sep.textContent = ": ";
      li.append(b, sep, item.meaning);
      $("legend").append(li);
    }
    $("caveat").textContent = L.caveat.trim();
    $("demos").innerHTML = "";
    for (const d of son.demos()) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn"; b.dataset.demo = d.id;
      b.innerHTML = '<b></b><span class="sr-only">: </span><span class="hint"></span>';
      b.querySelector("b").textContent = d.label;
      b.querySelector(".hint").textContent = d.hint;
      b.addEventListener("click", async () => {
        pauseForSpeech();
        clearTimeout(demoTimer);
        const secs = await son.demo(d.id);
        demoTimer = setTimeout(() => say(d.text), secs * 1000);
      });
      $("demos").append(b);
    }
  };

  // ---------- About this track ----------
  const renderAbout = () => {
    const a = score.about;
    $("about-sound").hidden = !a;
    $("about-sound").open = false;
    $("about-list").innerHTML = "";
    $("about-chain").innerHTML = "";
    if (!a) return;
    for (const [k, label] of [["what", "What"], ["who", "Who"], ["when", "When"], ["where", "Where"], ["why", "Why"], ["how", "How"]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = a[k];
      $("about-list").append(dt, dd);
    }
    for (const j of a.journey) {
      const li = document.createElement("li"), b = document.createElement("b");
      b.textContent = j.title;
      li.append(b, ` ${j.detail}`);
      $("about-chain").append(li);
    }
  };

  // ---------- The numbers, as a CSV file ----------
  $("csv").addEventListener("click", () => {
    if (!score) return;
    const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
    const L = layers(), rows = [
      `# ${track.title}: ${track.source.title} (${track.source.url})`,
      `# Units: ${score.units}. Range: ${score.range[0]} to ${score.range[1]}. Credit: ${track.source.credit}.`,
      "# Each row is one 10 degree square (its centre) of one map, the same numbers Describe and Explore one place use; the sound plays a finer 3 degree grid. Empty = no reading.",
      ["map", "latitude", "longitude", "value", ...L.map((x) => x.id)].join(","),
    ];
    score.frames.forEach((f) => f.grid.forEach((row, r) => row.forEach((v, c) => {
      if (v === null && !L.some((x) => f.layers?.[x.id]?.[r]?.[c] != null)) return;
      rows.push([q(f.when), 90 - (r + 0.5) * 10, score.leftLon + (c + 0.5) * 10, v ?? "", ...L.map((x) => f.layers?.[x.id]?.[r]?.[c] ?? "")].join(","));
    })));
    run("Save the numbers", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
      a.download = `earth-jukebox-${track.id}.csv`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say(`Saved ${a.download} to your downloads: ${rows.length - 4} rows.`);
    });
  });

  // ---------- Mystery place ----------
  // The decade of one region, played with no name; then the listener guesses. Only where the track has
  // regions whose last map is the decade (Earth at night).
  let mystery = null;
  const mysteryRegions = () => (son && son.whole.chapters.some((c) => c.frames.some((f) => f.decade)) ? views() : []);
  const renderMystery = () => {
    const opts = mysteryRegions();
    $("mystery").hidden = !opts.length;
    $("mystery-guess").hidden = true;
    $("mystery-result").textContent = "";
    mystery = null;
    $("mystery-options").innerHTML = "";
    for (const o of opts) {
      const label = document.createElement("label"), input = document.createElement("input");
      input.type = "radio"; input.name = "mystery"; input.value = o.id; input.id = `mystery-${o.id}`;
      label.append(input, o.name);
      $("mystery-options").append(label);
    }
  };
  const playMystery = async (again = false) => {
    const opts = mysteryRegions();
    if (!opts.length || !son) return;
    pauseForSpeech();
    if (!again) {
      const rest = opts.filter((o) => o.id !== mystery);
      mystery = rest[Math.floor(Math.random() * rest.length)].id;
      for (const r of $("mystery-options").querySelectorAll("input")) r.checked = false;
      $("mystery-result").textContent = "";
    }
    $("mystery-guess").hidden = false;
    // Said first, in the same breath as the key's name; the sound follows.
    say(again ? "Playing it again. Which place was it?" : `A mystery place: twelve notes, one for each year from 2012 to 2023, then what NASA's change map shows. Which place was it? Choose one of ${opts.length}.`);
    return son.mysteryDecade(mystery);
  };
  $("mystery-play").addEventListener("click", () => run("Play a mystery place", () => playMystery(false)));
  $("mystery-again").addEventListener("click", () => run("Hear it again", () => playMystery(true)));
  $("mystery-options").addEventListener("change", (e) => {
    if (e.target.name !== "mystery" || !mystery) return;
    const o = views().find((x) => x.id === mystery), last = o.frames[o.frames.length - 1];
    const right = e.target.value === mystery;
    $("mystery-result").textContent = `${right ? "Yes!" : `Not quite: you chose ${views().find((x) => x.id === e.target.value).name}.`} It was ${o.name}. ${last.text.replace(`${last.when}. ${o.name}. `, "")}`;
    say($("mystery-result").textContent);
  });

  // ---------- Guide me: the page, one part at a time ----------
  // A ring on the real part and its explanation in the guide panel and the live region. It never plays
  // sound and never moves focus on its own: focus goes into the panel when the listener opens it.
  const GUIDE = [
    ["#tracks", "Choose a track here with the arrow keys. Inside the player, the number keys 1 to 7 choose a track too."],
    ["#lesson", "This track starts with a guided lesson: one idea at a time, at your own pace. Tab reaches its keyboard area; T goes on to the player."],
    ["#keys", "This is the keyboard area. Press Tab to reach it. Inside it single keys work: Space plays or pauses, W says where you are, D describes the map, H lists every key."],
    ["#play", "Play or pause. No sound starts until you press this, or Space."],
    ["#view-field", "This track has more than one way to listen: its regions, or NASA's stories. R moves to the next one."],
    ["#listen-field", "Hear each part of the picture alone, or all together. Each has its own letter."],
    ["#where", "Where am I, Describe this map and Keys answer out loud. Each also has a key: W, D and H."],
    ["#sounds", "What the sounds mean. Each sound has an example button that plays it, then explains it."],
    ["#about-sound", "About this track: what it is, who made it and where it comes from."],
    ["#explore", "Explore one place: choose a city, or move the two sliders, to hear one square of the map."],
    ["#settings", "Settings: volume, speed, mono, and what is said or clicked when you press keys."],
  ];
  let guideSteps = [], guideAt = 0;
  const guideShow = (i) => {
    document.querySelector(".guide-ring")?.classList.remove("guide-ring");
    guideAt = clamp(i, 0, guideSteps.length - 1);
    const [sel, text] = guideSteps[guideAt], el = document.querySelector(sel);
    el.classList.add("guide-ring");
    el.scrollIntoView({ block: "center", behavior: reduced.matches ? "instant" : "smooth" });
    $("guide-count").textContent = `Step ${guideAt + 1} of ${guideSteps.length}`;
    $("guide-text").textContent = text;
    $("guide-back").disabled = guideAt === 0;
    $("guide-next").textContent = guideAt === guideSteps.length - 1 ? "Finish" : "Next";
    say(`Step ${guideAt + 1} of ${guideSteps.length}. ${text}`);
  };
  const closeGuide = (say_ = true) => {
    if ($("guide").hidden) return;
    document.querySelector(".guide-ring")?.classList.remove("guide-ring");
    $("guide").hidden = true;
    $("guide-start").focus();
    if (say_) say("Guide closed.");
  };
  $("guide-start").addEventListener("click", () => {
    guideSteps = GUIDE.filter(([sel]) => { const el = document.querySelector(sel); return el && el.getClientRects().length; });
    $("guide").hidden = false;
    guideShow(0);
    $("guide-next").focus();
  });
  $("guide-next").addEventListener("click", () => (guideAt === guideSteps.length - 1 ? closeGuide() : guideShow(guideAt + 1)));
  $("guide-back").addEventListener("click", () => guideShow(guideAt - 1));
  $("guide-close").addEventListener("click", () => closeGuide());

  // ---------- Play the whole jukebox ----------
  // About 30 seconds of every track in turn, each named first. Choosing a track, or Escape, ends it.
  const SHOW_SECONDS = 30;
  let showing = false;
  const wait = async (ms) => { const end = performance.now() + ms; while (showing && performance.now() < end) await new Promise((r) => setTimeout(r, 200)); };
  $("show").addEventListener("click", () => run("Play the whole jukebox", async () => {
    if (son && playing) { son.pause(); playing = false; setPlayButton(); }
    showing = true;
    say(`The whole jukebox: about ${SHOW_SECONDS} seconds of every track, ${tracks.length} in all. Escape stops it.`);   // with the key's name, before the async work
    await wait(3500);
    for (let k = 0; k < tracks.length && showing; k++) {
      const t = tracks[k];
      $(`track-${t.id}`).checked = true;
      await loadTrack(t, { announce: false, fromShow: true });
      if (!showing) return;
      say(`Track ${k + 1} of ${tracks.length}, ${t.title}. ${t.subtitle}. NASA's source: ${t.source.title}.`);
      await wait(6000);
      if (!showing) return;
      await play();
      await wait(SHOW_SECONDS * 1000);
      if (!showing) return;
      if (playing) { son.pause(); playing = false; setPlayButton(); idle(); }
    }
    if (showing) { showing = false; say(`That was all ${tracks.length} tracks. Choose any track to hear it in full.`); }
  }));

  // ---------- Explore one place ----------
  const PLACES = [
    ["Ulaanbaatar", 106.9, 47.9], ["Tokyo", 139.7, 35.7], ["Delhi", 77.2, 28.6], ["Lagos", 3.4, 6.5],
    ["Kinshasa", 15.3, -4.3], ["Cairo", 31.2, 30.0], ["London", -0.1, 51.5], ["New York", -74.0, 40.7],
    ["Mexico City", -99.1, 19.4], ["São Paulo", -46.6, -23.5], ["Jakarta", 106.8, -6.2], ["Sydney", 151.2, -33.9],
  ];
  $("places").innerHTML = PLACES.map(([name, lon, lat]) =>
    `<button type="button" class="btn" data-lon="${lon}" data-lat="${lat}">${name}</button>`).join("");
  $("places").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) pickSpot({ lon: Number(b.dataset.lon), lat: Number(b.dataset.lat) }, b.textContent);
  });
  const lonOf = (c) => wrapLon(-180 + (c + 0.5) * 10);
  const latOf = (r) => 90 - (r + 0.5) * 10;
  const cellText = (c, r) => `${lonWords(lonOf(c))}, ${latWords(latOf(r))}`;
  const setSliderText = () => {
    $("lon").setAttribute("aria-valuetext", lonWords(lonOf(Number($("lon").value))));
    $("lat").setAttribute("aria-valuetext", latWords(latOf(Number($("lat").value))));
  };
  setSliderText();
  const probe = async (name = "") => {
    if (!son) return;
    const c = Number($("lon").value), r = Number($("lat").value);
    if (globe && !usesVideo()) { globe.cell = [c, r]; globe.lookAt(lonOf(c), clamp(latOf(r), -50, 50)); }
    pauseForSpeech();
    const value = await son.probe(c, r);
    window.lastProbe = value;
    const near = !name && score.places?.[`${r},${c}`];
    // One spot is always read on the whole map the current map comes from (a story's: the whole still).
    const mapWhen = unit() === "story" ? score.frames[frames()[son.index].base ?? 0].when : whenOf(son.index);
    if (value) say(`${name ? `${name}. ` : near ? `Near ${near}. ` : ""}${mapWhen}, ${cellText(c, r)}: ${value}`);
  };
  const pickSpot = ({ lon, lat }, name = "") => {
    $("lon").value = clamp(Math.floor((wrapLon(lon) + 180) / 10), 0, 35);
    $("lat").value = clamp(Math.floor((90 - lat) / 10), 0, 17);
    setSliderText();
    probe(name);
  };
  for (const id of ["lon", "lat"]) $(id).addEventListener("input", () => { setSliderText(); probe(); });

  // ---------- Settings ----------
  $("volume").addEventListener("input", (e) => {
    settings.volume = Number(e.target.value);
    e.target.setAttribute("aria-valuetext", volText());
    store.set("volume", settings.volume);
    son?.setVolume(settings.volume);
  });
  document.querySelectorAll('input[name="speed"]').forEach((r) => r.addEventListener("change", (e) => {
    settings.bpm = Number(e.target.value);
    store.set("bpm", settings.bpm);
    son?.setTempo(settings.bpm);
  }));
  $("mono").addEventListener("change", (e) => { settings.mono = e.target.checked; store.set("mono", settings.mono); son?.setMono(settings.mono); });
  $("continuous").addEventListener("change", (e) => { settings.continuous = e.target.checked; store.set("continuous", settings.continuous); son?.setContinuous(settings.continuous); });
  $("announce").addEventListener("change", (e) => store.set("announce", e.target.checked));
  // Narration (Read aloud): the lesson's switch is the same setting as the one in Settings.
  $("lesson-speak").checked = $("speak").checked;
  $("lesson-speak").addEventListener("change", (e) => { $("speak").checked = e.target.checked; $("speak").dispatchEvent(new Event("change")); });
  $("speak").addEventListener("change", (e) => { $("lesson-speak").checked = e.target.checked; });
  for (const [id, key, unit] of [["voice-vol", "vol", "percent"], ["voice-rate", "rate", "percent of normal speed"]]) {
    const el = $(id);
    el.value = voice[key];
    el.setAttribute("aria-valuetext", `${el.value} ${unit}`);
    el.addEventListener("input", () => {
      voice[key] = Number(el.value);
      store.set(key === "vol" ? "voiceVol" : "voiceRate", voice[key]);
      el.setAttribute("aria-valuetext", `${el.value} ${unit}`);
    });
  }
  $("speak").addEventListener("change", (e) => {
    store.set("speak", e.target.checked);
    if (!e.target.checked && "speechSynthesis" in window) speechSynthesis.cancel();
  });
  $("save").addEventListener("click", async () => {
    if (!son) return;
    const btn = $("save");
    pauseForSpeech();
    btn.disabled = true;
    const seconds = Math.min(180, son.passSeconds());
    const name = `earth-jukebox-${track.id}${son.view ? `-${son.view.id}` : ""}.wav`;
    say(`Making the audio file: ${Math.round(seconds)} seconds of sound. This takes a few seconds.`);
    try {
      const url = URL.createObjectURL(EJ.toWav(await son.renderOffline(seconds)));
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say(`Saved ${name} to your downloads.`);
    } catch (err) {
      say(`Could not make the audio file: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  await loadTrack(tracks[0], { announce: false });
  say(`Ready. ${tracks.length} tracks. Track 1, ${tracks[0].title}, is chosen. Press Tab to reach the player, then Space to play.`);
})();
