const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const axeSource = fs.readFileSync(path.join(__dirname, "../node_modules/axe-core/axe.min.js"), "utf8");

const root = path.join(__dirname, "../public");
const server = http.createServer((q, r) => {
  const f = path.join(root, q.url === "/" ? "index.html" : q.url.split("?")[0]);
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg" };
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); r.end(d); });
}).listen(8123);

(async () => {
  // SwiftShader gives headless Chromium WebGL, so the globe is tested too.
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://localhost:8123/");
  await page.waitForFunction("window.ready === true");

  console.log("context before gesture:", await page.evaluate("EJ.Tone.getContext().state"), "| globe:", await page.evaluate("window.globeReady ? 'WebGL' : 'flat map fallback'"));

  // Keyboard only: tab until the Play button has focus, then press Space.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate("document.activeElement.id === 'play'")) break;
  }
  console.log("focus on:", await page.evaluate("document.activeElement.id"));
  await page.keyboard.press("Space");
  await page.waitForFunction("EJ.Tone.getContext().state === 'running' && EJ.Tone.getTransport().state === 'started'", null, { timeout: 8000 });
  console.log("context after Space:", await page.evaluate("EJ.Tone.getContext().state"), "| button:", await page.textContent("#play"));

  await page.evaluate("window.meter = new EJ.Tone.Meter(); EJ.Tone.getDestination().connect(window.meter); window.peak = -Infinity; window.mi = setInterval(() => { const v = window.meter.getValue(); if (v > window.peak) window.peak = v; }, 20);");
  await page.waitForTimeout(6500);
  console.log("live peak dB:", await page.evaluate("Math.round(window.peak * 10) / 10"), "| frames seen:", await page.evaluate("window.framesSeen"));
  console.log("slider follows playback:", await page.getAttribute("#time", "aria-valuetext"));

  // Describe pauses the music and fills the live region.
  await page.click("#describe");
  await page.waitForTimeout(200);
  console.log("after describe:", await page.evaluate("EJ.Tone.getTransport().state"), "|", await page.textContent("#live"));

  // Listening cursor by arrow key.
  await page.focus("#lon");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  console.log("cursor:", await page.getAttribute("#lon", "aria-valuetext"), "->", await page.evaluate("window.lastProbe"));

  await page.evaluate("document.getElementById('lon').value = 5; document.getElementById('lon').dispatchEvent(new Event('input', {bubbles:true}))");
  await page.waitForTimeout(200);
  console.log("cursor over ocean:", await page.getAttribute("#lon", "aria-valuetext"), "->", await page.evaluate("window.lastProbe"));

  // Tap the middle of the globe: it should play and name that spot.
  if (await page.evaluate("window.globeReady")) {
    await page.evaluate("window.scrollTo(0, 0)");
    const g = await page.locator("#globe").boundingBox();
    await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
    await page.waitForTimeout(300);
    console.log("globe tap:", await page.textContent("#live"));
  }

  // Hear the change: plays A then B once, then stops by itself.
  await page.click("#cmp-play");
  await page.waitForFunction("document.getElementById('cmp-play').textContent.startsWith('Play')", null, { timeout: 20000 });
  console.log("hear the change finished:", await page.evaluate("EJ.Tone.getTransport().state"), "| waveform samples:", await page.evaluate("(son.waveform() || []).length"));

  // Time slider by arrow key.
  await page.focus("#time");
  await page.keyboard.press("ArrowRight");
  console.log("time slider:", await page.getAttribute("#time", "aria-valuetext"));

  // Automated accessibility scan.
  await page.evaluate(axeSource);
  const axe = await page.evaluate("axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] })");
  console.log("axe violations:", axe.violations.length, axe.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", "), "| rules passed:", axe.passes.length);

  // Offline renders of each mapping: non-silent, not clipping, and the two maps differ.
  const stats = await page.evaluate(async () => {
    const index = await (await fetch("api/tracks.json")).json();
    const score = await (await fetch(index.tracks[0].score)).json();
    const out = {};
    const t0 = performance.now();
    for (const [name, opt] of [["scan", { mapping: "scan" }], ["chord", { mapping: "state" }], ["strict", { mapping: "scan", strict: true }]]) {
      const b = await EJ.renderOffline(score, opt, 12);
      const d = b.getChannelData(0); const r = b.getChannelData(1);
      let peak = 0, sum = 0, side = 0;
      for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i]), Math.abs(r[i])); sum += d[i] * d[i]; side += (d[i] - r[i]) ** 2; }
      out[name] = { peakDb: +(20 * Math.log10(peak)).toFixed(1), rmsDb: +(10 * Math.log10(sum / d.length)).toFixed(1), stereoDiff: +(side / d.length).toExponential(2) };
    }
    out.ms = Math.round(performance.now() - t0);
    return out;
  });
  console.log("offline:", JSON.stringify(stats));

  console.log("page errors:", errors.length, errors.slice(0, 5));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
