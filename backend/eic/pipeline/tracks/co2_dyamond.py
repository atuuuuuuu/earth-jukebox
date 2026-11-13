"""Track 06 — DYAMOND CO2 on a rotating globe: spin sweep along the central meridian."""
from __future__ import annotations

from datetime import datetime, timedelta

import cv2
import numpy as np

from ..config import MEDIA_DIR, source_path
from ..lib import spin, transcode, video

REGIONS = [  # (west limit of the band, name); the scan runs east -> west
    (100, "East Asia, Southeast Asia and Australia"),
    (60, "South Asia and the Indian Ocean"),
    (10, "Africa and the Middle East"),
    (-30, "West Africa and the Atlantic Ocean"),
    (-180, "South America and the western Atlantic"),
]


def co2_value(bgr: np.ndarray, ex: dict) -> np.ndarray:
    """Relative CO2 level 0..1 from colour: transparent -> tan -> orange -> red.

    The base globe is neutral grey (deserts, ice) or near-black (ocean); CO2 is a warm,
    saturated overlay. Warmth (R-B) times a saturation gate separates the two.
    """
    f = bgr.astype(np.float32)
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    mx = f.max(axis=-1)
    sat = (mx - f.min(axis=-1)) / np.maximum(mx, 1.0)
    gate = np.clip((sat - ex["sat_lo"]) / (ex["sat_hi"] - ex["sat_lo"]), 0, 1)
    warmth = np.clip(r - b, 0, None) / 255.0
    # orange (g about r/2) -> red (g about r/5): redder = more
    redness = np.clip(1.0 - (g - b) / np.maximum(r - b, 1.0) * 1.6, 0, 1)
    return np.power(warmth * gate, ex["gamma"]) * (0.8 + 0.2 * redness)


def region_for(lon: float) -> str:
    for west, name in REGIONS:
        if lon >= west:
            return name
    return REGIONS[-1][1]


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    geom, ex, tm, md = cfg["geometry"], cfg["extraction"], cfg["time"], cfg["media"]
    rows, fps_step = ex["rows"], tm["frames_per_step"]
    cx, hw = geom["cx"], geom["half_width"]
    edges = spin.row_edges_px(geom["cy"], geom["radius"], ex["lat_top"], ex["lat_step"], rows, geom["lat0"])
    y0, y1 = int(np.floor(edges[0])), int(np.ceil(edges[-1])) + 1

    steps = info["frames"] // fps_step
    mean = np.zeros((steps, rows), np.float32)
    peak = np.zeros((steps, rows), np.float32)
    crop = lambda f: f[y0:y1, cx - hw : cx + hw + 1]
    for i, strip in video.iter_frames(path, range(steps * fps_step), crop):
        m, p = spin.pool_rows(co2_value(strip, ex), edges, y0)
        mean[i // fps_step] += m / fps_step
        peak[i // fps_step] = np.maximum(peak[i // fps_step], p)

    k = ex["smooth_steps"]
    if k:
        kernel = np.ones(2 * k + 1, np.float32) / (2 * k + 1)
        mean = np.apply_along_axis(lambda v: np.convolve(np.pad(v, k, mode="edge"), kernel, "valid"), 0, mean)

    scale = float(np.percentile(peak, 99.8))
    mean = np.clip(mean / scale, 0, 1)
    peak = np.clip(peak / scale, 0, 1)
    print(f"  steps {steps}, rows {rows}; scale {scale:.3f}; mean of line {mean.mean():.3f}, "
          f"share of cells above 0.5: {(peak > 0.5).mean():.1%}")

    out_dir = MEDIA_DIR / cfg["id"]
    dest = out_dir / "orbit.mp4"
    transcode.to_web_mp4(path, dest, md["width"], md["height"], md["crf"])
    first = next(f for _, f in video.iter_frames(path, [0]))
    cv2.imwrite(str(out_dir / "poster.webp"),
                cv2.resize(first, (md["width"], md["height"]), interpolation=cv2.INTER_AREA),
                [cv2.IMWRITE_WEBP_QUALITY, 82])
    print(f"  web video {dest.stat().st_size / 1e6:.1f} MB")

    start = datetime.fromisoformat(tm["start"])
    per = tm["steps_per_section"]
    hours = fps_step * tm["hours_per_frame"]
    lon_at = lambda frame: geom["lon_at_frame0"] + geom["lon_per_frame"] * frame
    frames = []
    for s0 in range(0, steps - steps % per, per):
        t0 = start + timedelta(hours=s0 * hours)
        t1 = t0 + timedelta(hours=per * hours)
        lon0, lon1 = lon_at(s0 * fps_step), lon_at((s0 + per) * fps_step)
        region = region_for((lon0 + lon1) / 2)
        frames.append({
            "label": f"{t0.day} {t0:%b}",
            "ariaLabel": f"Week from {t0.day} {t0:%B}",
            "startStep": s0,
            "steps": per,
            "from": f"{t0.day} {t0:%B}",
            "to": f"{t1.day} {t1:%B}",
            "region": region,
            "level": float(mean[s0 : s0 + per].mean()),
            "alt": f"Globe showing carbon dioxide from {t0.day} {t0:%B} to {t1.day} {t1:%B} 2020, "
                   f"turning past {region}. Dense carbon dioxide glows orange and red.",
        })
    top = max(f["level"] for f in frames)
    for f in frames:
        f["relative"] = round(f.pop("level") / top, 3)

    H, W = info["height"], info["width"]
    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "spin-sweep",
        "source": cfg["source"],
        "media": {"type": "video", "src": f"media/{cfg['id']}/orbit.mp4",
                  "poster": f"media/{cfg['id']}/poster.webp",
                  "width": md["width"], "height": md["height"], "aspect": round(W / H, 4),
                  "duration": round(info["frames"] / info["fps"], 3), "fps": info["fps"]},
        "globe": {"cx": cx / W, "cy": geom["cy"] / H, "r": geom["radius"] / H, "lat0": geom["lat0"]},
        "rows": rows, "latTop": ex["lat_top"], "latStep": ex["lat_step"],
        "steps": steps, "framesPerStep": fps_step, "hoursPerStep": hours,
        "startHourUTC": start.hour,
        "lonAtStep0": geom["lon_at_frame0"], "lonPerStep": geom["lon_per_frame"] * fps_step,
        "chapters": [{"id": "weeks", "title": tm["section_title"], "frames": frames}],
        "line": np.rint(mean * 100).astype(int).ravel().tolist(),
        "peak": np.rint(peak * 100).astype(int).ravel().tolist(),
        "legend": cfg["legend"],
    }
