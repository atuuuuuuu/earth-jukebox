"""Track 8, El Niño: NASA's sea surface temperature anomaly film (SVS 5176) read back into degrees C.

NASA's film is a flat world map (180 W at the left edge, 90 N at the top), one day per frame from
18 May 2024 (frame 0) to 4 November 2026. Every colour on the sea is a number on NASA's colour bar,
-4 to +4 degrees C from normal for that day of the year. Land, sea ice and the date stamp are not
on the bar, so they carry no reading. We read every day of each chosen month, average the month,
and pool it into the shared 3 degree grid. Niño 3.4 (5 S to 5 N, 170 W to 120 W) is NOAA's El Niño
box; "relative" subtracts the whole tropical ocean (20 S to 20 N), as NOAA does since 2025.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

import cv2
import numpy as np

from ..config import MEDIA_DIR, RESOURCES, source_path
from ..lib import grid, video

W, H = 1440, 720            # analysis map: 0.25 degrees a pixel
CELL = 12                   # 12 x 12 pixels = one 3 degree cell
LAT = 90 - (np.arange(H) + 0.5) * 180 / H
LON = -180 + (np.arange(W) + 0.5) * 360 / W
NINO34 = ((-5, 5), (-170, -120))
TROPICS = ((-20, 20), (-180, 180))


def to_lab(bgr) -> np.ndarray:
    """BGR 0-255 to CIE Lab, where distance roughly matches what eyes see."""
    return cv2.cvtColor(np.asarray(bgr, np.float32) / 255, cv2.COLOR_BGR2Lab)


def bar_colours(img: np.ndarray, box, lo: float, hi: float):
    """NASA's colour bar: one colour per column of `box` (rows clear of the tick marks), low end on the left.
    Returns (BGR colours, Lab colours, the value each stands for)."""
    x0, y0, x1, y1 = box
    bgr = np.median(img[y0:y1, x0:x1].astype(np.float32), axis=0)
    lab = to_lab(bgr[None])[0]
    values = np.linspace(lo, hi, len(bgr))
    start = 0                    # where the bar holds one colour (its white middle), read the stretch's middle
    for i in range(1, len(lab) + 1):
        if i == len(lab) or np.linalg.norm(lab[i] - lab[start]) > 0.8:
            values[start:i] = values[start:i].mean()
            start = i
    return bgr, lab, values


def lookup_table(lab: np.ndarray, values: np.ndarray, max_dist: float) -> np.ndarray:
    """The value of every colour, 64 levels a channel (index (b >> 2) * 4096 + (g >> 2) * 64 + (r >> 2)):
    the nearest bar colour's value, or NaN when no bar colour is within max_dist (land, ice, text)."""
    q = np.arange(64, dtype=np.float32) * 4 + 2
    b, g, r = np.meshgrid(q, q, q, indexing="ij")
    cube = to_lab(np.stack([b, g, r], -1).reshape(1, -1, 3))[0]
    out = np.empty(len(cube), np.float32)
    for s in range(0, len(cube), 8192):
        d = np.linalg.norm(cube[s:s + 8192, None] - lab[None], axis=-1)
        k = d.argmin(1)
        out[s:s + 8192] = np.where(d[np.arange(len(k)), k] <= max_dist, values[k], np.nan)
    return out


def read_day(frame: np.ndarray, lut: np.ndarray, date_box) -> tuple[np.ndarray, np.ndarray]:
    """One frame of NASA's film: (the frame at analysis size, degrees C with NaN where there is no reading)."""
    small = cv2.resize(frame, (W, H), interpolation=cv2.INTER_NEAREST)   # smoothing would blend colours off the bar
    q = small.astype(np.int32) >> 2
    v = lut[(q[..., 0] << 12) | (q[..., 1] << 6) | q[..., 2]]
    x0, y0, x1, y1 = date_box
    v[int(y0 * H):int(np.ceil(y1 * H)), int(x0 * W):int(np.ceil(x1 * W))] = np.nan
    return small, v


def box_mean(v: np.ndarray, box) -> float:
    """Area-weighted mean inside a latitude, longitude box."""
    (s, n), (w, e) = box
    sub = v[(LAT >= s) & (LAT <= n)][:, (LON >= w) & (LON <= e)]
    wt = np.broadcast_to(np.cos(np.radians(LAT[(LAT >= s) & (LAT <= n)]))[:, None], sub.shape)
    ok = np.isfinite(sub)
    return round(float((sub[ok] * wt[ok]).sum() / wt[ok].sum()), 3)


