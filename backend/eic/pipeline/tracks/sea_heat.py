"""Track 02 — Sea surface currents and temperature (NASA SVS 3912): flow-line colours -> degrees C.

NASA's flat movie draws the ocean's surface currents as thin flow lines, coloured by the sea surface
temperature on a key from blue (0 C) through green and yellow to red (32 C), over a black sea and
grey land. Every colour is read back to degrees on that key:

  1. The key image is sampled into 129 colours, one every 0.25 C.
  2. A lookup table over every colour (64 levels per channel) says which ones are flow lines and
     their temperature: bright, strongly coloured, and, brightness set aside (a fading line keeps its
     hue), close in Lab to a key colour. Grey land, white ice and the black sea between lines are
     not. Each frame is then a single table lookup.
  3. Every 10th frame (3 a second), each flow-line pixel adds its temperature to its 3-degree cell.
     The movie is cut into equal quarters (NASA's own per-frame dates name them); a cell's
     temperature for a quarter is the median of all its readings, in 0.25 C steps.

Debug output (backend/eic/debug/02_sea_heat/): each quarter's grid redrawn with NASA's own key
next to NASA's frame, and a print of known places (warm pool, Southern Ocean, Gulf Stream ...).
"""
from __future__ import annotations

from datetime import datetime

import cv2
import numpy as np

from ..config import DEBUG_DIR, MEDIA_DIR, RESOURCES, WEB_DIR, source_path
from ..lib import colorkey, video

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
LEVELS = 64                                   # lookup table: levels per colour channel


