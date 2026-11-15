"""NASA's turning-globe films, flattened into one world map each (tracks 4 and 5).

A scan line can then move west to east across the map on our own globe, as on every other map
track, and only what is under the line plays.

How a frame becomes a map:
- NASA's camera sits `camera_distance` Earth radii from the centre of the globe, tilted `tilt`
  degrees north; the disc's edge is the horizon, `limb` px from the centre (`cx`, `cy`).
  The distance and tilt were fitted by matching NASA's land to the Blue Marble.
- The longitude facing the camera is measured every `track_every` frames the same way, then
  smoothed (ocean: the turn slows down) or fitted with a straight line (carbon dioxide: steady).
  The build stops if the match is poor.
- Every frame is projected onto a 0.25 degree world grid. Each place is the average of every
  frame that shows it within `max_angle` of face-on, so passing eddies and plumes average into
  where the currents and the carbon dioxide usually are.

A film that is already a flat world map (`projection: flat`, NASA's ECCO2 currents for track 4)
skips the camera: its frames are averaged directly, and its land must match the Blue Marble.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import cv2
import numpy as np

from ..config import MEDIA_DIR, WEB_DIR, source_path
from ..lib import grid, video
from .co2_dyamond import co2_value
from .ocean_currents import current_value

MAP_W, MAP_H = 1440, 720          # 0.25 degrees per pixel
VALUES = {"currents": current_value, "co2": co2_value}


def blue_marble_land(width: int = MAP_W, height: int = MAP_H) -> np.ndarray:
    """1 on land (red or green above blue), 0 on sea, from the globe's own Blue Marble texture."""
    bm = cv2.imread(str(WEB_DIR / "textures" / "blue-marble.jpg")).astype(np.float32)
    land = ((np.maximum(bm[..., 2], bm[..., 1]) - bm[..., 0]) > 8).astype(np.float32)
    return cv2.resize(land, (width, height), interpolation=cv2.INTER_AREA)


def frame_land(bgr: np.ndarray, rule: str) -> tuple[np.ndarray, np.ndarray]:
    """NASA's land in one frame, and which pixels to trust for matching (not hidden by data)."""
    f = bgr.astype(np.float32)
    if rule == "colour":            # Blue Marble land on a blue sea (ocean film)
        return ((np.maximum(f[..., 2], f[..., 1]) - f[..., 0]) > 8).astype(np.float32), np.ones(f.shape[:2], bool)
    mx = f.max(axis=-1)             # grey land on a black sea, under warm carbon dioxide colours
    sat = (mx - f.min(axis=-1)) / np.maximum(mx, 1)
    return (mx > 55).astype(np.float32), sat < 0.3


def focal(g: dict) -> float:
    """Pixels per unit of tan(angle), so that the horizon lands `limb` px from the centre."""
    return g["limb"] * math.sqrt(g["camera_distance"] ** 2 - 1)


def to_camera(lat, dlon, tilt: float):
    """Unit-sphere point (lat, lon - centre lon) in camera axes: x east, y up, z toward the camera."""
    lat, dlon, t = np.radians(lat), np.radians(dlon), math.radians(tilt)
    x, y, z = np.cos(lat) * np.sin(dlon), np.sin(lat), np.cos(lat) * np.cos(dlon)
    return x, y * math.cos(t) - z * math.sin(t), y * math.sin(t) + z * math.cos(t)


def project(lat, dlon, g: dict):
    """Pixel (x, y) of a place in the frame, and z: 1 face-on, below 1/D behind the horizon."""
    x, y, z = to_camera(lat, dlon, g["tilt"])
    d, f = g["camera_distance"], focal(g)
    return g["cx"] + f * x / (d - z), g["cy"] - f * y / (d - z), z


def unproject(px, py, g: dict):
    """(lat, lon - centre lon) under each pixel inside the disc (NaN outside)."""
    d, f = g["camera_distance"], focal(g)
    x, y = px - g["cx"], -(py - g["cy"])
    n = np.sqrt(x * x + y * y + f * f)
    dx, dy, dz = x / n, y / n, -f / n
    b = d * dz
    disc = b * b - (d * d - 1)
    tt = np.where(disc >= 0, -b - np.sqrt(np.clip(disc, 0, None)), np.nan)
    X, Y, Z = tt * dx, tt * dy, d + tt * dz
    t = math.radians(g["tilt"])
    yy, zz = Y * math.cos(t) + Z * math.sin(t), -Y * math.sin(t) + Z * math.cos(t)
    return np.degrees(np.arcsin(np.clip(yy, -1, 1))), np.degrees(np.arctan2(X, zz))


