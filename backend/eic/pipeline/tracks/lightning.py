"""Track 07 — Lightning from the ISS: a flat world map video -> lightning grids for equal parts of it, in order.

NASA's Science On a Sphere movie is equirectangular, so the frame *is* the map. Each frame shows the
strikes of a 10-day window as yellow dots on a grey base map. The movie has no date label and does not
run at an even speed (the storms' yearly swing north and south takes 650 to 1260 frames), so we never
guess dates: we cut the part of the movie that shows lightning into equal parts, in order, and average
how yellow each place is over each part, on a 3-degree grid.
"""
from __future__ import annotations

import cv2
import numpy as np

from ..config import MEDIA_DIR, source_path
from ..lib import grid, video



def strike_value(bgr: np.ndarray, ex: dict) -> np.ndarray:
    """0..1 per pixel: how much this pixel is a yellow strike. Grey land, black ocean and the
    white tropic lines are neutral (R, G and B close), so they score 0."""
    f = bgr.astype(np.float32)
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    y = np.clip(((r + g) / 2 - b - ex["yellow_lo"]) / (ex["yellow_hi"] - ex["yellow_lo"]), 0, 1)
    return y * (r >= ex["red_min"])


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    tm, ex, md = cfg["time"], cfg["extraction"], cfg["media"]
    rows, cols = ex["grid"]["rows"], ex["grid"]["cols"]
    work = tuple(ex["work"])
    disp = (md["width"], md["height"])
    n, parts = info["frames"], tm["parts"]
    picks = list(range(0, n, tm["sample_every"]))

    # Pass 1: where the lightning starts and ends (the movie fades in and out).
    totals = {}
    for i, frame in video.iter_frames(path, picks[::5]):
        totals[i] = float(strike_value(cv2.resize(frame, (512, 256), interpolation=cv2.INTER_AREA), ex).sum())
    lit = [i for i, t in totals.items() if t > 0.05 * max(totals.values())]
    first, last = min(lit), max(lit) + tm["sample_every"] * 5
    part_of = lambda i: min(parts - 1, (i - first) * parts // max(1, last - first))
    print(f"  lightning shows from frame {first} to {last}; {parts} parts of {(last - first) // parts} frames")

    cell = np.zeros((parts, rows, cols), np.float64)  # summed strike value per part and cell
    count = np.zeros(parts, np.int64)
    dens = np.zeros((parts, disp[1], disp[0]), np.float32)
    base = None
    for k, (i, frame) in enumerate(video.iter_frames(path, [i for i in picks if first <= i < last])):
        m = part_of(i)
        small = cv2.resize(frame, work, interpolation=cv2.INTER_AREA)
        cell[m] += grid.pool(strike_value(small, ex), rows, cols, "mean")
        d = cv2.resize(frame, disp, interpolation=cv2.INTER_AREA)
        dens[m] += strike_value(d, ex)
        # The base map without strikes: the darkest each pixel ever is.
        base = d if base is None else np.minimum(base, d)
        count[m] += 1
        if k % 200 == 0:
            print(f"  frame {i}/{n}, part {m + 1}")

    mean = cell / np.maximum(count, 1)[:, None, None]
    scale = float(np.percentile(mean[mean > 0], 99.5))
    norm = np.clip(mean / scale, 0, 1)
    dens /= np.maximum(count, 1)[:, None, None]
    dscale = float(np.percentile(dens[dens > 0], 99.7))
    print(f"  samples per part {count.tolist()}; cell scale {scale:.4f}; image scale {dscale:.4f}")

    out_dir = MEDIA_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    yellow = np.array([0, 214, 255], np.float32)      # BGR, NASA's strike colour
    frames = []
    for old in out_dir.glob("*.webp"):
        old.unlink()
    for m in range(parts):
        a = np.clip(dens[m] / dscale, 0, 1)[..., None] ** 0.6
        img = (base.astype(np.float32) * (1 - a) + yellow * a).astype(np.uint8)
        name = f"part-{m + 1:02d}"
        cv2.imwrite(str(out_dir / f"{name}.webp"), img, [cv2.IMWRITE_WEBP_QUALITY, md["webp_quality"]])
        north = float(mean[m][: rows // 2].sum())
        share = north / max(float(mean[m].sum()), 1e-9)
        frames.append({
            "label": f"Part {m + 1} of {parts}",
            "image": f"media/{cfg['id']}/{name}.webp",
            "alt": f"World map of lightning, part {m + 1} of {parts} of NASA's record from {tm['span']}: "
                   f"yellow where lightning was seen, {'mostly north' if share > 0.6 else 'mostly south' if share < 0.4 else 'on both sides'} of the equator.",
            "span": tm["span"],
            "north": round(share, 3),
            "total": round(float(mean[m].sum()), 4),
            "core": grid.to_ints(norm[m]),
            "glow": grid.to_ints(norm[m]),
        })

    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "moving-sweep",
        "source": cfg["source"],
        "grid": {"cols": cols, "rows": rows, "lonWest": -180, "latNorth": 90, "cellDeg": 360 / cols},
        "chapters": [{"id": "parts", "title": "Lightning, in order",
                      "secondsPerSweep": cfg["playback"]["seconds_per_sweep"], "frames": frames}],
        "crossfade": 0.6,
        "legend": cfg["legend"],
    }
