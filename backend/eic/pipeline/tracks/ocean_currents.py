"""Track 07 — Perpetual Ocean 2: Western Boundary Currents. A camera tour, read along a fixed line.

NASA's movie flies a camera over the ocean from 15 January 2021 to 22 December 2023: a turning
globe, then down to the Kuroshio, the Agulhas and the Gulf Stream. Currents are drawn as white flow
lines over a blue sea. The view is not a map (the camera moves), so, as for carbon dioxide, a fixed
vertical line through the middle of the picture is read: how much bright moving water is under each
part of the line, every 3 frames. The sound follows the line; the page plays NASA's video in step.
"""
from __future__ import annotations

from datetime import date, timedelta

import cv2
import numpy as np

from ..config import MEDIA_DIR, source_path
from ..lib import transcode, video


def current_value(bgr: np.ndarray, ex: dict) -> np.ndarray:
    """0..1: bright, white flow lines over the sea. Land, ice and black space score 0."""
    f = bgr.astype(np.float32)
    white = np.clip((f.min(axis=-1) - ex["white_lo"]) / (ex["white_hi"] - ex["white_lo"]), 0, 1)
    # Sea: within sea_blur px of clearly blue water (a dense current bundle is white for ~60 px).
    blue = ((f[..., 0] - f[..., 2]) > ex["sea_lo"]).astype(np.uint8)
    k = ex["sea_blur"]
    sea = cv2.dilate(blue, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    return white * sea


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    ex, tm, md = cfg["extraction"], cfg["time"], cfg["media"]
    W, H = info["width"], info["height"]
    rows, fps_step, hw = ex["rows"], tm["frames_per_step"], ex["half_width"]
    cx = W // 2
    pad = ex["sea_blur"]
    row_h = H / rows
    steps = info["frames"] // fps_step
    mean = np.zeros((steps, rows), np.float32)
    peak = np.zeros((steps, rows), np.float32)
    whole = np.zeros(steps, np.float32)
    crop = lambda f: f[:, cx - hw - pad : cx + hw + pad + 1]
    for i, strip in video.iter_frames(path, range(steps * fps_step), crop):
        v = current_value(strip, ex)[:, pad:-pad]
        s = i // fps_step
        for r in range(rows):
            band = v[int(r * row_h) : int((r + 1) * row_h)]
            mean[s, r] += band.mean() / fps_step
            peak[s, r] = max(peak[s, r], float(band.mean(axis=1).max()))
        whole[s] += v.mean() / fps_step
        if i % 1500 == 0:
            print(f"  frame {i}/{info['frames']}")

    scale = float(np.percentile(peak, 99.8))
    mean, peak = np.clip(mean / scale, 0, 1), np.clip(peak / scale, 0, 1)
    print(f"  steps {steps}, rows {rows}; scale {scale:.3f}; mean of line {mean.mean():.3f}")

    out_dir = MEDIA_DIR / cfg["id"]
    dest = out_dir / "tour.mp4"
    if not dest.exists() or ex.get("rebuild_video"):
        transcode.to_web_mp4(path, dest, md["width"], md["height"], md["crf"])
    print(f"  web video {dest.stat().st_size / 1e6:.1f} MB")

    start = date.fromisoformat(tm["start"])
    days_per_step = tm["days"] / (info["frames"] - 1) * fps_step
    day = lambda s: start + timedelta(days=s * days_per_step)
    frames = []
    for n, sc in enumerate(cfg["scenes"], 1):
        s0 = int(round(sc["from"] * info["fps"] / fps_step))
        s1 = min(steps, int(round(sc["to"] * info["fps"] / fps_step))) if sc.get("to") else steps
        t_mid = (s0 + s1) / 2 * fps_step / info["fps"]
        img = f"scene-{n}.webp"
        first = next(f for _, f in video.iter_frames(path, [int(t_mid * info["fps"])]))
        cv2.imwrite(str(out_dir / img), cv2.resize(first, (md["width"], md["height"]), interpolation=cv2.INTER_AREA),
                    [cv2.IMWRITE_WEBP_QUALITY, 80])
        d0, d1 = day(s0), day(s1 - 1)
        frames.append({
            "label": sc["title"], "ariaLabel": sc["title"], "place": sc["place"],
            "startStep": s0, "steps": s1 - s0,
            "from": f"{d0.day} {d0:%B %Y}", "to": f"{d1.day} {d1:%B %Y}",
            "image": f"media/{cfg['id']}/{img}",
            "alt": sc["alt"],
            "level": float(whole[s0:s1].mean()),
            "story": sc["story"].strip(),
        })
        if n == 1:
            cv2.imwrite(str(out_dir / "poster.webp"), cv2.resize(first, (md["width"], md["height"])),
                        [cv2.IMWRITE_WEBP_QUALITY, 80])
    top = max(f["level"] for f in frames)
    for f in frames:
        f["relative"] = round(f.pop("level") / top, 3)

    return {
        "id": cfg["id"], "title": cfg["title"], "short": cfg["short"], "method": "camera-line",
        "source": cfg["source"],
        "media": {"type": "video", "src": f"media/{cfg['id']}/tour.mp4", "poster": f"media/{cfg['id']}/poster.webp",
                  "width": md["width"], "height": md["height"], "aspect": round(W / H, 4),
                  "duration": round(info["frames"] / info["fps"], 3), "fps": info["fps"]},
        "rows": rows, "steps": steps, "framesPerStep": fps_step,
        "startDate": tm["start"], "daysPerStep": days_per_step,
        "chapters": [{"id": "scenes", "title": "The tour, place by place", "frames": frames}],
        "line": np.rint(mean * 100).astype(int).ravel().tolist(),
        "peak": np.rint(peak * 100).astype(int).ravel().tolist(),
        "legend": cfg["legend"],
    }


if __name__ == "__main__":                       # self-check: white lines on blue sea count, ice does not
    ex = {"white_lo": 110, "white_hi": 200, "sea_blur": 9, "sea_lo": 25}
    img = np.zeros((40, 80, 3), np.uint8)
    img[:, :20] = (150, 70, 30)                  # BGR blue sea
    img[18:20, :20] = (240, 230, 220)            # a white flow line on it
    img[:, 40:] = (235, 235, 235)                # ice, far from the sea
    v = current_value(img, ex)
    assert v[19, 8] > 0.5 and v[5, 8] == 0 and v[19, 70] == 0, (v[19, 8], v[5, 8], v[19, 70])
    print("current reading ok")
