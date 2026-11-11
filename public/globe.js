// globe.js: a 3D globe in plain WebGL. No libraries.
// The ocean is the NASA data frame itself; land comes from NASA Blue Marble.
// It shows what the music is doing: the scan strip, the listening cursor and the Niño 3.4 box.
(function () {
  "use strict";

  const VERT = `
attribute vec3 aPos;
attribute vec2 aLL;            // lon, lat in degrees
uniform mat4 uMVP;
uniform mat3 uRot;
varying vec2 vLL;
varying vec3 vN;
void main() {
  vLL = aLL;
  vN = uRot * aPos;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

  // With OES_standard_derivatives, lines are a fixed number of screen pixels wide and anti-aliased.
  // Without it, they fall back to a fixed width in degrees.
  const FRAG_DERIV = `#extension GL_OES_standard_derivatives : enable
#define HAS_DERIV 1
`;
  const FRAG = `
precision highp float;
varying vec2 vLL;
varying vec3 vN;
uniform sampler2D uData0;
uniform sampler2D uData1;
uniform sampler2D uEarth;
uniform float uMix;            // crossfade between the previous and current frame
uniform float uLeftLon;
uniform float uStrip;          // scan strip 0..15, or -1
uniform float uHead;           // playhead longitude, gliding through the strip being played
uniform vec2 uCell;            // listening cursor (col, row), or (-1, -1)
uniform float uBell;           // 0..1, the El Niño bell glow
uniform float uNinoOn;         // 1 when the track has Niño 3.4 data, else the box is not drawn
uniform float uDataOn;
uniform float uPx;             // device pixels per CSS pixel

float lonDist(float a, float b) { return abs(mod(a - b + 540.0, 360.0) - 180.0); }
float band(float d, float w) { return 1.0 - smoothstep(0.0, w, d); }
// A line px CSS pixels wide, at distance d (in degrees) from its centre, with a one-pixel soft edge.
float line(float d, float px) {
#ifdef HAS_DERIV
  float w = max(fwidth(d), 1e-4);
#else
  float w = 0.3 / uPx;
#endif
  float hw = 0.5 * px * uPx * w;
  return 1.0 - smoothstep(hw, hw + w * uPx, d);
}

void main() {
  float lon = vLL.x, lat = vLL.y;
  vec2 uvImg = vec2(mod(lon - uLeftLon + 360.0, 360.0) / 360.0, (90.0 - lat) / 180.0);
  vec2 uvEarth = vec2((lon + 180.0) / 360.0, (90.0 - lat) / 180.0);
  vec3 d0 = texture2D(uData0, uvImg).rgb;
  vec3 d1 = texture2D(uData1, uvImg).rgb;
  vec3 data = mix(d0, d1, uMix);
  vec3 earth = texture2D(uEarth, uvEarth).rgb;

  // The NASA frames paint land and ice grey. Grey means "no data": show the planet there.
  // Pure grey (land, ice) has almost no saturation; near-zero ocean is a bright cream, so brightness keeps it.
  float hi = max(data.r, max(data.g, data.b));
  float sat = hi - min(data.r, min(data.g, data.b));
  float isData = max(smoothstep(0.018, 0.045, sat), smoothstep(0.74, 0.80, hi));
  // Some frames (A3, GISTEMP) have NASA's coastlines and borders drawn in black. Black is ink, not
  // missing data: keep it, or the planet's ocean shows through as a second, offset coastline.
  // Grey land in the other frames is never this dark (always above 0.24).
  float ink = (1.0 - smoothstep(0.06, 0.24, hi)) * (1.0 - smoothstep(0.03, 0.08, sat));
  isData = max(isData, ink);
  // The NASA date stamp sits in the bottom-left corner of every frame: never paint it on the globe.
  isData *= 1.0 - smoothstep(0.895, 0.905, uvImg.y) * (1.0 - smoothstep(0.14, 0.15, uvImg.x));
  isData *= uDataOn;
  vec3 land = earth * 0.82;
  vec3 col = mix(land, data, isData);

  vec3 n = normalize(vN);
  // Meridians all meet at the poles and get squeezed at the globe's edge: fade them out there
  // so they never bunch into a smear or a jagged sliver.
  float meridianFade = smoothstep(0.0, 0.3, cos(radians(lat))) * smoothstep(0.0, 0.25, n.z);

  // Faint graticule every 30 degrees.
  float gLon = line(15.0 - abs(mod(lon + 180.0, 30.0) - 15.0), 1.0) * meridianFade;
  float gLat = line(15.0 - abs(mod(lat + 90.0, 30.0) - 15.0), 1.0);
  col = mix(col, vec3(1.0), 0.10 * max(gLon, gLat));

  // Scan strip: the 22.5 degree slice being played right now.
  if (uStrip >= 0.0) {
    float c = uLeftLon + (uStrip + 0.5) * 22.5;
    float dd = lonDist(lon, c);
    float inside = 1.0 - smoothstep(10.9, 11.25, dd);
    float edge = line(abs(dd - 11.25), 1.5) * meridianFade;
    col = mix(col, col * 1.18 + 0.06, 0.55 * inside);
    col = mix(col, vec3(1.0), 0.45 * edge);
    // Playhead: where in this strip the music is right now. Its own warm colour, so it stays
    // one clear line when it reaches the strip edge.
    float ph = line(lonDist(lon, uHead), 2.5) * meridianFade;
    col = mix(col, vec3(1.0, 0.9, 0.55), 0.95 * ph);
  }

  // Listening cursor: one 10 degree cell.
  if (uCell.x >= 0.0) {
    float cLon = uLeftLon + (uCell.x + 0.5) * 10.0;
    float cLat = 90.0 - (uCell.y + 0.5) * 10.0;
    float dx = lonDist(lon, cLon), dy = abs(lat - cLat);
    float box = max(dx, dy);
    float ring = line(abs(box - 5.0), 2.0) * step(min(dx, dy), 5.4);
    col = mix(col, vec3(1.0, 0.86, 0.3), 0.95 * ring);
  }

  // Niño 3.4 box: 5S to 5N, 170W to 120W. Glows when the bell rings.
  {
    float dx = lonDist(lon, -145.0), dy = abs(lat);
    float edgeX = line(abs(dx - 25.0), 1.5) * step(dy, 5.3);
    float edgeY = line(abs(dy - 5.0), 1.5) * step(dx, 25.3);
    float dash = step(0.5, fract((lon + lat) / 3.0));
    float e = max(edgeX, edgeY);
    vec3 boxCol = mix(vec3(0.85, 0.95, 1.0), vec3(1.0, 0.95, 0.6), uBell);
    col = mix(col, boxCol, uNinoOn * e * (0.35 + 0.55 * uBell) * mix(dash, 1.0, uBell));
    float inBox = step(dx, 25.0) * step(dy, 5.0);
    col += uNinoOn * inBox * uBell * 0.22 * vec3(1.0, 0.9, 0.5);
  }

  // Soft light from the upper left, never so dark that the data is hard to read.
  vec3 L = normalize(vec3(-0.45, 0.5, 0.75));
  float diff = max(dot(n, L), 0.0);
  float light = 0.62 + 0.48 * diff;
  col *= light;
  // Atmosphere rim.
  float rim = pow(1.0 - max(n.z, 0.0), 2.6);
  col = mix(col, vec3(0.45, 0.75, 1.0), 0.55 * rim);
  gl_FragColor = vec4(col, 1.0);
}`;

  const deg = Math.PI / 180;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const wrap = (x) => ((x % 360) + 540) % 360 - 180;

  function sphere(latSeg, lonSeg) {
    const pos = [], ll = [], idx = [];
    for (let i = 0; i <= latSeg; i++) {
      const lat = 90 - (180 * i) / latSeg;
      for (let j = 0; j <= lonSeg; j++) {
        const lon = -180 + (360 * j) / lonSeg;
        const cl = Math.cos(lat * deg);
        // lon 0 faces the viewer (+z), east is +x.
        pos.push(cl * Math.sin(lon * deg), Math.sin(lat * deg), cl * Math.cos(lon * deg));
        ll.push(lon, lat);
      }
    }
    for (let i = 0; i < latSeg; i++) {
      for (let j = 0; j < lonSeg; j++) {
        const a = i * (lonSeg + 1) + j, b = a + lonSeg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { pos: new Float32Array(pos), ll: new Float32Array(ll), idx: new Uint16Array(idx) };
  }

  // Rotation matrices. yaw turns the globe about its axis, tilt nods it towards the viewer.
  function rotation(yaw, tilt) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    // R = Rx(tilt) * Ry(yaw), column-major
    return [
      cy, st * sy, -ct * sy,
      0, ct, st,
      sy, -st * cy, ct * cy,
    ];
  }

  class Globe {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.onPick = opts.onPick || (() => {});
      this.leftLon = -180;
      this.yaw = -150;       // degrees of longitude facing the viewer
      this.tilt = 12;
      this.targetYaw = null;
      this.spin = true;
      this.strip = -1;
      this.follow = false;   // turn with the scan
      this.clock = opts.clock || (() => performance.now() / 1000);   // the audio clock, in seconds
      this.fps = 24;         // smooth enough, and light on older laptops
      this.nextDraw = 0;
      this.cell = [-1, -1];
      this.bell = 0;
      this.ninoOn = true;   // false for tracks without Niño 3.4 data
      this.mix = 1;
      this.dataOn = true;
      this.scale = 0.9;
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
      if (!gl) throw new Error("WebGL is not available");
      this.gl = gl;
      this.init();
      this.bind();
      this.last = performance.now();
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    }

    init() {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      const deriv = gl.getExtension("OES_standard_derivatives");
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, (deriv ? FRAG_DERIV : "") + FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      gl.useProgram(p);
      this.prog = p;
      const m = sphere(96, 192);
      this.count = m.idx.length;
      const buf = (data, attr, size) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(p, attr);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      buf(m.pos, "aPos", 3);
      buf(m.ll, "aLL", 2);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      this.u = {};
      for (const n of ["uMVP", "uRot", "uData0", "uData1", "uEarth", "uMix", "uLeftLon", "uStrip", "uHead", "uCell", "uBell", "uNinoOn", "uDataOn", "uPx"]) this.u[n] = gl.getUniformLocation(p, n);
      this.tex = [this.texture(), this.texture(), this.texture()];
      gl.uniform1i(this.u.uData0, 0); gl.uniform1i(this.u.uData1, 1); gl.uniform1i(this.u.uEarth, 2);
      gl.enable(gl.DEPTH_TEST);
    }

    texture() {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([42, 47, 56, 255]));
      return t;
    }

    upload(slot, img, mips = false) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + slot);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[slot]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const pot = (n) => (n & (n - 1)) === 0;
      if (mips && pot(img.width) && pot(img.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    setEarth(img) { this.upload(2, img, true); }

    // New data frame: the old one stays in slot 0 and fades out.
    setFrame(img) {
      if (img === this.current) return;
      const gl = this.gl;
      if (this.current) {
        [this.tex[0], this.tex[1]] = [this.tex[1], this.tex[0]];
        this.upload(1, img);
        this.mix = this.reduced.matches ? 1 : 0;
      } else {
        this.upload(0, img); this.upload(1, img); this.mix = 1;
      }
      this.current = img;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[0]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex[1]);
    }

    ringBell() { this.bell = 1; }
    // The music reached strip s at audio time `at` (seconds on this.clock); it lasts `seconds`.
    // The playhead glides through it on the audio clock, so it matches what you hear even if frames bunch up.
    step(s, seconds, at) {
      this.strip = s;
      this.stepDur = seconds;
      this.stepAt = typeof at === "number" ? at : this.clock();
    }
    // Playhead position in strips (0..16), or -1 when nothing is being scanned.
    head() {
      if (this.strip < 0) return -1;
      if (this.reduced.matches || !this.stepDur) return this.strip + 0.5;
      // Up to two strips ahead: if the page stalls and a step callback is dropped, keep following the audio.
      return this.strip + clamp((this.clock() - this.stepAt) / this.stepDur, 0, 2);
    }
    lookAt(lon, lat) {
      this.targetYaw = lon;
      if (typeof lat === "number") this.targetTilt = clamp(lat, -60, 60);
    }

    bind() {
      const c = this.canvas;
      let down = null;
      c.addEventListener("pointerdown", (e) => {
        down = { x: e.clientX, y: e.clientY, yaw: this.yaw, tilt: this.tilt, moved: false };
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener("pointermove", (e) => {
        if (!down) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 4) down.moved = true;
        if (!down.moved) return;
        const k = 180 / Math.max(200, c.clientWidth);
        this.yaw = wrap(down.yaw - dx * k);
        this.tilt = clamp(down.tilt + dy * k, -60, 60);
        this.targetYaw = null; this.targetTilt = null;
        this.idleUntil = performance.now() + 4000;
      });
      const up = (e) => {
        if (!down) return;
        if (!down.moved) {
          const hit = this.pick(e.clientX, e.clientY);
          if (hit) this.onPick(hit);
        }
        down = null;
      };
      c.addEventListener("pointerup", up);
      c.addEventListener("pointercancel", () => { down = null; });
    }

    // Screen point to longitude / latitude, or null if it misses the globe.
    pick(x, y) {
      const r = this.canvas.getBoundingClientRect();
      const s = Math.min(r.width, r.height) * this.scale / 2;
      const nx = (x - r.left - r.width / 2) / s, ny = -(y - r.top - r.height / 2) / s;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) return null;
      const v = [nx, ny, Math.sqrt(1 - d2)];
      const R = rotation(-this.yaw * deg, this.tilt * deg);
      // Inverse rotation = transpose. R is column-major: column k = R[3k..3k+2].
      const p = [0, 1, 2].map((k) => R[3 * k] * v[0] + R[3 * k + 1] * v[1] + R[3 * k + 2] * v[2]);
      const lat = Math.asin(clamp(p[1], -1, 1)) / deg;
      const lon = Math.atan2(p[0], p[2]) / deg;
      return { lon, lat };
    }

    resize() {
      const c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.gl.viewport(0, 0, w, h);
      return [w, h];
    }

    loop(now) {
      this.raf = requestAnimationFrame(this.loop);
      if (document.hidden) { this.last = now; return; }
      // Draw at about this.fps, whatever the screen's refresh rate.
      if (now + 3 < this.nextDraw) return;
      const frameMs = 1000 / this.fps;
      this.nextDraw = this.nextDraw + frameMs < now ? now + frameMs : this.nextDraw + frameMs;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const still = this.reduced.matches;
      const h = this.head();
      this.headPos = h;
      this.headLon = h < 0 ? 999 : this.leftLon + h * 22.5;
      if (this.follow && h >= 0) {
        // Turn at the scan's own speed, plus a gentle pull to stay centred: steady, no hops.
        const diff = wrap(this.headLon - this.yaw);
        const moving = !still && h < this.strip + 2 ? 22.5 / this.stepDur : 0;
        this.yaw = still ? wrap(this.headLon) : wrap(this.yaw + moving * dt + diff * Math.min(1, dt * 5));
        this.targetYaw = this.yaw;   // stay here when the music stops
      } else if (this.targetYaw !== null && this.targetYaw !== undefined) {
        const diff = wrap(this.targetYaw - this.yaw);
        this.yaw = wrap(this.yaw + (still ? diff : diff * Math.min(1, dt * 4)));
        if (Math.abs(diff) < 0.05) this.yaw = this.targetYaw;
      } else if (this.spin && !still && !(this.idleUntil > now)) {
        this.yaw = wrap(this.yaw + dt * 7);
      }
      if (typeof this.targetTilt === "number") {
        const d = this.targetTilt - this.tilt;
        this.tilt += still ? d : d * Math.min(1, dt * 4);
      }
      this.mix = Math.min(1, this.mix + dt * 4);
      this.bell = Math.max(0, this.bell - dt * 0.9);
      this.draw();
    }

    draw() {
      const gl = this.gl;
      const [w, h] = this.resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.scale = 0.9;
      const sx = this.scale * Math.min(w, h) / w, sy = this.scale * Math.min(w, h) / h;
      const R = rotation(-this.yaw * deg, this.tilt * deg);
      // Orthographic projection; z flipped into clip space so the near side wins.
      const mvp = new Float32Array([
        R[0] * sx, R[1] * sy, -R[2] * 0.5, 0,
        R[3] * sx, R[4] * sy, -R[5] * 0.5, 0,
        R[6] * sx, R[7] * sy, -R[8] * 0.5, 0,
        0, 0, 0, 1,
      ]);
      gl.uniformMatrix4fv(this.u.uMVP, false, mvp);
      gl.uniformMatrix3fv(this.u.uRot, false, new Float32Array(R));
      gl.uniform1f(this.u.uMix, this.mix);
      gl.uniform1f(this.u.uLeftLon, this.leftLon);
      // The lit strip is the one under the playhead (the same as this.strip unless a step callback was dropped).
      gl.uniform1f(this.u.uStrip, this.strip < 0 ? -1 : Math.floor(this.headPos) % 16);
      gl.uniform1f(this.u.uHead, this.headLon === undefined ? 999 : this.headLon);
      gl.uniform2f(this.u.uCell, this.cell[0], this.cell[1]);
      gl.uniform1f(this.u.uBell, this.bell);
      gl.uniform1f(this.u.uNinoOn, this.ninoOn ? 1 : 0);
      gl.uniform1f(this.u.uDataOn, this.dataOn ? 1 : 0);
      gl.uniform1f(this.u.uPx, w / Math.max(1, this.canvas.clientWidth));
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }

    destroy() { cancelAnimationFrame(this.raf); }
  }

  window.Globe = Globe;
})();
