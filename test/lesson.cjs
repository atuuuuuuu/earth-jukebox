// Browser test of the guided lesson (ocean currents), keyboard only: it is reached with Tab, each
// step explains itself before any sound, every sound plays, pauses, goes on and replays, examples
// play and then say what they mean, the state is always in words, the tour and the lesson never
// play at once, the ocean background is off until asked for, and axe finds nothing.
// Usage: npm run test:lesson. Fails (exit 1) on any check marked FAIL.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const axeSource = fs.readFileSync(path.join(__dirname, "../node_modules/axe-core/axe.min.js"), "utf8");

const root = path.join(__dirname, "../public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
const server = http.createServer((q, r) => {
  if (q.url === "/favicon.ico") { r.writeHead(204); r.end(); return; }
  const f = path.join(root, q.url === "/" ? "index.html" : q.url.split("?")[0]);
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    const type = types[path.extname(f)] || "application/octet-stream";
    const m = /^bytes=(\d*)-(\d*)$/.exec(q.headers.range || "");
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, d.length - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(d.length - 1, Number(m[2])) : d.length - 1;
      r.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${d.length}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      r.end(d.subarray(start, end + 1));
      return;
    }
    r.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes" }); r.end(d);
  });
}).listen(8125);

let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`); };

(async () => {
  const launch = { args: ["--autoplay-policy=user-gesture-required"] };
  let browser;
  try { browser = await chromium.launch(launch); }
  catch (e) { browser = await chromium.launch({ ...launch, channel: "chrome" }).catch(() => { throw e; }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://localhost:8125/");
  await page.waitForFunction("window.ready === true", null, { timeout: 15000 });
  const live = async (ms = 200) => { await page.waitForTimeout(ms); return (await page.textContent("#live")).trim(); };
  const waitLive = (re, timeout = 12000) => page.waitForFunction(`${re}.test(document.getElementById("live").textContent)`, null, { timeout, polling: 50 });
  check("no lesson on a track without one", await page.isHidden("#lesson"));

  // ---- Choose the ocean track from the track list: the lesson appears, and is announced.
  const radio = await page.evaluate(() => [...document.querySelectorAll('input[name="track"]')].find((r) => r.value === "ocean-currents").id);
  await page.focus(`#${radio}`);
  await page.keyboard.press("Space");
  await page.waitForFunction("window.lesson && !document.getElementById('lesson').hidden", null, { timeout: 15000 });
  await waitLive("/Ocean currents/");
  const pick = await live(0);
  check("track announces its lesson and how to reach it", /It starts with a guided lesson, The Gulf Stream, step by step, in \d+ short steps\. Press Tab to reach the lesson/.test(pick), pick);
  check("no lesson sound before a key press", await page.evaluate("window.lesson.voices.length === 0 && !window.lesson.A"));
  await page.keyboard.press("Tab");
  check("Tab from the track list lands in the lesson's keyboard area", await page.evaluate("document.activeElement.id === 'lesson-keys'"));
  check("the lesson names NASA's film and links to it", /^Source: Perpetual Ocean 2/.test(await page.textContent("#lesson-source"))
    && (await page.getAttribute("#lesson-source a", "href")) === "https://svs.gsfc.nasa.gov/5425/");
  check("step 1 shown in words", (await page.textContent("#lesson-pos")) === "Step 1 of 13" && (await page.textContent("#lesson-step-h")) === "What is an ocean current?");

  // ---- Step 1 explains before it plays; Space plays both examples, each named first.
  await page.keyboard.press("d");
  const s1 = await live();
  check("D reads the step: explanation first, then what to press", s1.startsWith("Read the step again. Step 1 of 13: What is an ocean current? An ocean current is water")
    && s1.includes("A wave is different") && s1.endsWith("Right arrow: next step."), s1.slice(0, 90));
  await page.evaluate("window.meter = new EJ.Tone.Meter(); EJ.Tone.getDestination().connect(window.meter); window.peak = -Infinity; setInterval(() => { const v = window.meter.getValue(); if (v > window.peak) window.peak = v; }, 20);");
  await page.keyboard.press("Space");
  await waitLive("/^A wave\\.$/");
  check("Space: the example's name is said before its sound", (await page.evaluate("window.lesson.voices.length")) === 0);
  await page.waitForFunction("window.lesson.voices.length > 0", null, { timeout: 5000 });
  check("then the sound plays", true, await page.textContent("#lesson-state"));
  await waitLive("/Press R to hear it again/", 20000);
  const pk = await page.evaluate("Math.round(window.peak * 10) / 10");
  check("lesson sounds are audible and do not clip", pk > -35 && pk < 0, `peak ${pk} dB`);

  // ---- Step 2 has no sound, and says so.
  await page.keyboard.press("ArrowRight");
  const s2 = await live();
  check("Right arrow: next step, named first", s2.startsWith("Next step. Step 2 of 13: Our example: the Gulf Stream.") && s2.includes("17 March 2023 to 19 June 2023"), s2.slice(0, 100));
  await page.keyboard.press("Space");
  check("Space on a step with no sound says so", (await live()).startsWith("This step has no sound."), await live(0));

  // ---- Step 3: the direction sound, explained, with one button per direction.
  await page.keyboard.press("ArrowRight");
  const s3 = await live();
  check("direction sound explained before it is used", s3.includes("rises") && s3.includes("from your left ear to your right") && s3.includes("Press Space to hear all 4"), s3.slice(0, 80));
  const cues = await page.$$eval("#lesson-previews button", (bs) => bs.map((b) => b.textContent));
  check("one example button per direction, each saying what it sounds like", cues.length === 4 && cues[0].startsWith("North") && cues[0].includes("the tone rises"), cues.join(" | "));
  await page.click('#lesson-previews button[data-cue="east"]');
  await waitLive("/East: the tone moves from your left ear to your right\\.$/");
  check("an example plays, then says what it means", true, await live(0));

  // ---- Step 4: a measured place. The words, the picture's label and the sound agree.
  await page.focus("#lesson-keys");
  await page.keyboard.press("ArrowRight");
  const s4 = await live();
  check("place 1: measured direction in words", s4.includes("Off Miami") && s4.includes("Here the water flows north.") && s4.includes("Press Space to hear it."), s4.slice(0, 120));
  check("the picture's label names the place and the arrow", /Marked: off Miami, Florida, with an arrow pointing north\./.test(await page.getAttribute("#lesson-pic", "aria-label")));
  await page.keyboard.press("Space");
  await page.waitForFunction("window.lesson.voices.length > 0", null, { timeout: 5000 });
  check("Play button turns into Pause while playing", (await page.textContent("#lesson-play-label")) === "Pause");
  check("the visible Now line says what is playing", (await page.textContent("#lesson-state")).startsWith("Playing: the water flows north"));
  await waitLive("/^That was north\\. Press R to hear it again, or Right arrow for the next step\\.$/");
  check("after the sound: what it was, and what to press", true);
  await page.keyboard.press("w");
  check("W: where am I, in words", (await live()).startsWith("You are in the lesson, step 4 of 13: Direction, place 1 of 4: off Miami. Off Miami, Florida: the water flows north"), await live(0));

  // ---- A series: pause, go on, replay, stop.
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  const s12 = await live();
  check("End then Left: the restless place", s12.startsWith("Back. Step 12 of 13: Change, place 2 of 2"), s12.slice(0, 80));
  await page.keyboard.press("Space");
  await waitLive("/^17 March\\.$/");
  await page.waitForFunction("window.lesson.seq.k >= 1", null, { timeout: 12000 });
  await page.keyboard.press("Space");
  const paused = await live();
  check("Space pauses, and says where", /^Paused at \d+ of 12\. Press Space to go on, or R to start again\.$/.test(paused) && await page.evaluate("!window.lesson.seq.playing && window.lesson.voices.length === 0"), paused);
  check("Pause leaves no sound playing", await page.evaluate("window.lesson.timers.length === 0 || window.lesson.voices.length === 0"));
  await page.keyboard.press("Space");
  check("Space again goes on from the same place", /^Going on from \d+ of 12\.$/.test(await live()), await live(0));
  await page.keyboard.press("r");
  await waitLive("/^Replay\\. 17 March\\.$|^17 March\\.$/");
  check("R replays from the start", await page.evaluate("window.lesson.seq.k === 0 && window.lesson.seq.playing"));

  // ---- One thing at a time: the tour stops the lesson, and Escape stops everything.
  await page.focus("#keys");
  await page.keyboard.press("Space");
  await page.waitForFunction("son.playing", null, { timeout: 20000 });
  check("playing the tour stops the lesson", await page.evaluate("!window.lesson.seq.playing && window.lesson.voices.length === 0"));
  await page.keyboard.press("l");
  check("L in the player goes to the lesson", await page.evaluate("document.activeElement.id === 'lesson-keys'") && (await live()).startsWith("Lesson. You are in the lesson, step 12"), await live(0));
  await page.keyboard.press("Space");
  await page.waitForFunction("window.lesson.seq.playing", null, { timeout: 5000 });
  check("the lesson pauses the tour", !(await page.evaluate("son.playing")));
  await page.keyboard.press("Escape");
  check("Escape stops the lesson", (await live()) === "Stopped." && await page.evaluate("!window.lesson.seq.playing"));

  // ---- Keys with no job, and the key list.
  await page.keyboard.press("q");
  check("a key with no job says so", (await live()) === "Q does nothing here. Press H to hear the lesson keys.", await live(0));
  await page.keyboard.press("h");
  check("H: every lesson key", (await live()).startsWith("Lesson keys. Right arrow: next step."));
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  check("Left at the first step says so", (await live()).startsWith("Back. Already at the first step"), await live(0));

  // ---- Settings: background off until asked for, carries no information; narration controls.
  check("ocean background off by default", !(await page.isChecked("#lesson-bg")));
  await page.click("#lesson-bg");
  check("background on when asked for", (await live()).startsWith("Ocean background on. It carries no information.") && await page.evaluate("window.lesson.A.bgOn"));
  await page.click("#lesson-bg");
  check("and off again", await page.evaluate("!window.lesson.A.bgOn"));
  check("sliders say their value", (await page.getAttribute("#lesson-fx", "aria-valuetext")) === "80 percent"
    && (await page.getAttribute("#voice-rate", "aria-valuetext")) === "100 percent of normal speed");
  await page.click("#lesson-speak");
  check("Read the lesson aloud is the same switch as Read aloud", await page.isChecked("#speak"));
  await page.click("#lesson-speak");

  // ---- Tab order: the lesson's controls, then the player.
  await page.focus("#lesson-keys");
  const seen = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement.id || document.activeElement.textContent.trim().slice(0, 16));
    seen.push(id);
    if (id === "keys") break;
  }
  const want = ["lesson-back", "lesson-play", "lesson-replay", "lesson-next", "lesson-where", "lesson-to-tour", "lesson-fx", "lesson-bg", "lesson-bg-vol", "lesson-speak", "voice-vol", "voice-rate", "keys"];
  check("Tab reaches every lesson control, then the player", want.every((x) => seen.includes(x)), seen.join(" > "));

  // ---- axe on the page with the lesson showing.
  await page.evaluate(axeSource);
  const axe = await page.evaluate("axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] })");
  check("axe: lesson page", axe.violations.length === 0, axe.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target}`).join(", ") || `${axe.passes.length} rules passed`);

  // ---- Another track hides the lesson and frees its sound.
  await page.evaluate(() => document.querySelector('input[name="track"]').click());
  await page.waitForFunction("window.son && son.score.id !== 'ocean-currents' && !window.lesson", null, { timeout: 15000 });
  check("another track hides the lesson", await page.isHidden("#lesson") && await page.isHidden("#to-lesson"));

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  server.close();
  console.log(failures ? `${failures} check(s) failed` : "all lesson checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