def build(cfg: dict) -> dict:
    bar = cfg["colour_bar"]
    lo, hi = bar["range"]
    bgr, lab, values = bar_colours(cv2.imread(str(RESOURCES / bar["file"])), bar["box"], lo, hi)
    lut = lookup_table(lab, values, bar["max_dist"])
    path = source_path(cfg)
    info = video.video_info(path)
    start = date.fromisoformat(cfg["start"])
    last = start + timedelta(days=int(info["frames"]) - 1)

    months = [tuple(map(int, m.split("-"))) for m in cfg["months"]]
    days = {}                                         # frame index -> month
    for y, m in months:
        for d in range(1, calendar.monthrange(y, m)[1] + 1):
            if start <= date(y, m, d) <= last:
                days[(date(y, m, d) - start).days] = (y, m)
    print(f"Film {path.name}: {info}; {len(days)} days in {len(months)} months, {start} to {last}")

    maps, acc = {}, None
    def finish(key):
        total, count, colour, n = acc
        ok = count >= cfg["min_days"] * n
        maps[key] = (np.where(ok, total / np.maximum(count, 1), np.nan), colour / n, n)

    key = None
    for i, frame in video.iter_frames(path, days):
        if days[i] != key:
            if key:
                finish(key)
            key, acc = days[i], [np.zeros((H, W)), np.zeros((H, W)), np.zeros((H, W, 3)), 0]
        small, v = read_day(frame, lut, cfg["date_box"])
        ok = np.isfinite(v)
        acc[0] += np.where(ok, v, 0)
        acc[1] += ok
        acc[2] += small
        acc[3] += 1
    finish(key)

    out_dir = MEDIA_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    rows, cols = H // CELL, W // CELL
    blocks = lambda a: a.reshape(rows, CELL, cols, CELL)
    scale, md = cfg["scale"], cfg["media"]
    x0, y0, x1, _ = cfg["date_box"]
    frames = []
    for y, m in months:
        mean, base, n = maps[(y, m)]
        ok = np.isfinite(mean)
        share = blocks(ok.astype(np.float32)).mean(axis=(1, 3))
        cell = np.nansum(blocks(np.where(ok, mean, 0)), axis=(1, 3)) / np.maximum(blocks(ok).sum(axis=(1, 3)), 1)
        known = (share >= cfg["min_share"]).ravel().tolist()
        ints = lambda a: [v if k else None for v, k in zip(grid.to_ints(a), known)]
        n34, trop = box_mean(mean, NINO34), box_mean(mean, TROPICS)

        # The picture: the month's mean on NASA's own colour bar; land and ice as NASA drew them.
        k = np.clip(np.rint((np.nan_to_num(mean) - lo) / (hi - lo) * (len(bgr) - 1)), 0, len(bgr) - 1).astype(int)
        r0, c1 = int(y0 * H), int(np.ceil(x1 * W))
        base[r0:, int(x0 * W):c1] = base[r0:, c1:c1 + 1]                  # cover NASA's date stamp with the ice beside it
        img = np.where(ok[..., None], bgr[k], base).clip(0, 255).astype(np.uint8)
        name = f"{y}-{m:02d}.webp"
        cv2.imwrite(str(out_dir / name), cv2.resize(img, (md["width"], md["height"]), interpolation=cv2.INTER_AREA),
                    [cv2.IMWRITE_WEBP_QUALITY, md["webp_quality"]])

        first = max(date(y, m, 1), start)
        end = min(date(y, m, calendar.monthrange(y, m)[1]), last)
        label = f"{calendar.month_name[m]} {y}"
        frames.append({
            "label": label,
            "date": f"{y}-{m:02d}-01",
            "days": n,
            "span": f"{first.day} to {end.day} {calendar.month_name[m]} {y}",
            "image": f"media/{cfg['id']}/{name}",
            "alt": (f"NASA's map of sea surface temperature anomaly, {label}, averaged over {n} days: red where the "
                    f"sea is warmer than normal for the time of year, blue where it is cooler, grey land."),
            "nino34": n34,
            "tropics": trop,
            "nino34Relative": round(n34 - trop, 3),
            "gain": ints(np.clip(cell / scale, 0, 1)),
            "loss": ints(np.clip(-cell / scale, 0, 1)),
        })
        print(f"  {label}: {n} days, Niño 3.4 {n34:+.2f}, tropics {trop:+.2f}, relative {n34 - trop:+.2f} C; "
              f"cells with a reading {np.mean(known):.0%}")

    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "sst-anomaly",
        "source": cfg["source"],
        "grid": {"cols": cols, "rows": rows, "lonWest": -180, "latNorth": 90, "cellDeg": 3.0},
        "chapters": [{
            "id": cfg["chapter"], "title": cfg["label"], "secondsPerSweep": cfg["playback"]["seconds_per_sweep"],
            "degreesPerUnit": scale, "elNinoLine": cfg["el_nino_line"], "frames": frames,
        }],
        "legend": cfg["legend"],
    }


if __name__ == "__main__":     # self-check on a made-up bar: colours read back as their values; dark grey land is no reading
    ramp = np.stack([np.linspace(255, 0, 101), np.linspace(64, 200, 101), np.linspace(0, 255, 101)], -1)
    img = np.repeat(ramp[None], 10, 0).astype(np.uint8)
    _, lab, vals = bar_colours(img, (0, 2, 101, 8), -4, 4)
    lut = lookup_table(lab, vals, 14)
    probe = np.array([[img[5, 25], img[5, 75], [40, 40, 40]]], np.uint8)   # the last is dark grey land
    q = probe.astype(np.int32) >> 2
    got = lut[(q[..., 0] << 12) | (q[..., 1] << 6) | q[..., 2]][0]
    assert abs(got[0] + 2) < 0.25 and abs(got[1] - 2) < 0.25 and np.isnan(got[2]), got
    print("sst_anomaly self-check ok")
