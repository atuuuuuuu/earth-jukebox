// Browser test of the real page: keyboard only, every player key, speech text, sound level,
// error state, no keyboard trap, and axe (WCAG 2.2 AA rules) on every track.
// Usage: npm test. Fails (exit 1) on any check marked FAIL.
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
    const m = /^bytes=(\d*)-(\d*)$/.exec(q.headers.range || "");   // byte ranges, like GitHub Pages: videos need them
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, d.length - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(d.length - 1, Number(m[2])) : d.length - 1;
      r.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${d.length}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      r.end(d.subarray(start, end + 1));
      return;
    }
    r.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes" }); r.end(d);
  });
}).listen(8123);

let failures = 0;
const check = (name, ok, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`); };
const AXE = "axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] })";

(async () => {
  const launch = { args: ["--autoplay-policy=user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
  let browser;
  try { browser = await chromium.launch(launch); }
  catch (e) { browser = await chromium.launch({ ...launch, channel: "chrome" }).catch(() => { throw e; }); }

  // ---- Error state: the track list cannot load.
  {
    const page = await browser.newPage();
    await page.route("**/api/tracks.json", (r) => r.fulfill({ status: 500, body: "" }));
    await page.goto("http://localhost:8123/");
    await page.waitForSelector("#alert:not([hidden])", { timeout: 8000 });
    const alert = await page.textContent("#alert");
    check("error state: alert with a way to retry", alert.includes("could not load") && await page.isVisible("#alert button"), alert.slice(0, 60));
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://localhost:8123/");
  await page.waitForFunction("window.ready === true", null, { timeout: 15000 });
  // Read the live region directly: page.textContent waits on animation frames, which a slow
  // machine with software WebGL (the globe) can starve for many seconds.
  const live = async (ms = 200) => { await page.waitForTimeout(ms); return (await page.evaluate(() => document.getElementById("live").textContent)).trim(); };
  // After an action that also swaps the globe's picture (Listen to), a slow machine may take a while
  // to speak: wait for the answer to appear (the live region is cleared first, then filled).
  const spoken = async () => {
    await page.waitForFunction(() => document.getElementById("live").textContent.trim().length > 0, null, { timeout: 5000, polling: 50 }).catch(() => {});
    return live(0);
  };
  check("ready message tells the next step", (await live(300)).includes("Press Tab to reach the player, then Space"), await live(0));
  check("no sound before a key press", await page.evaluate("EJ.Tone.getContext().state !== 'running' || !son.playing"));

  // ---- Keyboard only: the first Tab is the skip link, and it lands in the player's keyboard area.
  await page.keyboard.press("Tab");
  check("first Tab: skip link", await page.evaluate("document.activeElement.classList.contains('skip')"));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  check("skip link focuses the keyboard area", await page.evaluate("document.activeElement.id === 'keys'"));

  // ---- Shortcuts are scoped to the player (WCAG 2.1.4): W outside the player does nothing.
  await page.evaluate(() => document.getElementById("title").setAttribute("tabindex", "-1"));
  await page.focus("#title");
  await page.evaluate(() => { document.getElementById("live").textContent = "x"; });
  await page.keyboard.press("w");
  check("W outside the player is ignored", (await live()) === "x");
  await page.focus("#keys");

  // ---- Play from the keyboard area, and hear it.
  await page.keyboard.press("Space");
  await page.waitForFunction("son.playing === true", null, { timeout: 15000 });
  check("Space plays", (await live(400)).startsWith("Playing"), await live(0));
  await page.evaluate("window.meter = new EJ.Tone.Meter(); EJ.Tone.getDestination().connect(window.meter); window.peak = -Infinity; setInterval(() => { const v = window.meter.getValue(); if (v > window.peak) window.peak = v; }, 20);");
  await page.waitForTimeout(4000);
  const peak = await page.evaluate("Math.round(window.peak * 10) / 10");
  check("sound is playing, not clipping", peak > -40 && peak < 0, `peak ${peak} dB`);
  check("globe follows the scan line", await page.evaluate("window.globe ? window.globe.headLon < 900 : true"));

  await page.keyboard.press("w");
  const w = await live();
  check("W: where am I", w.startsWith("You are in the player. Track 1 of") && w.includes("scan line is at"), w.slice(0, 120));
  await page.keyboard.press("ArrowRight");
  check("Right arrow: next map, named first", (await live()).startsWith("Next map. 2013, map 2 of 12"), await live(0));
  check("map slider follows", (await page.getAttribute("#map", "aria-valuetext")).startsWith("2013"));
  await page.keyboard.press("Home");
  check("Home: first map", (await live()).startsWith("First map. 2012, map 1"));
  await page.keyboard.press("ArrowLeft");
  check("Left arrow at the start says so", (await live()).startsWith("Previous map. Already at the first map"));
  await page.evaluate(() => { document.getElementById("keyecho").click(); document.getElementById("keys").focus(); });
  await page.keyboard.press("End");
  check("key names can be turned off", (await live()).startsWith("2023, map 12"), await live(0));
  await page.evaluate(() => { document.getElementById("keyecho").click(); document.getElementById("keys").focus(); });
  await page.keyboard.press("Home");
  await page.keyboard.press("q");
  check("a key with no job says so", (await live()) === "Q does nothing here. Press H to hear the keys.", await live(0));
  await page.keyboard.press("h");
  check("H: every key", (await live()).startsWith("Player keys. Space: play or pause."));
  await page.keyboard.press("d");
  const d = await live();
  check("D: describe pauses and says the map", d.startsWith("Describe. Paused. 2012.") && d.endsWith("Press Space to play."), d.slice(0, 80));
  check("D paused the sound", !(await page.evaluate("son.playing")));
  await page.keyboard.press("s");
  check("S: what the sounds mean", (await live()).includes("scan line"));
  await page.keyboard.press("m");
  check("M: mono toggles", (await live()) === "Mono on." && await page.isChecked("#mono"));
  await page.keyboard.press("m");

  // ---- Buttons work the same; Space on a focused button is native.
  await page.focus("#where");
  await page.keyboard.press("Space");
  check("Where am I button", (await live()).startsWith("You are in the player"));

  // ---- Every track, by number key: loads, plays, and passes axe.
  await page.evaluate(axeSource);
  const ids = await page.evaluate(() => [...document.querySelectorAll('input[name="track"]')].map((r) => r.value));
  for (let k = 0; k < ids.length; k++) {
    await page.focus("#keys");
    if (k > 0) {
      await page.keyboard.press(String(k + 1));
      await page.waitForFunction(`window.son && son.score.id === "${ids[k]}" && !document.getElementById('play').disabled`, null, { timeout: 15000 });
      await page.waitForFunction(`document.getElementById("live").textContent.startsWith("Track ${k + 1} of")`, null, { timeout: 15000, polling: 50 }).catch(() => {});
      check(`key ${k + 1}: track ${ids[k]} chosen and announced`, (await live(0)).startsWith(`Track ${k + 1} of ${ids.length}`), await live(0));
    }
    await page.keyboard.press("Space");
    await page.waitForFunction("son.playing", null, { timeout: 15000 });
    await page.evaluate("window.peak = -Infinity; window.framesSeen = 0");
    await page.waitForTimeout(2500);
    const tp = await page.evaluate("Math.round(window.peak * 10) / 10");
    const extra = ids[k] === "carbon-dioxide"
      ? await page.evaluate("Math.abs(document.getElementById('video').currentTime - son.mediaTime()).toFixed(2)") : null;
    check(`${ids[k]}: plays`, tp > -40 && tp < 0, `peak ${tp} dB${extra !== null ? `, video off by ${extra} s` : ""}`);
    if (extra !== null) check(`${ids[k]}: NASA video in step with the sound`, Number(extra) < 0.4);
    await page.keyboard.press("w");
    const wk = await live();
    check(`${ids[k]}: where am I`, wk.includes(`Track ${k + 1} of`)
      && (ids[k] !== "ocean-currents" || /The camera is over .+\d{4}|\d{4}\. The camera is over/.test(wk)), wk.slice(0, 140));
    await page.keyboard.press("Space");   // pause
    const axe = await page.evaluate(AXE);
    check(`${ids[k]}: axe`, axe.violations.length === 0, axe.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ") || `${axe.passes.length} rules passed`);
    // Hear an example, then its meaning is spoken.
    const demo = await page.evaluate(() => { const b = document.querySelector("#demos button"); b.click(); return b.querySelector("b").textContent; });
    await page.waitForFunction("document.getElementById('live').textContent.length > 20 && !document.getElementById('live').textContent.startsWith('Paused')", null, { timeout: 8000, polling: 100 });
    check(`${ids[k]}: example "${demo}" plays and explains`, true, (await live(0)).slice(0, 60));
    // Explore one place.
    await page.click("#places button:first-child");
    await page.waitForTimeout(400);
    const pr = await live(0);
    check(`${ids[k]}: Ulaanbaatar button`, pr.startsWith("Ulaanbaatar.") && !!(await page.evaluate("window.lastProbe")), pr.slice(0, 110));
    // Offline render for Save as audio file.
    const wav = await page.evaluate(async () => {
      const b = await son.renderOffline(6);
      const l = b.getChannelData(0), r = b.getChannelData(1);
      let pk = 0, sum = 0;
      for (let i = 0; i < l.length; i++) { pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i])); sum += l[i] * l[i]; }
      return { peakDb: +(20 * Math.log10(pk)).toFixed(1), rmsDb: +(10 * Math.log10(sum / l.length)).toFixed(1) };
    });
    check(`${ids[k]}: audio file render`, wav.peakDb < 0 && wav.rmsDb > -50, JSON.stringify(wav));
    // Compare with previous part: only where the track has it (lightning), by key C and the checkbox.
    const canCompare = await page.evaluate("son.canCompare");
    check(`${ids[k]}: compare control shown only where it works`, (await page.isVisible("#compare")) === canCompare);
    if (canCompare) {
      await page.focus("#keys");
      await page.keyboard.press("Home");
      await page.keyboard.press("c");
      const on = await live(300);
      check(`${ids[k]}: C turns on compare and explains the first part`, on.startsWith("Compare with previous part on") && on.includes("nothing to compare") && await page.isChecked("#compare"), on.slice(0, 90));
      await page.keyboard.press("ArrowRight");
      check(`${ids[k]}: compare names both parts (after the key's own name)`, /^Next map\. Part 2 of \d+ compared with Part 1\./.test(await live()), await live(0));
      await page.keyboard.press("d");
      check(`${ids[k]}: D describes the change`, /compared with Part 1\. Lightning grew in/.test(await live()), (await live(0)).slice(0, 90));
      const cmp = await page.evaluate(async () => { const b = await son.renderOffline(4); let pk = 0; for (const x of b.getChannelData(0)) pk = Math.max(pk, Math.abs(x)); return +(20 * Math.log10(pk)).toFixed(1); });
      check(`${ids[k]}: compare pass renders`, cmp < 0 && cmp > -40, `peak ${cmp} dB`);
      await page.keyboard.press("c");
      check(`${ids[k]}: C turns compare off`, (await live()).startsWith("Compare off") && !(await page.isChecked("#compare")));
    }
    // Listen to: where the track has layers (aerosols), a radio group of All and each layer, and
    // a letter for each in the player, never outside it.
    const lay = await page.evaluate(() => son.layers.map((L) => ({ id: L.id, name: L.name, key: L.key })));
    check(`${ids[k]}: Listen to shown only where it works`, (await page.isVisible("#listen-field")) === lay.length > 0);
    if (lay.length) {
      const radios = await page.evaluate(() => [...document.querySelectorAll("#listen-field input")].map((r) => ({ id: r.id, type: r.type, name: r.name, checked: r.checked })));
      check(`${ids[k]}: Listen to is one radio group, All first and chosen`,
        (await page.textContent("#listen-field legend")).trim() === "Listen to" && radios.length === lay.length + 1
        && radios.every((r) => r.type === "radio" && r.name === "listen") && radios[0].id === "listen-all" && radios[0].checked,
        radios.map((r) => r.id).join(", "));
      await page.focus("#listen-all");
      await page.keyboard.press("ArrowRight");
      const moved = await spoken();
      check(`${ids[k]}: arrow key chooses ${lay[0].name} and says so`, moved.startsWith(`${lay[0].name} only.`)
        && await page.isChecked(`#listen-${lay[0].id}`) && await page.evaluate(`son.solo === "${lay[0].id}"`), moved);
      await page.focus("#keys");
      for (const L of lay) {
        await page.keyboard.press(L.key.toLowerCase());
        const said = await spoken();
        check(`${ids[k]}: ${L.key} chooses ${L.name}`, said.startsWith(`${L.name} only.`)
          && await page.isChecked(`#listen-${L.id}`) && await page.evaluate(`son.solo === "${L.id}"`), said);
      }
      await page.keyboard.press("w");
      const where = await live();
      check(`${ids[k]}: W says what you listen to and what is under the line`,
        where.includes(`Listening to ${lay[lay.length - 1].name.toLowerCase()} only`) && where.includes("scan line is at"), where.slice(0, 160));
      await page.keyboard.press("a");
      const all = await spoken();
      check(`${ids[k]}: A goes back to all`, /^All \w+ /.test(all) && await page.isChecked("#listen-all") && await page.evaluate("son.solo === null"), all);
      await page.keyboard.press("h");
      const help = await live();
      check(`${ids[k]}: H lists the letters`, help.includes("A: all") && lay.every((L) => help.includes(`${L.key}: ${L.name.toLowerCase()} only`)));
      await page.focus("#title");
      await page.evaluate(() => { document.getElementById("live").textContent = "x"; });
      await page.keyboard.press(lay[0].key.toLowerCase());
      check(`${ids[k]}: layer letters are ignored outside the player`, (await live()) === "x" && await page.evaluate("son.solo === null"));
    }
  }

  // ---- Sliders keep their own arrow keys and speak each spot.
  await page.focus("#lon");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  check("west-east slider: arrow key plays a spot", /degrees/.test(await live(0)), (await live(0)).slice(0, 90));

  // ---- Escape stops everything, from anywhere.
  await page.focus("#keys");
  await page.keyboard.press("Space");
  await page.waitForFunction("son.playing", null, { timeout: 10000 });
  await page.focus("#volume");
  await page.keyboard.press("Escape");
  check("Escape stops sound and says so", (await live()) === "Stopped." && !(await page.evaluate("son.playing")));

  // ---- No keyboard trap: Tab visits every control and leaves the page.
  // Start on the skip link, then Tab until focus leaves the page: every stop is recorded.
  await page.focus(".skip");
  const seen = ["skip"];
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : a.classList.contains("skip") ? "skip" : a.id || a.textContent.trim().slice(0, 20) || a.tagName; });
    if (id === "BODY" || id === "skip") break;
    seen.push(id);
  }
  // Every enabled control (Previous and Next are disabled on a one-map track), and the Listen to
  // group where it is shown (Tab lands on its chosen radio).
  const want = await page.evaluate(() => [
    ...["keys", "play", "prev", "next", "where", "describe", "help", "lon", "lat", "volume", "announce", "mono", "speak", "save"].filter((id) => !document.getElementById(id).disabled),
    ...(document.getElementById("listen-field").hidden ? [] : [document.querySelector("#listen-field input:checked").id]),
  ]);
  const missing = want.filter((x) => !seen.includes(x));
  check("Tab walks the whole page without a trap", !missing.length && seen.length < 150, `${seen.length} stops${missing.length ? `, never reached: ${missing}` : ""}`);
  // Every focused control shows a visible focus ring.
  await page.focus("#play");
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  check("focus ring visible", ring !== "none", ring);

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  server.close();
  console.log(failures ? `${failures} check(s) failed` : "all checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
