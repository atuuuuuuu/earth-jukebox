"""Track 06 — Air quality (GEOS-CF, July-August 2024): four pollutants on one flat map, in sliding strips.

We read NASA's wide Earth Information Center version (3840 x 1080): a fixed flat world map, 6 px per
degree, 180 W at the left edge and 90 N at the top, drawn once and then repeated, so it covers 640
degrees and every longitude appears at least once. Over it, vertical strips 500 px wide each show one
pollutant, in a repeating order: nitrogen oxides, ozone, carbon monoxide, fine particles. The strips
slide, so every place passes under every pollutant during the movie.

For each frame we find where the strips are (the green nitrogen-oxides strip is easy to see), read
each pixel's level from its pollutant's colour scale, and add it to that pollutant's map. Strip
edges and the label boxes are skipped. The result: one full world map per pollutant, averaged over
the summer, on a 3-degree grid, plus a picture of each.
"""
from __future__ import annotations

import cv2
import numpy as np

from ..config import MEDIA_DIR, source_path
from ..lib import grid, video

POLLUTANTS = ["nox", "o3", "co", "pm"]           # left-to-right order of the strips, from the green one


def level(bgr: np.ndarray, kind: str) -> np.ndarray:
    """0..1: where a pixel sits on its pollutant's colour scale (0 = cleanest end, 1 = dirtiest)."""
    f = bgr.astype(np.float32)
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    if kind in ("co", "pm"):                     # yellow or cream -> orange -> red or brown -> dark
        return np.clip((1 - (0.6 * g + 0.4 * r) / 255) / 0.85, 0, 1)
    if kind == "o3":                             # grey -> lavender -> deep purple
        return np.clip((b - g - 15) / 145, 0, 1)
    # nitrogen oxides: black -> grey -> white (low), then light -> dark green (high)
    green = g - np.maximum(r, b)
    lum = (r + g + b) / 3
    return np.where(green < 15, 0.3 * lum / 255, 0.3 + 0.7 * np.clip((255 - g) / 195, 0, 1))


def strip_phase(frame: np.ndarray, width: int, rows: slice) -> tuple[int, float]:
    """x of the left edge of a nitrogen-oxides (green) strip, modulo the 4-strip period, and how
    clearly the strips show (about 1 for a clear frame, near 0 for a title card)."""
    f = frame[rows].astype(np.int16)
    green = np.median((f[..., 1] - np.maximum(f[..., 0], f[..., 2])) > 30, axis=0).astype(np.float64)
    period = 4 * width
    n = len(green) // period * period
    prof = green[:n].reshape(-1, period).mean(axis=0)            # folded onto one period
    window = np.convolve(np.r_[prof, prof[: width - 1]], np.ones(width), "valid") / width
    p = int(np.argmax(window))
    return p, float(window[p] - (prof.sum() - window[p] * width) / (period - width))