def facing_lon(path, g: dict, tr: dict, rule: str, n_frames: int) -> tuple[np.ndarray, float]:
    """Longitude facing the camera at every frame, measured against the Blue Marble."""
    land = cv2.GaussianBlur(blue_marble_land(), (0, 0), 1.0)
    H, W = land.shape
    step = 2 if g["limb"] < 250 else 3
    h, w = tr["frame_h"], tr["frame_w"]
    ys, xs = np.mgrid[0:h:step, 0:w:step]
    inside = (xs - g["cx"]) ** 2 + (ys - g["cy"]) ** 2 < (0.9 * g["limb"]) ** 2
    lat, dl = unproject(xs[inside].astype(np.float64), ys[inside].astype(np.float64), g)
    v = np.clip(((90 - lat) / 180 * H).astype(int), 0, H - 1)

    def score(lm, ok, lonc):
        u = (((lonc + dl + 180) % 360) / 360 * W).astype(int) % W
        return float(np.corrcoef(lm[ok], land[v, u][ok])[0, 1])

    picks = list(range(0, n_frames, tr["every"]))
    found, last, rate = [], (0, tr["start"]), 0.0
    for i, fr in video.iter_frames(path, picks):
        lm, ok = frame_land(fr, rule)
        lm, ok = lm[::step, ::step][inside], ok[::step, ::step][inside]
        # Both films turn westward. Over open sea (little land to match) carry on at the last rate.
        guess = last[1] + rate * (i - last[0])
        span = np.arange(guess - tr["search"], guess + 2.01, 0.25)
        s, c = max((score(lm, ok, c), c) for c in span)
        if s >= tr["min_corr"]:
            if i > last[0]:
                rate = (c - last[1]) / (i - last[0])
            last = (i, c)
        found.append((i, s, c))
    f = np.array(found)
    good = f[f[:, 1] >= tr["min_corr"]]
    if len(good) < 0.6 * len(f):
        raise SystemExit(f"Globe match too poor: only {len(good)} of {len(f)} frames match the Blue Marble.")
    frames = np.arange(n_frames)
    if tr["turn"] == "steady":
        a, b = np.polyfit(good[:, 0], good[:, 2], 1)
        res = good[:, 2] - (a * good[:, 0] + b)
        print(f"  steady turn: {b:.2f} deg at frame 0, {a:.4f} deg per frame; worst miss {abs(res).max():.1f} deg")
        if abs(res).max() > tr["max_miss"]:
            raise SystemExit("The globe does not turn steadily: use turn: measured.")
        out = a * frames + b
    else:
        # The spin slows smoothly: a degree-6 curve through the matched frames, which must keep turning one way.
        x = good[:, 0] / n_frames
        fit = np.polyfit(x, good[:, 2], 6)
        res = good[:, 2] - np.polyval(fit, x)
        out = np.polyval(fit, frames / n_frames)
        print(f"  measured turn: {len(good)} of {len(f)} frames matched; worst miss {abs(res).max():.1f} deg; "
              f"{out[0] - out[-1]:.1f} deg in all")
        if abs(res).max() > tr["max_miss"] or (np.diff(out) > 0.01).any():
            raise SystemExit("The measured turn is not smooth: check the geometry.")
    return out, float(good[:, 1].mean())


def flatten(path, g: dict, lonc: np.ndarray, value, ex: dict, frames: list[int]):
    """Average value, colour and weight of every face-on frame, on the world grid."""
    lat = 90 - (np.arange(MAP_H) + 0.5) * 180 / MAP_H
    lon = -180 + (np.arange(MAP_W) + 0.5) * 360 / MAP_W
    LAT = np.repeat(lat[:, None], MAP_W, 1)
    cos_max = math.cos(math.radians(g["max_angle"]))
    acc_v = np.zeros((MAP_H, MAP_W), np.float64)
    acc_c = np.zeros((MAP_H, MAP_W, 3), np.float64)
    acc_w = np.zeros((MAP_H, MAP_W), np.float64)
    for k, (i, fr) in enumerate(video.iter_frames(path, frames)):
        dlon = (lon[None, :] - lonc[i] + 180) % 360 - 180
        px, py, z = project(LAT, np.repeat(dlon, MAP_H, 0), g)
        w = np.clip((z - cos_max) / (1 - cos_max), 0, 1) ** 2   # face-on views count most: the rim glows and smears
        mx, my = px.astype(np.float32), py.astype(np.float32)
        acc_v += w * cv2.remap(value(fr, ex).astype(np.float32), mx, my, cv2.INTER_LINEAR)
        acc_c += w[..., None] * cv2.remap(fr, mx, my, cv2.INTER_LINEAR).astype(np.float64)
        acc_w += w
        if k % 200 == 0:
            print(f"  frame {i}: facing {((lonc[i] + 180) % 360) - 180:.1f} deg")
    return acc_v, acc_c, acc_w