def key_colours(path, v0: float, v1: float, n: int) -> tuple[np.ndarray, np.ndarray]:
    """n colours along NASA's key image (BGR float) and their values, left (v0) to right (v1).

    The bar is the widest band of opaque rows; its thin dark border is trimmed off."""
    k = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    alpha = k[..., 3] if k.shape[2] == 4 else np.full(k.shape[:2], 255, np.uint8)
    rows = np.where((alpha > 200).mean(axis=1) > 0.6)[0]
    y0, y1 = rows.min(), rows.max() + 1
    inset = max(2, (y1 - y0) // 4)
    band = k[y0 + inset : y1 - inset, :, :3].astype(np.float32)       # the middle rows: no border
    lit = (alpha[y0 + inset : y1 - inset] > 200).all(axis=0) & (band.max(axis=2).min(axis=0) > 120)
    cols = np.where(lit)[0]
    x0, x1 = cols.min() + 1, cols.max()                # one pixel in from each edge
    strip = band[:, x0:x1].mean(axis=0)
    xs = np.linspace(0, strip.shape[0] - 1, n).round().astype(int)
    return strip[xs], np.linspace(v0, v1, n, dtype=np.float32)


def colour_table(key_bgr: np.ndarray, key_vals: np.ndarray, ex: dict) -> np.ndarray:
    """Temperature (C) for every colour on a LEVELS^3 grid of BGR, or NaN when it is not a flow line."""
    q = (np.arange(LEVELS, dtype=np.float32) + 0.5) * (256 / LEVELS)
    b, g, r = np.meshgrid(q, q, q, indexing="ij")
    bgr = np.stack([b, g, r], axis=-1).reshape(-1, 3)
    hi, lo = bgr.max(axis=1), bgr.min(axis=1)
    ok = (hi >= ex["min_bright"]) & ((hi - lo) / np.maximum(hi, 1) >= ex["min_sat"])
    key_lab = colorkey.bgr_to_lab(colorkey.normalise_brightness(key_bgr))
    lab = colorkey.bgr_to_lab(colorkey.normalise_brightness(bgr[ok]))
    t, _ = colorkey.match(lab, key_lab, key_vals, ex["max_key_distance"])
    out = np.full(bgr.shape[0], np.nan, np.float32)
    out[ok] = t
    return out


def decode(frame: np.ndarray, table: np.ndarray) -> np.ndarray:
    """Per-pixel temperature (C) of a BGR frame, NaN where there is no flow line."""
    q = (frame >> int(np.log2(256 // LEVELS))).astype(np.int32)
    return table[(q[..., 0] * LEVELS + q[..., 1]) * LEVELS + q[..., 2]]


def read_dates(path) -> list[datetime]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) >= 2:
            out.append(datetime.strptime(parts[1], "%Y-%m-%dT%H:%MZ"))
    return out


def span(a: datetime, b: datetime) -> str:
    """'25 March to 13 June 2007', '21 November 2007 to 3 March 2008'."""
    first = f"{a.day} {MONTHS[a.month - 1]}" + ("" if a.year == b.year else f" {a.year}")
    return f"{first} to {b.day} {MONTHS[b.month - 1]} {b.year}"


def alignment(frame: np.ndarray) -> tuple[int, float]:
    """Best horizontal shift (in pixels) of the movie's grey land against the Blue Marble's land."""
    bm = cv2.imread(str(WEB_DIR / "textures" / "blue-marble.jpg"))
    h, w = frame.shape[:2]
    bm = cv2.resize(bm, (w, h), interpolation=cv2.INTER_AREA).astype(np.int16)
    land_bm = ~((bm[..., 0] > bm[..., 2] + 8) & (bm[..., 0] > bm[..., 1] - 5) & (bm[..., 2] < 90))
    f = frame.astype(np.int16)
    hi, lo = f.max(axis=2), f.min(axis=2)
    land_mv = (hi - lo < 18) & (hi > 45)                       # grey relief, not the black sea
    band = slice(h // 6, 5 * h // 6)                           # leave out the ice caps
    a, b = land_mv[band].astype(np.float32), land_bm[band].astype(np.float32)
    scores = {s: float((np.roll(a, s, axis=1) * b).mean()) for s in range(-24, 25, 2)}
    best = max(scores, key=scores.get)
    return best, scores[best] / max(1e-9, scores[0])


def mean_box(t: np.ndarray, lat: tuple[float, float], lon: tuple[float, float], deg: float) -> tuple[float, int]:
    """Area-weighted mean temperature of the cells read inside a box, and how many were read."""
    rows, cols = t.shape
    vals, wts = [], []
    for r in range(rows):
        la = 90 - (r + 0.5) * deg
        if not lat[0] <= la <= lat[1]:
            continue
        for c in range(cols):
            lo = -180 + (c + 0.5) * deg
            if lon[0] <= lo <= lon[1] and not np.isnan(t[r, c]):
                vals.append(t[r, c]); wts.append(np.cos(np.radians(la)))
    return (float(np.average(vals, weights=wts)) if vals else float("nan")), len(vals)


# Known places to check by eye (and in the tests): (name, lat range, lon range).
CHECKS = [
    ("West Pacific warm pool", (-5, 10), (130, 165)),
    ("Indian Ocean, equator", (-10, 5), (55, 90)),
    ("Equatorial east Pacific (cold tongue)", (-3, 3), (-130, -95)),
    ("Equatorial west Pacific, same latitudes", (-3, 3), (140, 175)),
    ("Gulf Stream, off the United States", (33, 40), (-76, -66)),
    ("North Atlantic drift, toward Europe", (45, 55), (-35, -15)),
    ("Same latitude, North Pacific", (45, 55), (-175, -150)),
    ("Southern Ocean", (-65, -55), (-180, 180)),
    ("Arctic Ocean", (78, 90), (-180, 180)),
]


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    ex, md, kc = cfg["extraction"], cfg["media"], cfg["key"]
    rows, cols = ex["grid"]["rows"], ex["grid"]["cols"]
    W, H = info["width"], info["height"]
    deg = 360 / cols
    if W != 2 * H or round(360 / cols, 6) != round(180 / rows, 6):
        raise SystemExit(f"{W}x{H} is not a 2:1 world map for a {cols}x{rows} grid")

    key_bgr, key_vals = key_colours(RESOURCES / cfg["source"]["key"], kc["values"][0], kc["values"][1], kc["samples"])
    print(f"  key: {len(key_vals)} colours, {key_bgr[0].round().tolist()} (0 C) -> {key_bgr[-1].round().tolist()} (32 C)")
    table = colour_table(key_bgr, key_vals, ex)
    print(f"  colour table: {np.isfinite(table).mean() * 100:.1f} % of colours are flow lines")

    dates = read_dates(RESOURCES / cfg["source"]["dates"]) if cfg["source"].get("dates") else []
    n = info["frames"]
    if dates and len(dates) != n:
        raise SystemExit(f"{len(dates)} dates for {n} frames: wrong dates file?")

    # Each pixel's cell, and the quarters of the movie.
    ys, xs = np.mgrid[0:H, 0:W]
    shift = int(round((cfg["geometry"]["lon_at_x0"] + 180) / 360 * W))
    cell = ((ys * rows) // H) * cols + (((xs + shift) % W) * cols) // W
    nb = len(key_vals)
    sweeps, every = ex["sweeps"], ex["every"]
    bounds = [round(k * n / sweeps) for k in range(sweeps + 1)]
    hist = np.zeros((sweeps, rows * cols * nb), np.int64)
    middles = {(bounds[k] + bounds[k + 1]) // 2: k for k in range(sweeps)}
    wanted = set(range(0, n, every)) | set(middles)
    stills, align = {}, None
    step = (kc["values"][1] - kc["values"][0]) / (nb - 1)
    for i, frame in video.iter_frames(path, wanted):
        k = min(sweeps - 1, next(j for j in range(sweeps) if i < bounds[j + 1]))
        if i in middles:
            stills[middles[i]] = frame
            if align is None:
                align = alignment(frame)
        if i % every:
            continue
        t = decode(frame, table)
        ok = np.isfinite(t)
        b = np.rint((t[ok] - kc["values"][0]) / step).astype(np.int64)
        hist[k] += np.bincount(cell[ok] * nb + b, minlength=rows * cols * nb)
        if i % 400 == 0:
            print(f"  frame {i}/{n}: {ok.mean() * 100:.1f} % flow-line pixels")
    print(f"  land against the Blue Marble: best shift {align[0]} px (ratio {align[1]:.2f}); 0 = map edges right")
    if align[0] != 0:
        raise SystemExit("The movie's land does not line up with the Blue Marble: check geometry.lon_at_x0")

    # Median per cell and quarter, in 0.25 C steps; too few readings = no reading.
    hist = hist.reshape(sweeps, rows * cols, nb)
    count = hist.sum(axis=2)
    cum = hist.cumsum(axis=2)
    med = (cum >= (count[..., None] + 1) // 2).argmax(axis=2) * step + kc["values"][0]
    temps = np.where(count >= ex["min_pixels"], med, np.nan).reshape(sweeps, rows, cols).astype(np.float32)
    print(f"  cells read: {[round(float(np.isfinite(t).mean()) * 100, 1) for t in temps]} % per quarter")

    out_dir, dbg = MEDIA_DIR / cfg["id"], DEBUG_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    dbg.mkdir(parents=True, exist_ok=True)
    frames = []
    for k in range(sweeps):
        a, b = bounds[k], bounds[k + 1] - 1
        label = span(dates[a], dates[b]) if dates else f"Sweep {k + 1} of {sweeps}"
        image = f"media/{cfg['id']}/sweep-{k + 1}.webp"
        cv2.imwrite(str(WEB_DIR / image), cv2.resize(stills[k], (md["width"], md["height"]), interpolation=cv2.INTER_AREA),
                    [cv2.IMWRITE_WEBP_QUALITY, md["webp_quality"]])
        print(f"  sweep {k + 1}: {label}")
        for name, la, lo in CHECKS:
            v, m = mean_box(temps[k], la, lo, deg)
            print(f"      {name:<42} {v:5.1f} C  ({m} cells)")
        # Debug: NASA's frame above, our grid redrawn with NASA's key below.
        idx = np.nan_to_num(np.rint((temps[k] - kc["values"][0]) / step), nan=0)
        lut = key_bgr[np.clip(idx, 0, nb - 1).astype(int)]
        redraw = np.where(np.isnan(temps[k])[..., None], 40, lut).astype(np.uint8)
        redraw = cv2.resize(redraw, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST)
        top = cv2.resize(stills[k], (W // 2, H // 2), interpolation=cv2.INTER_AREA)
        for img, text in ((top, f"NASA, {label}"), (redraw, "read back to C, 3 degree cells, NASA's key")):
            cv2.putText(img, text, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.imwrite(str(dbg / f"sweep-{k + 1}.png"), np.vstack([top, redraw]))
        frames.append({
            "label": label,
            "from": dates[a].date().isoformat() if dates else None,
            "to": dates[b].date().isoformat() if dates else None,
            "image": image,
            "alt": (f"NASA's world map of the ocean's surface currents, {label}, drawn as flow lines coloured by "
                    "temperature: red and orange in the warm tropics, yellow and green in between, blue near the poles, "
                    "on grey land."),
            # Degrees C, one decimal, row 0 = north; null = no flow line drawn there (land, ice).
            "temp": [None if np.isnan(v) else round(float(v), 2) for v in temps[k].ravel()],
        })
    print(f"  debug images: {dbg}")

    snd = cfg["sound"]
    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "latitude-sweep",
        "source": {k: v for k, v in cfg["source"].items()},
        "grid": {"cols": cols, "rows": rows, "lonWest": -180, "latNorth": 90, "cellDeg": deg},
        "units": "degrees C",
        "key": {"values": kc["values"], "bgr": key_bgr[:: max(1, (nb - 1) // 32)].round().astype(int).tolist()},
        "voices": snd["voices"],
        "chapters": [{"id": "sweeps", "title": "The ocean's surface, a quarter of a year per sweep",
                      "secondsPerSweep": snd["seconds_per_sweep"], "frames": frames}],
        "crossfade": 0.6,
        "legend": cfg["legend"],
    }