def fold(a: np.ndarray, full_w: int) -> np.ndarray:
    """Add the columns of a map wider than the world back onto one 360-degree map."""
    out = np.zeros(a.shape[:1] + (full_w,) + a.shape[2:], a.dtype)
    for x0 in range(0, a.shape[1], full_w):
        part = a[:, x0 : x0 + full_w]
        out[:, : part.shape[1]] += part
    return out


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    geo, ex, md = cfg["geometry"], cfg["extraction"], cfg["media"]
    W, H = geo["work"]                           # 3840 x 1080: 6 px per degree, the world 1.8 times
    ppd = geo["px_per_deg"]
    full_w = int(round(360 * ppd))               # 2160: the whole world
    cell = int(round(ex["cell_deg"] * ppd))      # 18 px
    rows, cols = H // cell, full_w // cell       # 60 x 120
    width, guard = ex["strip_width"], ex["edge_guard"]
    lab_y0, lab_y1, lab_hw = ex["label_box"]     # label boxes: rows y0..y1, centre +- hw
    xs = np.arange(W)
    picks = list(range(0, info["frames"], ex["sample_every"]))

    sums = np.zeros((4, rows, cols)); counts = np.zeros((4, rows, cols))
    rgb = np.zeros((4, H, full_w, 3), np.float32); hits = np.zeros((4, H, full_w), np.float32)
    phases, skipped = [], 0
    for k, (i, frame) in enumerate(video.iter_frames(path, picks)):
        small = frame if frame.shape[1] == W else cv2.resize(frame, (W, H), interpolation=cv2.INTER_AREA)
        phase, clear = strip_phase(small, width, slice(int(H * 0.08), int(H * 0.7)))
        if clear < ex["min_clear"]:              # a fade or title card: no strips to read
            skipped += 1
            continue
        phases.append(phase)
        pos = (xs - phase) % (4 * width)
        kind = (pos // width).astype(int)        # 0 nox, 1 o3, 2 co, 3 pm
        inner = pos % width
        ok_x = (inner > guard) & (inner < width - guard)
        label_x = np.abs(inner - width / 2) < lab_hw
        for p, name in enumerate(POLLUTANTS):
            m = np.broadcast_to(ok_x & (kind == p), (H, W)).copy()
            m[lab_y0:lab_y1] &= ~label_x[None, :]
            v = fold(level(small, name) * m, full_w)
            mf = fold(m.astype(np.float32), full_w)
            sums[p] += grid.pool(v, rows, cols, "sum")
            counts[p] += grid.pool(mf, rows, cols, "sum")
            rgb[p] += fold(small.astype(np.float32) * m[..., None], full_w)
            hits[p] += mf
        if k % 100 == 0:
            print(f"  frame {i}/{info['frames']}, strips at {phase:.0f} px")

    speed = np.median(np.diff(np.unwrap(np.array(phases) / (4 * width) * 2 * np.pi))) * 4 * width / (2 * np.pi)
    print(f"  strips move {speed / ex['sample_every'] * info['fps']:.1f} px per second; {skipped} frames skipped (no strips)")
    seen = counts >= ex["min_pixels"]
    mean = np.where(seen, sums / np.maximum(counts, 1), np.nan)
    print("  cells with a reading:", [f"{n} {seen[p].mean():.0%}" for p, n in enumerate(POLLUTANTS)])

    out_dir = MEDIA_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.webp"):
        old.unlink()
    frames = []
    names = {n["id"]: n for n in cfg["pollutants"]}
    for p in [POLLUTANTS.index(n["id"]) for n in cfg["pollutants"]]:
        name = POLLUTANTS[p]
        avg = rgb[p] / np.maximum(hits[p], 1)[..., None]
        img = np.where(hits[p][..., None] > 0, avg, 40).astype(np.uint8)   # dark grey: never seen
        img = cv2.resize(img, (md["width"], md["height"]), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out_dir / f"{name}.webp"), img, [cv2.IMWRITE_WEBP_QUALITY, md["webp_quality"]])
        v = np.nan_to_num(mean[p], nan=0.0)
        n = names[name]
        frames.append({
            "label": n["title"],
            "image": f"media/{cfg['id']}/{name}.webp",
            "alt": n["alt"],
            "span": cfg["time"]["span"],
            "total": round(float(v.sum()), 4),
            "core": grid.to_ints(v),
            "glow": grid.to_ints(v),
            "missing": [int(j) for j in np.flatnonzero(~seen[p].ravel())],
        })
    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "moving-sweep",
        "source": cfg["source"],
        "grid": {"cols": cols, "rows": rows, "lonWest": -180, "latNorth": 90, "cellDeg": ex["cell_deg"]},
        "chapters": [{"id": "pollutants", "title": "Air quality, pollutant by pollutant",
                      "secondsPerSweep": cfg["playback"]["seconds_per_sweep"], "frames": frames}],
        "crossfade": 0.6,
        "legend": cfg["legend"],
    }


if __name__ == "__main__":                       # self-check of the colour scales, strips and folding
    px = lambda r, g, b: np.array([[[b, g, r]]], np.uint8)
    assert level(px(255, 231, 129), "co") < 0.1 < 0.6 < level(px(189, 11, 13), "co")
    assert level(px(255, 250, 208), "pm") < 0.05 and level(px(210, 90, 10), "pm") > 0.4
    assert level(px(34, 34, 34), "nox") < level(px(161, 161, 161), "nox") < level(px(150, 230, 150), "nox") < level(px(27, 149, 27), "nox")
    assert level(px(139, 136, 163), "o3") < 0.15 < 0.5 < level(px(143, 120, 220), "o3")
    test = np.zeros((10, 4000, 3), np.uint8)
    test[:, 700:1200] = (40, 200, 40)            # BGR green strips at 700 and 2700 (period 2000)
    test[:, 2700:3200] = (40, 200, 40)
    assert strip_phase(test, 500, slice(0, 10)) == (700, 1.0), strip_phase(test, 500, slice(0, 10))
    assert fold(np.ones((1, 3840)), 2160).tolist()[0][:1680] == [2.0] * 1680
    assert fold(np.ones((1, 3840)), 2160).tolist()[0][1680:] == [1.0] * 480
    print("colour scales, strips and folding ok")