def flat_film(cfg: dict):
    """A film that is already a world map (-180 to 180 E, north up): average its frames directly.

    Value: how bright NASA's flow lines are, averaged over the film: faster water draws longer,
    brighter trails. Sea: every pixel that ever shows a coloured flow line (land stays plain grey).
    """
    fr_cfg, ex = cfg["frames"], cfg["extraction"]
    acc_v = acc_c = sat_max = None
    n = 0
    for _, fr in video.iter_frames(source_path(cfg), range(fr_cfg["from"], fr_cfg["to"] + 1, fr_cfg["every"])):
        f = fr.astype(np.float32)
        mx = f.max(axis=-1)
        if acc_c is None:
            acc_v, acc_c, sat_max = np.zeros_like(mx), np.zeros_like(f), np.zeros_like(mx)
        acc_v += mx / 255
        acc_c += f
        sat_max = np.maximum(sat_max, (mx - f.min(axis=-1)) / np.maximum(mx, 1))
        n += 1
    sea = sat_max > ex["sea_sat"]
    land = cv2.resize((~sea).astype(np.float32), (MAP_W, MAP_H), interpolation=cv2.INTER_AREA)
    mid = slice(MAP_H // 6, MAP_H * 5 // 6)                # 60 N to 60 S: sea ice and Antarctica differ by design
    corr = float(np.corrcoef(land[mid].ravel(), blue_marble_land()[mid].ravel())[0, 1])
    print(f"  {n} frames; the film's land matches the Blue Marble with correlation {corr:.3f}")
    if corr < cfg["min_corr"]:
        raise SystemExit(f"The film's land does not line up with the world map (correlation {corr:.3f}).")
    # The picture: NASA's colours averaged over the film, so bright streaks are the strong currents.
    col = acc_c / n
    gain = 255 / np.percentile(col.max(axis=-1)[sea], 99.5)
    img = np.where(sea[..., None], col * gain, col).clip(0, 255).astype(np.uint8)
    val = cv2.resize(acc_v / n, (MAP_W, MAP_H), interpolation=cv2.INTER_AREA)
    return val, land < 0.5, img, {"projection": "flat", "match": round(corr, 3)}


def turning_globe(cfg: dict):
    """A film of NASA's globe turning, projected back onto the world map (see the top of this file)."""
    g, tr, ex = cfg["geometry"], cfg["turn"], cfg["extraction"]
    path = WEB_DIR / cfg["film"]
    info = video.video_info(path)
    first, last = cfg["frames"]["from"], cfg["frames"]["to"]
    print(f"Film {path.name}: {info}; frames {first} to {last}")
    tr = {**tr, "frame_w": info["width"], "frame_h": info["height"]}
    lonc, corr = facing_lon(path, g, tr, cfg["land"], last + 1)
    print(f"  globe matches the Blue Marble with correlation {corr:.2f}")

    acc_v, acc_c, acc_w = flatten(path, g, lonc, VALUES[cfg["value"]], ex,
                                  list(range(first, last + 1, cfg["frames"]["every"])))
    seen = acc_w >= cfg["min_weight"]
    val = np.where(seen, acc_v / np.maximum(acc_w, 1e-9), np.nan)
    use = seen & ((blue_marble_land() < 0.5) if cfg["value"] == "currents" else True)

    # The picture: NASA's own colours where the film showed the place; elsewhere a dim grey Earth.
    col = acc_c / np.maximum(acc_w, 1e-9)[..., None]
    if cfg.get("smoke_lift"):     # lighten the plumes; capped at full brightness of their own hue, so red stays red
        dense = np.clip(np.nan_to_num(val) / np.nanpercentile(val[use], 99.5), 0, 1)[..., None]
        cap = 255 / np.maximum(col.max(axis=-1, keepdims=True), 1)
        col = col * np.minimum(1 + cfg["smoke_lift"] * dense, cap)
    bm = cv2.resize(cv2.imread(str(WEB_DIR / "textures" / "blue-marble.jpg")), (MAP_W, MAP_H), interpolation=cv2.INTER_AREA)
    dim = np.repeat(cv2.cvtColor(bm, cv2.COLOR_BGR2GRAY)[..., None], 3, 2).astype(np.float64) * 0.35
    a = np.clip(acc_w / (3 * cfg["min_weight"]), 0, 1)[..., None]
    img = (col * a + dim * (1 - a)).clip(0, 255).astype(np.uint8)
    fit = {"cameraDistance": g["camera_distance"], "tilt": g["tilt"], "match": round(corr, 3),
           "facingFirst": round(float(lonc[first]), 2), "facingLast": round(float(lonc[last]), 2)}
    return val, use, img, fit


def build(cfg: dict) -> dict:
    md = cfg["media"]
    first, last = cfg["frames"]["from"], cfg["frames"]["to"]
    val, use, img, fit = (flat_film if cfg.get("projection") == "flat" else turning_globe)(cfg)

    rows, cols = 60, 120                                   # the shared 3 degree grid
    b = lambda a: a.reshape(rows, MAP_H // rows, cols, MAP_W // cols)
    share = b(use.astype(np.float32)).mean(axis=(1, 3))
    cell = np.nansum(b(np.where(use, val, 0)), axis=(1, 3)) / np.maximum(b(use.astype(np.float32)).sum(axis=(1, 3)), 1)
    cell_lat = 90 - (np.arange(rows) + 0.5) * 3
    known = (share >= cfg["min_share"]) & (cell_lat <= cfg.get("lat_max", 90))[:, None]
    scale = float(np.percentile(cell[known], 99.5))
    floor = float(np.percentile(cell[known], cfg["note_floor_percentile"])) if cfg.get("note_floor_percentile") else 0.0
    glow = np.clip(cell / scale, 0, 1)
    core = np.clip((cell - floor) / max(scale - floor, 1e-9), 0, 1)
    print(f"  cells with a reading {known.mean():.0%}; scale {scale:.4f}; note floor {floor:.4f}; "
          f"cells above half {(glow[known] > 0.5).mean():.1%}")

    out_dir = MEDIA_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / "map.webp"), cv2.resize(img, (md["width"], md["height"]), interpolation=cv2.INTER_AREA),
                [cv2.IMWRITE_WEBP_QUALITY, md["webp_quality"]])

    to_ints = lambda arr: [None if not k else v for v, k in zip(grid.to_ints(arr), known.ravel().tolist())]
    north = float(np.nansum(np.where(known, glow, 0)[: rows // 2]) / max(np.nansum(np.where(known, glow, 0)), 1e-9))
    start = date.fromisoformat(cfg["time"]["start"])
    day = lambda i: start + timedelta(days=i * cfg["time"]["days_per_frame"])
    fmt = lambda d: f"{d.day} {d.strftime('%B')} {d.year}"
    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "globe-map",
        "source": cfg["source"],
        "grid": {"cols": cols, "rows": rows, "lonWest": -180, "latNorth": 90, "cellDeg": 3.0},
        "fit": fit,
        "chapters": [{
            "id": cfg["chapter"], "title": cfg["label"], "secondsPerSweep": cfg["playback"]["seconds_per_sweep"],
            "frames": [{
                "label": cfg["label"],
                "image": f"media/{cfg['id']}/map.webp",
                "alt": cfg["alt"].strip(),
                "about": " ".join(cfg["about"].split()),
                "span": f"{fmt(day(first))} to {fmt(day(last))}",
                "north": round(north, 3),
                "total": round(float(np.nansum(np.where(known, glow, 0))), 4),
                "core": to_ints(core),
                "glow": to_ints(glow),
            }],
        }],
        "legend": cfg["legend"],
    }


if __name__ == "__main__":     # self-check: the projection and its inverse agree, and the horizon is where it should be
    g = {"cx": 320.0, "cy": 180.0, "limb": 176.0, "camera_distance": 4.5, "tilt": 9.0}
    x, y, z = project(np.array([9.0]), np.array([0.0]), g)
    assert abs(x[0] - 320) < 1e-6 and abs(y[0] - 180) < 1e-6 and abs(z[0] - 1) < 1e-9, "the facing point is the centre"
    lat, dl = np.array([40.0, -25.0, 60.0]), np.array([30.0, -50.0, 10.0])
    px, py, z = project(lat, dl, g)
    lat2, dl2 = unproject(px, py, g)
    assert np.allclose(lat, lat2, atol=1e-6) and np.allclose(dl, dl2, atol=1e-6), (lat2, dl2)
    # the horizon: a point exactly 1/D in front of the centre sits on the limb
    edge = math.degrees(math.acos(1 / g["camera_distance"]))
    px, py, _ = project(np.array([9.0]), np.array([edge]), g)
    assert abs(math.hypot(px[0] - 320, py[0] - 180) - 176) < 0.5, math.hypot(px[0] - 320, py[0] - 180)
    x, _, _ = project(np.array([0.0]), np.array([20.0]), {**g, "tilt": 0.0})
    assert x[0] > 320, "east is to the right"
    print("globe_map self-check ok")
