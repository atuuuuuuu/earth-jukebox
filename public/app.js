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
      u.rate = 1;
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
  const sentences = (t) => t.split(/(?<=\.)\s+(?=[A-Z])/);
  const earOf = (pos) => ($("mono").checked || Math.abs(pos) < 0.33 ? "in the centre" : pos < 0 ? "in your left ear" : "in your right ear");

  // ---------- Settings, remembered on this device ----------
  const settings = {
    volume: store.get("volume", 80), bpm: store.get("bpm", 84), mono: store.get("mono", false),
  };
  $("volume").value = settings.volume;
  $("mono").checked = settings.mono;
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
  const usesVideo = () => !!score?.frames && ["co2", "ocean"].includes(score.sweep.mapping);
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
    const here = son.placeNow();
    if (here) $("stage-when").textContent = `${son.frame().when} · ${here.date}`;
    syncVideo();
    moveNeedle();
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
    buzz(Math.round(12 + 30 * (note.velocity ?? 0.5)));
    if (globe && !usesVideo()) globe.ping(note.lon, note.lat, note.kind === "gain" ? 1 : note.kind === "loss" ? 2 : 0);
  };
  const onEnd = () => {
    playing = false; setPlayButton(); idle();
    say(`End of track ${pos()}, ${track.title}. Press Space in the player to play it again, or choose another track.`);
  };
  const idle = () => {
    $("stage-fill").style.width = son ? `${son.progress() * 100}%` : "0";
    syncVideo();
    moveNeedle();
  };

  const loadTrack = async (t, { announce = true } = {}) => {
    const mine = ++gen;
    if (son) { son.dispose(); son = null; }
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
      globe.full = true;
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
      say(`Track ${pos()} of ${tracks.length}, ${t.title}. ${n()} ${n() === 1 ? "map" : "maps"}, about ${Math.round(son.passSeconds())} seconds. ${choose}${viewTip()}${sidewaysTip()}`
        + (document.activeElement?.closest?.("#player") ? "Press Space to play." : "Press Tab to reach the player, then Space to play."));
    }
  };
  const orList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
  // A line moving south (sea heat) turns the ears round: say so whenever the track comes up.
  const sideways = () => son?.scan === "south";
  const sidewaysTip = () => (sideways() ? "On this track the scan line moves from north to south, so west is your left ear and east your right ear. " : "");
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
    const has = views().length > 0 && !usesVideo();
    $("view-map").hidden = !has;
    $("view-map-boxes").innerHTML = "";
    if (!has) return;
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
    if ($("view-map").hidden) return;
    const f = frames()[i], box = son?.boxOf(i);
    const src = imageOf(i);
    if (!$("view-map-img").src.endsWith(src)) $("view-map-img").src = src;
    for (const el of $("view-map-boxes").children) el.classList.toggle("is-on", !!box && el.dataset.label === (unit() === "story" ? f.when : son.view?.name));
    const L = unit() === "story" ? layerOf(f.focus) : null;
    $("view-map-caption").innerHTML = "";
    if (L?.colour) { const s = document.createElement("span"); s.className = "swatch"; s.style.setProperty("--c", L.colour); $("view-map-caption").append(s); }
    $("view-map-caption").append(son?.view ? (unit() === "story" ? f.when : son.view.name) : "Whole map");
    const small = document.createElement("small");
    small.textContent = son?.view ? (L ? `${L.name.toLowerCase()}, ${unit()} ${i + 1} of ${n()}` : f.when) : `${viewBoxes().length} ${unit() === "story" || storyOption() ? "stories" : "regions"}: press ${viewKey()?.toUpperCase() ?? "a button"} to choose`;
    $("view-map-caption").append(small);
    for (const b of $("story-buttons").children) b.setAttribute("aria-pressed", String(unit() === "story" && Number(b.dataset.story) === i));
    moveNeedle();
  };
  // The scan line on the flat map: inside the window heard, or from top to bottom on the whole map.
  const moveNeedle = () => {
    const needle = $("view-map-needle");
    const lon = son?.headLon?.(true);
    if ($("view-map").hidden || lon === null || lon === undefined || son?.scan === "south" || (!playing && !son.started && son.progress() === 0)) { needle.hidden = true; return; }
    const box = son.boxOf(son.index) ?? [-180, -90, 180, 90];
    const p = pct(box);
    Object.assign(needle.style, { left: `${((lon + 180) / 360) * 100}%`, top: `${p.top}%`, height: `${p.height}%` });
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
      const here = son.placeNow?.();
      if (here) {
        s += `Playing. ${here.date}. The camera is over ${here.place}, ${Math.round(son.progress() * 100)} percent of the way through this scene.`;
        if (son.info) s += son.info.light > 0.2 ? ` The swell is at ${Math.round(son.info.light * 100)} percent.` : " The water on the line is calm.";
        if (lastNote && performance.now() - lastNote.at < 4000) {
          const p = lastNote.pos;
          s += ` The last harp note came from the ${p < -0.33 ? "top" : p > 0.33 ? "bottom" : "middle"} of the picture, ${earOf(p)}.`;
        }
      } else {
        s += `Playing. The scan line is at ${lonWords(son.headLon())}, ${Math.round(son.progress() * 100)} percent of the way across${across}.`;
        if (son.info?.change !== undefined) {
          const c = son.info.change;
          s += c > 0.05 ? " Under it: more lightning than in the previous part." : c < -0.05 ? " Under it: less lightning than in the previous part." : " Under it: about the same as the previous part.";
        } else if (son.info) s += son.info.light > 0.05 ? ` Under it: ${Math.round(son.info.light * 100)} percent of the loudest ${son.bedWord}.` : " It is crossing a quiet stretch.";
        if (lastNote && performance.now() - lastNote.at < 4000) s += ` The last note was at ${latWords(lastNote.lat)}, ${earOf(lastNote.pos)}.`;
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
    + "Escape: stop. Tab moves to the buttons. Below the player: examples of each sound, places to explore, and settings.";

  const soundsText = () => {
    const pre = pauseForSpeech();
    return `${pre}${sweepMod.keyText(score)}`;
  };

  const stopAll = () => {
    if (son) { if (playing) { son.pause(); playing = false; setPlayButton(); idle(); } son.hush(); }
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") stopAll(); });
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
  $("announce").addEventListener("change", (e) => store.set("announce", e.target.checked));
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
