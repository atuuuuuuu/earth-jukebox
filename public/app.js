// app.js: the page. Loads the backend API, drives the Sonifier (bundle.js, global EJ) and the globe (globe.js).
(async () => {
  const $ = (id) => document.getElementById(id);
  const live = $("live");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The live region speaks only when the listener acts. Clearing first makes repeats speak again.
  // "Read aloud" also speaks through the device's voice, for listeners without a screen reader.
  let sayTimer;
  const say = (text) => {
    clearTimeout(sayTimer);
    live.textContent = "";
    sayTimer = setTimeout(() => { live.textContent = text; }, 50);
    if ($("speak").checked && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      speechSynthesis.speak(u);
    }
  };

  // Backend API: the track list, then the chosen track's score (see backend/API.md).
  let index;
  try {
    index = await (await fetch("api/tracks.json")).json();
  } catch (e) {
    $("track-list").innerHTML = "";
    say("Could not load the tracks. Open the page through a web server, for example npm run serve, not as a file.");
    throw e;
  }
  const scores = new Map();
  const getScore = async (track) => {
    if (!scores.has(track.id)) scores.set(track.id, fetch(track.score).then((r) => r.json()));
    return scores.get(track.id);
  };

  $("sample-note").hidden = !index.sample;
  const totalFrames = index.tracks.reduce((n, t) => n + (t.frames || 0), 0);
  $("chip-frames").textContent = index.sample ? "sample only" : `${totalFrames} NASA maps`;

  // Footer credits: one line per distinct source.
  const credits = $("credits");
  const seen = new Set();
  for (const t of index.tracks) {
    if (!t.source || seen.has(t.source.url)) continue;
    seen.add(t.source.url);
    const line = document.createElement("span");
    const a = document.createElement("a");
    a.href = t.source.url; a.textContent = t.source.title;
    line.append("Source: ", a, `. ${t.source.credit}.`);
    if (credits.childNodes.length) credits.append(document.createElement("br"));
    credits.append(line);
  }

  // Track list, built from the data.
  const list = $("track-list");
  list.innerHTML = "";
  index.tracks.forEach((t, i) => {
    const id = `track-${t.id}`;
    const div = document.createElement("div");
    div.className = "track";
    div.innerHTML = `<input type="radio" name="track"><label><span class="code"></span><span class="title"></span></label><p class="sub"></p>`;
    const input = div.querySelector("input");
    input.id = id; input.value = t.id; input.checked = i === 0;
    input.setAttribute("aria-describedby", `${id}-sub`);
    div.querySelector("label").htmlFor = id;
    div.querySelector(".code").textContent = t.code;
    div.querySelector(".title").textContent = t.title;
    const sub = div.querySelector(".sub");
    sub.id = `${id}-sub`; sub.textContent = t.subtitle;
    list.append(div);
  });

  // Player state. Settings live here so they survive track changes and Strict toggles.
  const settings = { mapping: "scan", strict: false, bpm: EJ.TEMPO, volume: 100, mono: false, muted: [] };
  let track = index.tracks[0];
  let score = await getScore(track);
  let son = null;
  let playing = false;
  let comparing = false;
  let cmpFrames = 0;
  let gen = 0;

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  // Sign from the rounded value, so -0.04 reads "0.0", never "−0.0".
  const signWith = (minus) => (v, d = 1) => { const r = Number(v.toFixed(d)); return `${r > 0 ? "+" : r < 0 ? minus : ""}${Math.abs(r).toFixed(d)}`; };
  const signed = signWith("−");
  const signedSpeech = (v) => signWith("-")(v, 1);
  const niceDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const leftLon = () => score.leftLon ?? -180;
  const wrapLon = (l) => ((l + 540) % 360) - 180;
  const lonOf = (c) => wrapLon(leftLon() + (Number(c) + 0.5) * 10);
  const latOf = (r) => 90 - (Number(r) + 0.5) * 10;
  const lonText = (c) => { const l = lonOf(c); return `${Math.abs(l)} degrees ${l < 0 ? "west" : "east"}`; };
  const latText = (r) => { const l = latOf(r); return `${Math.abs(l)} degrees ${l < 0 ? "south" : "north"}`; };
  const lonShort = (l) => { l = wrapLon(l); return Math.abs(l) < 0.5 ? "0°" : Math.abs(Math.abs(l) - 180) < 0.5 ? "180°" : `${Math.round(Math.abs(l))}°${l < 0 ? "W" : "E"}`; };
  const stripLon = (s) => leftLon() + (s + 0.5) * 22.5;
  const timeText = (i) => {
    const f = score.frames[i];
    const avg = f.mean === null ? "no data" : `map average ${signedSpeech(f.mean)} ${score.units}`;
    return `${f.date}${f.label ? ` (${f.label})` : ""}, ${avg}. Moment ${i + 1} of ${score.frames.length}`;
  };
  const unitShort = () => (score.units === "degrees C" ? "°C" : score.units);
  const bellOn = (f) => typeof f.nino34Relative === "number" && typeof score.ninoLine === "number" && f.nino34Relative > score.ninoLine;
  const tune = () => ({ ladder: [-1, 2], spreadMax: 3, tenseAt: 0.25, ...score.tuning });

  // The anomaly colour scale, matching the legend bar and the NASA frames.
  const STOPS = ["#0b3d91", "#3d8bff", "#a9d2ff", "#f4ead8", "#ffc28a", "#e0662a", "#8a1f05", "#3d0802"].map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
  const colourFor = (v) => {
    const t = clamp((v - score.range[0]) / (score.range[1] - score.range[0])) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(t)), k = t - i;
    const c = STOPS[i].map((x, j) => Math.round(x + (STOPS[i + 1][j] - x) * k));
    return `rgb(${c.join(",")})`;
  };

  // ---------- The globe ----------
  let globe = null;
  const earthImg = new Image();
  const frameImgs = new Map();
  const loadImg = (src) => {
    if (!frameImgs.has(src)) {
      const im = new Image();
      im.decoding = "async";
      const p = new Promise((res) => { im.onload = () => res(im); im.onerror = () => res(null); });
      im.src = src;
      frameImgs.set(src, p);
    }
    return frameImgs.get(src);
  };
  try {
    globe = new Globe($("globe"), { onPick: (hit) => pickSpot(hit), clock: () => EJ.Tone.getContext().currentTime });
    window.globe = globe;
    earthImg.onload = () => globe.setEarth(earthImg);
    earthImg.src = "textures/blue-marble.jpg";
  } catch (err) {
    // No WebGL: fall back to the flat map, which carries the same information.
    globe = null;
    document.querySelector('input[name="view"][value="flat"]').checked = true;
    document.querySelector('input[name="view"][value="globe"]').disabled = true;
    $("spin").disabled = true; $("follow").disabled = true;
  }
  window.globeReady = !!globe;

  const setView = (v) => {
    $("globe-view").hidden = v !== "globe";
    $("flat-view").hidden = v === "globe";
  };
  setView(globe ? "globe" : "flat");
  document.querySelectorAll('input[name="view"]').forEach((r) => r.addEventListener("change", (e) => setView(e.target.value)));

  const setSpin = (on) => {
    $("spin").setAttribute("aria-pressed", String(on));
    if (!globe) return;
    globe.spin = on;
    if (on) { globe.targetYaw = null; globe.targetTilt = null; globe.idleUntil = 0; }
  };
  setSpin(!reduced.matches);
  $("spin").addEventListener("click", () => setSpin($("spin").getAttribute("aria-pressed") !== "true"));

  // Starfield behind the globe, drawn once.
  (() => {
    const c = document.createElement("canvas"); c.width = c.height = 480;
    const g = c.getContext("2d");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) {
      const r = rnd() < 0.92 ? rnd() * 0.9 + 0.2 : rnd() * 1.4 + 0.8;
      g.fillStyle = `rgba(${200 + rnd() * 55 | 0},${210 + rnd() * 45 | 0},255,${0.25 + rnd() * 0.7})`;
      g.beginPath(); g.arc(rnd() * 480, rnd() * 480, r, 0, Math.PI * 2); g.fill();
    }
    $("globe-view").style.setProperty("--stars", `url(${c.toDataURL()})`);
  })();

  // ---------- Map panel, overlays, melody bars ----------
  const img = $("map-img"), marker = $("marker"), box = $("cursor-box");
  const bars = $("bars");
  for (let s = 0; s < EJ.STEPS; s++) bars.append(document.createElement("span"));
  let lastBar = -1;

  const drawBars = (f) => {
    [...bars.children].forEach((el, s) => {
      const v = f.columns[s];
      el.classList.toggle("land", v === null);
      if (v === null) { el.style.height = ""; el.style.background = ""; return; }
      el.style.height = `${8 + 92 * clamp((v - score.range[0]) / (score.range[1] - score.range[0]))}%`;
      el.style.background = colourFor(v);
    });
  };
  const lightBar = (s) => {
    if (lastBar >= 0 && bars.children[lastBar]) bars.children[lastBar].classList.remove("on");
    lastBar = s;
    if (s >= 0 && bars.children[s]) bars.children[s].classList.add("on");
  };

  let shownIndex = -1;
  const showFrame = (i) => {
    const f = score.frames[i];
    if (img.getAttribute("src") !== f.image) img.src = f.image;
    img.alt = `Sea surface temperature anomaly map, ${f.date}`;
    $("globe").setAttribute("aria-label", `3D globe of the sea surface temperature anomaly map, ${niceDate(f.date)}. Drag to turn, tap to hear one spot.`);
    $("date").textContent = niceDate(f.date);
    const badge = $("badge");
    if (f.label) {
      const then = son && f.label === son.thenLabel;
      badge.hidden = false;
      badge.textContent = `${then ? "Then" : "Now"}: ${f.label}`;
      badge.className = `badge ${then ? "then" : "now"}`;
    } else badge.hidden = true;
    const nino = bellOn(f);
    $("stats").textContent = `${f.mean === null ? "No data" : `Map average ${signed(f.mean)} ${unitShort()}`}. ${Math.round(f.hot * 100)}% of the ocean above the hot line, in ${f.clusters} patches.${nino ? " El Niño bell: on." : ""}`;
    const bell = $("bell");
    bell.textContent = `El Niño bell: ${nino ? "on" : "off"}`;
    bell.classList.toggle("on", nino);
    drawBars(f);
    updateSignal(f, null);
    drawSparkCursor(i);
    if (globe) loadImg(f.image).then((im) => { if (im && score.frames[shownIndex] === f) globe.setFrame(im); });
    shownIndex = i;
    // Preload the next frame so neither view ever flashes.
    loadImg(score.frames[(i + 1) % score.frames.length].image);
  };
  const placeMarker = (step) => { marker.style.left = `${((step + 0.5) / EJ.STEPS) * 100}%`; };
  const showMarker = () => { marker.hidden = settings.mapping !== "scan"; };
  const placeBox = () => {
    const c = Number($("lon").value), r = Number($("lat").value);
    Object.assign(box.style, { left: `${(c / 36) * 100}%`, top: `${(r / 18) * 100}%`, width: `${100 / 36}%`, height: `${100 / 18}%` });
    if (globe) globe.cell = [c, r];
  };

  // ---------- Inside the signal ----------
  const noteName = (p) => (typeof p === "number" ? `${Math.round(p)} Hz` : p);
  const updateSignal = (f, s) => {
    const t = tune();
    const tense = f.hot > t.tenseAt;
    $("s-scale").innerHTML = settings.strict ? "Continuous<small>Strict mode: no scale</small>" : tense ? `Darker<small>${Math.round(f.hot * 100)}% hot, over ${Math.round(t.tenseAt * 100)}%</small>` : `Calm<small>${Math.round(f.hot * 100)}% hot, under ${Math.round(t.tenseAt * 100)}%</small>`;
    $("s-mean").textContent = f.mean === null ? "No data" : `${signed(f.mean)} ${unitShort()}`;
    $("s-mean").className = f.mean > 0 ? "warm" : f.mean < 0 ? "cold" : "";
    $("s-hot").innerHTML = `${Math.round(f.hot * 100)}%<small>${f.clusters} hot patches</small>`;
    $("s-nino").innerHTML = typeof f.nino34Relative === "number" ? `${signed(f.nino34Relative)} ${unitShort()}<small>Bell ${bellOn(f) ? "rings" : "silent"}: line is ${signed(score.ninoLine)}</small>` : "–";
    if (f.mean !== null) {
      const [lo, hi] = t.ladder;
      const rung = Math.round(clamp((f.mean - lo) / (hi - lo)) * 5);
      $("s-chord").innerHTML = `Rung ${rung + 1} of 6<small>${["smoothest", "smooth", "open", "edgy", "rough", "roughest"][rung]}${settings.mapping === "state" ? ", playing" : ""}</small>`;
    } else $("s-chord").textContent = "–";
    if (s === null || settings.mapping !== "scan") {
      $("s-strip").innerHTML = settings.mapping === "scan" ? "–<small>Press Play</small>" : "Whole map<small>Planet Chord</small>";
      $("s-value").textContent = "–"; $("s-note").textContent = "–";
      return;
    }
    const v = f.columns[s];
    $("s-strip").innerHTML = `${lonShort(stripLon(s))}<small>Strip ${s + 1} of ${EJ.STEPS}</small>`;
    if (v === null) { $("s-value").innerHTML = "Land<small>Silence</small>"; $("s-note").textContent = "Rest"; return; }
    $("s-value").textContent = `${signed(v)} ${unitShort()}`;
    $("s-value").className = v > 0 ? "warm" : v < 0 ? "cold" : "";
    const loud = Math.round(100 * (0.25 + 0.75 * clamp(Math.abs(v) / ((score.range[1] - score.range[0]) / 2))));
    $("s-note").innerHTML = `${noteName(son.pitch(v, f))}<small>Loudness ${loud}%</small>`;
  };

  // ---------- Timeline sparkline ----------
  const spark = $("spark");
  const drawSpark = () => {
    const n = score.frames.length;
    const x = (i) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
    const [lo, hi] = score.range;
    // Zoom the chart to the data but keep zero in view; the sound itself never rescales.
    const vals = score.frames.flatMap((f) => [f.mean, f.nino34Relative]).filter((v) => typeof v === "number");
    const top = Math.min(hi, Math.max(0.5, ...vals) + 0.3), bot = Math.max(lo, Math.min(-0.5, ...vals) - 0.3);
    const y = (v) => 40 - ((v - bot) / (top - bot)) * 40;
    const path = (key) => score.frames.map((f, i) => (typeof f[key] === "number" ? `${i && typeof score.frames[i - 1][key] === "number" ? "L" : "M"}${x(i).toFixed(2)} ${y(f[key]).toFixed(2)}` : "")).join(" ");
    const mean = path("mean");
    spark.querySelector(".mean").setAttribute("d", mean);
    spark.querySelector(".area").setAttribute("d", mean ? `${mean} L100 40 L0 40 Z` : "");
    spark.querySelector(".nino").setAttribute("d", path("nino34Relative"));
    const z = spark.querySelector(".zero");
    z.setAttribute("y1", y(0)); z.setAttribute("y2", y(0));
  };
  const drawSparkCursor = (i) => {
    const n = score.frames.length;
    const cx = n <= 1 ? 50 : (i / (n - 1)) * 100;
    const c = spark.querySelector(".cur");
    c.setAttribute("x1", cx); c.setAttribute("x2", cx);
  };

  // ---------- Waveform ----------
  const wave = $("wave");
  const wctx = wave.getContext("2d");
  const drawWave = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(wave.clientWidth * dpr), h = Math.round(wave.clientHeight * dpr);
    if (wave.width !== w || wave.height !== h) { wave.width = w; wave.height = h; }
    wctx.clearRect(0, 0, w, h);
    const data = playing && son && son.waveform ? son.waveform() : null;
    const grad = wctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#5aa9ff"); grad.addColorStop(0.5, "#f4ead8"); grad.addColorStop(1, "#ff7a45");
    wctx.strokeStyle = grad; wctx.lineWidth = 2 * dpr; wctx.beginPath();
    if (data && data.length) {
      for (let i = 0; i < data.length; i++) {
        const px = (i / (data.length - 1)) * w, py = h / 2 - clamp(data[i] * 2.2, -1, 1) * (h / 2 - 3);
        i ? wctx.lineTo(px, py) : wctx.moveTo(px, py);
      }
    } else { wctx.moveTo(0, h / 2); wctx.lineTo(w, h / 2); }
    wctx.stroke();
  };
  const waveLoop = () => {
    drawWave();
    if (playing && !reduced.matches) requestAnimationFrame(waveLoop);
  };

  // ---------- Playback ----------
  const setTime = (i) => {
    $("time").value = i;
    const text = timeText(i);
    $("time").setAttribute("aria-valuetext", text);
    $("time-out").textContent = text;
  };

  const onFrame = (f, i) => {
    setTime(i);
    showFrame(i);
    window.framesSeen = (window.framesSeen || 0) + 1;
    if (bellOn(f)) {
      if (globe) globe.ringBell();
      const b = $("bell"); b.classList.remove("ring"); void b.offsetWidth; b.classList.add("ring");
    }
    if (comparing) {
      const second = cmpFrames++ > 0;
      $("cmp-a-card").classList.toggle("live", !second);
      $("cmp-b-card").classList.toggle("live", second);
    }
  };
  // i is the frame this step belongs to. son.frame() can already be the next frame here:
  // the engine schedules ahead, so at step 15 it has moved on before this callback runs.
  const onStep = (s, i, time) => {
    placeMarker(s);
    const scan = settings.mapping === "scan";
    lightBar(scan ? s : -1);
    if (globe) {
      if (scan) globe.step(s, 60 / settings.bpm / 4, time); else globe.strip = -1;
      globe.follow = scan && $("follow").checked;
    }
    updateSignal(score.frames[i], s);
  };
  const resetCompareUI = () => {
    comparing = false;
    $("cmp-a-card").classList.remove("live"); $("cmp-b-card").classList.remove("live");
    $("cmp-play").textContent = "Play A, then B";
  };
  const onSequenceEnd = () => {
    son.pause(); son.cancelSequence();
    playing = false; setPlayButton(); idleVisuals(); resetCompareUI();
    const a = Number($("cmp-a").value);
    son.seek(a); setTime(a); showFrame(a);
  };

  const idleVisuals = () => {
    lightBar(-1);
    if (globe) globe.strip = -1;
    $("wave-state").textContent = "Press Play";
    drawWave();
    if (son) updateSignal(son.frame(), null);
  };
  const setPlayButton = () => {
    $("play").textContent = playing ? "Pause" : "Play";
    $("play").dataset.state = playing ? "playing" : "paused";
    if (playing) { $("wave-state").textContent = "Live"; waveLoop(); }
  };

  // Build a fresh Sonifier. The old one is disposed first, so notes never double.
  const rebuild = async (startIndex) => {
    const mine = ++gen;
    if (son) son.dispose();
    son = new EJ.Sonifier(score, { ...settings, startIndex, onFrame, onStep, onSequenceEnd });
    window.son = son;
    setTime(son.index);
    showFrame(son.index);
    placeMarker(0);
    if (playing) {
      const ok = await son.play();
      if (mine !== gen) return;
      if (!ok) { playing = false; setPlayButton(); }
    }
  };

  const loadTrack = async (id) => {
    const t = index.tracks.find((x) => x.id === id);
    const s = await getScore(t);
    if (t !== index.tracks.find((x) => x.id === document.querySelector('input[name="track"]:checked').value)) return;
    track = t; score = s;
    if (globe) globe.leftLon = leftLon();
    $("track-about").textContent = t.description || "";
    $("time").max = score.frames.length - 1;
    $("leg-lo").textContent = `${signed(score.range[0])} ${unitShort()}`;
    $("leg-hi").textContent = `${signed(score.range[1])} ${unitShort()}`;
    $("bars-scale").textContent = `${signed(score.range[0], 0)} to ${signed(score.range[1], 0)} ${unitShort()}`;
    $("ax-w").textContent = lonShort(leftLon());
    $("ax-m").textContent = lonShort(leftLon() + 180);
    $("ax-e").textContent = lonShort(leftLon() + 360);
    renderKey();
    drawSpark();
    fillCompare();
    resetCompareUI();
    await rebuild(0);
  };

  list.addEventListener("change", async (e) => {
    if (e.target.name !== "track") return;
    await loadTrack(e.target.value);
    say(`${playing ? "Now playing" : "Selected"} ${track.code} ${track.title}.${playing ? "" : " Press Play to listen."}`);
  });

  $("play").addEventListener("click", async () => {
    if (playing) { son.pause(); playing = false; setPlayButton(); idleVisuals(); if (comparing) { son.cancelSequence(); resetCompareUI(); } return; }
    if (comparing || son.queue) { son.cancelSequence(); resetCompareUI(); }
    playing = true; setPlayButton();
    const mine = son;
    const ok = await son.play();
    if (!ok && mine === son) { playing = false; setPlayButton(); }
  });

  const stopForSpeech = () => {
    if (playing) { son.pause(); playing = false; setPlayButton(); idleVisuals(); }
    if (son.queue || comparing) { son.cancelSequence(); resetCompareUI(); }
  };
  $("describe").addEventListener("click", () => { stopForSpeech(); say(son.frame().text); });
  $("key").addEventListener("click", () => { stopForSpeech(); say(EJ.keyText(score)); });

  const goTo = (i) => {
    const n = score.frames.length;
    i = ((i % n) + n) % n;
    son.seek(i); setTime(i); showFrame(i); placeMarker(0);
  };
  $("time").addEventListener("input", (e) => goTo(Number(e.target.value)));
  $("prev").addEventListener("click", () => { goTo(son.index - (playing && son.step > 2 ? 0 : 1)); if (!playing) say(timeText(son.index)); });
  $("next").addEventListener("click", () => { goTo(son.index + 1); if (!playing) say(timeText(son.index)); });

  document.querySelectorAll('input[name="mapping"]').forEach((r) => r.addEventListener("change", (e) => {
    settings.mapping = e.target.value;
    son.mapping = settings.mapping;   // read live on every step: no restart
    showMarker();
    if (!playing) idleVisuals();
  }));
  $("strict").addEventListener("change", (e) => {
    settings.strict = e.target.checked;
    // A running A-then-B would otherwise turn into an endless loop on the new Sonifier.
    if (comparing) { son.pause(); playing = false; setPlayButton(); idleVisuals(); resetCompareUI(); }
    rebuild(son.index);             // Strict rewires the synths, so it needs a new Sonifier
  });

  // ---------- Listening cursor ----------
  // Named places are only a way to point at a spot. The sound and value still come from the score.
  let place = "";
  const PLACES = {
    regions: [
      ["Niño 3.4", -145, 0], ["Gulf Stream", -65, 38], ["Coral Triangle", 125, 0], ["Humboldt Current", -80, -15],
      ["Indian Ocean", 75, -5], ["Southern Ocean", 0, -60], ["North Atlantic", -30, 50], ["Mediterranean", 15, 35],
    ],
    cities: [
      ["Tokyo", 145, 35], ["Sydney", 155, -35], ["Lagos", 3, 5], ["Mumbai", 68, 18],
      ["Rio de Janeiro", -35, -23], ["Honolulu", -157, 21], ["Lisbon", -15, 38], ["Cape Town", 15, -37],
    ],
  };
  const probe = async () => {
    placeBox();
    const c = $("lon").value, r = $("lat").value;
    if (globe) globe.lookAt(lonOf(c), clamp(latOf(r), -50, 50));
    const value = await son.probe(Number(c), Number(r));
    window.lastProbe = value;
    if (value) say(`${place ? `${place}. ` : ""}${lonText(c)}, ${latText(r)}: ${value}`);
  };
  const pickSpot = ({ lon, lat }, name = "") => {
    place = name;
    const c = Math.min(35, Math.floor((((lon - leftLon()) % 360) + 360) % 360 / 10));
    const r = clamp(Math.floor((90 - lat) / 10), 0, 17);
    $("lon").value = c; $("lat").value = r;
    $("lon").setAttribute("aria-valuetext", lonText(c));
    $("lat").setAttribute("aria-valuetext", latText(r));
    setSpin(false);
    probe();
  };
  for (const [group, id] of [["regions", "places-regions"], ["cities", "places-cities"]]) {
    $(id).innerHTML = PLACES[group].map(([n, lon, lat]) =>
      `<button type="button" class="place" data-lon="${lon}" data-lat="${lat}">${n}</button>`).join("");
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button.place");
      if (b) pickSpot({ lon: Number(b.dataset.lon), lat: Number(b.dataset.lat) }, group === "cities" ? `Sea beside ${b.textContent}` : b.textContent);
    });
  }
  $("lon").addEventListener("input", (e) => { place = ""; e.target.setAttribute("aria-valuetext", lonText(e.target.value)); setSpin(false); probe(); });
  $("lat").addEventListener("input", (e) => { place = ""; e.target.setAttribute("aria-valuetext", latText(e.target.value)); setSpin(false); probe(); });

  // ---------- Hear the change ----------
  const cmpA = $("cmp-a"), cmpB = $("cmp-b");
  const fillCompare = () => {
    const opts = score.frames.map((f, i) => `<option value="${i}">${shortDate(f.date)}${f.label ? ` (${f.label})` : ""}</option>`).join("");
    cmpA.innerHTML = opts; cmpB.innerHTML = opts;
    // Default pair from the data: on then-vs-now tracks, the pair whose Niño 3.4 moved most; otherwise first vs last.
    let a = 0, b = score.frames.length - 1;
    const labels = [...new Set(score.frames.map((f) => f.label).filter(Boolean))];
    if (labels.length >= 2) {
      let best = -1;
      for (let i = 0; i + 1 < score.frames.length; i++) {
        const f = score.frames[i], g = score.frames[i + 1];
        if (f.label === labels[0] && g.label === labels[1] && typeof f.nino34Relative === "number" && typeof g.nino34Relative === "number") {
          const d = Math.abs(g.nino34Relative - f.nino34Relative);
          if (d > best) { best = d; a = i; b = i + 1; }
        }
      }
    }
    cmpA.value = a; cmpB.value = b;
    explainCompare();
  };
  const explainCompare = () => {
    const ia = Number(cmpA.value), ib = Number(cmpB.value);
    const A = score.frames[ia], B = score.frames[ib];
    const u = unitShort();
    for (const [k, f] of [["a", A], ["b", B]]) {
      $(`cmp-${k}-img`).src = f.image;
      $(`cmp-${k}-img`).alt = `Sea surface temperature anomaly map, ${f.date}`;
      $(`cmp-${k}-v`).textContent = f.mean === null ? "No data" : `Map average ${signed(f.mean)} ${u}`;
    }
    const items = [];
    const t = tune();
    if (A.mean !== null && B.mean !== null) {
      const d = B.mean - A.mean;
      const dir = Math.abs(d) < 0.05 ? "about the same" : d > 0 ? `warmer by ${d.toFixed(2)} ${u}` : `cooler by ${Math.abs(d).toFixed(2)} ${u}`;
      items.push(`The whole map is ${dir} in B (${signed(A.mean, 2)} to ${signed(B.mean, 2)} ${u}). ${Math.abs(d) < 0.05 ? "The melody sits at about the same height." : d > 0 ? "On average the Scan melody sits higher." : "On average the Scan melody sits lower."}`);
      const [lo, hi] = t.ladder;
      const rung = (m) => Math.round(clamp((m - lo) / (hi - lo)) * 5);
      const ra = rung(A.mean), rb = rung(B.mean);
      items.push(ra === rb ? `Planet Chord stays on rung ${ra + 1} of 6.` : `Planet Chord moves from rung ${ra + 1} to rung ${rb + 1} of 6: ${rb > ra ? "rougher" : "smoother"}.`);
    }
    items.push(`Ocean above the hot line (${signed(score.hotLine)} ${u}): ${Math.round(A.hot * 100)}% to ${Math.round(B.hot * 100)}%.${(A.hot > t.tenseAt) !== (B.hot > t.tenseAt) ? ` The scale turns ${B.hot > t.tenseAt ? "darker" : "calm"} in B.` : ""}`);
    if (typeof A.nino34Relative === "number" && typeof B.nino34Relative === "number") {
      const ba = bellOn(A), bb = bellOn(B);
      items.push(`Niño 3.4 against the tropics: ${signed(A.nino34Relative)} to ${signed(B.nino34Relative)} ${u}. ${ba === bb ? `The El Niño bell is ${ba ? "on in both" : "silent in both"}.` : `The El Niño bell ${bb ? "rings in B only" : "rings in A only"}.`}`);
    }
    const warmest = (f) => { let k = -1, m = -Infinity; f.columns.forEach((v, s) => { if (v !== null && v > m) { m = v; k = s; } }); return k < 0 ? null : { k, m }; };
    const wa = warmest(A), wb = warmest(B);
    if (wa && wb) items.push(`Highest note: ${lonShort(stripLon(wa.k))} at ${signed(wa.m)} ${u} in A, ${lonShort(stripLon(wb.k))} at ${signed(wb.m)} ${u} in B.`);
    const res = $("cmp-result");
    res.innerHTML = "<ul></ul>";
    for (const s of items) { const li = document.createElement("li"); li.textContent = s; res.firstChild.append(li); }
    return items;
  };
  cmpA.addEventListener("change", explainCompare);
  cmpB.addEventListener("change", explainCompare);
  $("cmp-play").addEventListener("click", async () => {
    if (comparing) { onSequenceEnd(); return; }
    if (playing) { son.pause(); playing = false; }
    const a = Number(cmpA.value), b = Number(cmpB.value);
    comparing = true; cmpFrames = 0;
    $("cmp-play").textContent = "Stop";
    playing = true; setPlayButton();
    const ok = await son.playSequence([a, b]);
    if (!ok) { playing = false; setPlayButton(); resetCompareUI(); }
  });

  // ---------- Key, as a list ----------
  const renderKey = () => {
    const ul = $("keylist");
    ul.innerHTML = "";
    EJ.keyText(score).replace(/^Key\.\s*/, "").split(/(?<=\.)\s+(?=[A-Z])/).forEach((s) => {
      const li = document.createElement("li"); li.textContent = s; ul.append(li);
    });
  };

  // ---------- Settings ----------
  document.querySelectorAll('input[name="speed"]').forEach((r) => r.addEventListener("change", (e) => {
    settings.bpm = Number(e.target.value);
    son.setTempo(settings.bpm);
  }));
  $("volume").addEventListener("input", (e) => {
    settings.volume = Number(e.target.value);
    e.target.setAttribute("aria-valuetext", `${settings.volume} percent`);
    son.setVolume(settings.volume);
  });
  // Mixer: one native checkbox per sound. Ticked = you hear it.
  $("mixer-list").innerHTML = EJ.LAYERS.map((l) =>
    `<label class="check"><input type="checkbox" data-layer="${l.id}" checked aria-describedby="mix-${l.id}"> ${l.label}</label><span id="mix-${l.id}" class="hint mix-note">${l.note}</span>`).join("");
  $("mixer-list").addEventListener("change", (e) => {
    const id = e.target.dataset.layer;
    if (!id) return;
    settings.muted = e.target.checked ? settings.muted.filter((m) => m !== id) : [...settings.muted, id];
    son.setLayerMuted(id, !e.target.checked);
  });
  $("mono").addEventListener("change", (e) => {
    settings.mono = e.target.checked;
    son.setMono(settings.mono);
  });
  $("speak").addEventListener("change", (e) => { if (!e.target.checked && "speechSynthesis" in window) speechSynthesis.cancel(); });

  $("save").addEventListener("click", async () => {
    const btn = $("save");
    stopForSpeech();
    btn.disabled = true;
    const seconds = Math.min(180, EJ.passSeconds(score, settings.bpm));
    const name = `${track.id}-${settings.mapping}.wav`;
    say(`Rendering ${track.code} ${track.title}, ${Math.round(seconds)} seconds of audio. This takes a few seconds.`);
    try {
      const buffer = await EJ.renderOffline(score, { ...settings }, seconds);
      const url = URL.createObjectURL(EJ.toWav(buffer));
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say(`Saved ${name}.`);
    } catch (err) {
      say(`Could not save the audio: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  // Start-up state.
  $("lon").setAttribute("aria-valuetext", lonText($("lon").value));
  $("lat").setAttribute("aria-valuetext", latText($("lat").value));
  placeBox();
  showMarker();
  await loadTrack(track.id);
  drawWave();
  window.addEventListener("resize", () => { if (!playing) drawWave(); });
  window.ready = true;
})();
