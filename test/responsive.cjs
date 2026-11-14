// Responsive check: loads the page at seven widths and fails on horizontal overflow,
// content cut off at the right edge, or touch targets smaller than 44 px on touch screens.
// Usage: npm run test:responsive [-- screenshots-dir]
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");

const root = path.join(__dirname, "../public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".mp4": "video/mp4" };
const server = http.createServer((q, r) => {
  const f = path.join(root, q.url === "/" ? "index.html" : q.url.split("?")[0]);
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); r.end(d); });
}).listen(8124);

const sizes = [[320, 640], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1440, 900]];
const shots = process.argv[2];

// Runs in the page: everything that breaks the layout at this width.
function audit(touch) {
  const vw = document.documentElement.clientWidth, out = { overflow: document.documentElement.scrollWidth - vw, cut: [], small: [] };
  const name = (el) => el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "") + (el.textContent ? ` "${el.textContent.trim().slice(0, 24)}"` : "");
  const visible = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0 && !el.closest("[hidden],.sr-only"); };
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && !el.closest(".sr-only,.skip")) out.cut.push(`${name(el)} right=${Math.round(r.right)}`);
  }
  if (touch) for (const el of document.querySelectorAll("button, a, select, input, label.check, .seg label")) {
    if (!visible(el) || el.closest(".skip")) continue;
    // A radio or checkbox counts through its label, which is the real touch target.
    const t = el.closest(".track") || ((el.type === "radio" || el.type === "checkbox") && el.closest("label")) || el;   // a track card is clickable all over
    const r = t.getBoundingClientRect();
    if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;   // links inside sentences
    if (r.height < 44 || r.width < 44) out.small.push(`${name(t)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  // The globe overlays ignore the pointer, so check by hand that they do not cover each other.
  const ov = [...document.querySelectorAll(".overlay")].filter(visible).map((el) => [el.className, el.getBoundingClientRect()]);
  for (let i = 0; i < ov.length; i++) for (let j = i + 1; j < ov.length; j++) {
    const [a, ra] = ov[i], [b, rb] = ov[j];
    if (ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom) out.cut.push(`overlap: ${a} / ${b}`);
  }
  out.cut = [...new Set(out.cut)].slice(0, 10);
  out.small = [...new Set(out.small)].slice(0, 15);
  return out;
}

(async () => {
  const launch = { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
  let browser;
  try { browser = await chromium.launch(launch); } catch (e) { browser = await chromium.launch({ ...launch, channel: "chrome" }); }
  let failed = 0;
  for (const [w, h] of sizes) {
    const touch = w < 1024;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 768 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:8124/");
    await page.waitForFunction("window.ready === true");
    // Every kind of stage must fit: NASA's video (carbon dioxide), lightning (with its compare
    // control), then the globe (track 1).
    let flat = { cut: [], small: [], overflow: 0 };
    for (const id of ["carbon-dioxide", "lightning"]) {
      const radio = await page.evaluate((v) => [...document.querySelectorAll('input[name="track"]')].find((r) => r.value === v)?.id, id);
      if (!radio) continue;
      await page.evaluate((x) => document.getElementById(x).click(), radio);
      await page.waitForFunction(`window.son && window.son.score.id === '${id}'`);
      const a = await page.evaluate(audit, touch);
      flat = { cut: [...flat.cut, ...a.cut], small: [...flat.small, ...a.small], overflow: Math.max(flat.overflow, a.overflow) };
    }
    await page.evaluate(() => document.querySelector('input[name="track"]').click());
    await page.waitForFunction("window.son && window.son.score.id === document.querySelector('input[name=\"track\"]').value");
    const r = await page.evaluate(audit, touch);
    r.cut = [...new Set([...r.cut, ...flat.cut])];
    r.small = [...new Set([...r.small, ...flat.small])];
    r.overflow = Math.max(r.overflow, flat.overflow);
    const bad = r.overflow > 0 || r.cut.length || r.small.length || errors.length;
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "ok  "} ${w}x${h}${touch ? " touch" : ""} | overflow ${r.overflow}px | cut ${r.cut.length} | small targets ${r.small.length} | errors ${errors.length}`);
    for (const x of [...r.cut, ...r.small, ...errors]) console.log("     " + x);
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      for (const id of ["tracks", "player", "sounds", "explore", "settings"]) await page.locator("#" + id).screenshot({ path: path.join(shots, `${w}-${id}.png`) });
    }
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failed ? `${failed} of ${sizes.length} widths have problems` : "all widths ok");
  process.exit(failed ? 1 : 0);
})();
