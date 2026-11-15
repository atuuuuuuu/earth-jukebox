"""Guided lesson for the Ocean currents track: the Gulf Stream, one idea at a time.

Direction and speed are measured from NASA's own film (Perpetual Ocean 2; the ocean tour's web copy)
in the stretch where NASA's camera holds still over the Gulf Stream (234-262 s, spring 2023): the
optical flow of NASA's white flow lines, frame to frame. The camera's small drift (the land's
apparent motion) is subtracted. Places are found in the picture with a straight-line (affine) fit
to known coastline points. Speeds are relative to the fastest water in this view, not metres per
second: NASA's flow lines are drawn for the eye, so their speed on screen is not calibrated.

    cd backend/eic && py -m pipeline.run --track 07_ocean_lesson
"""
from __future__ import annotations

from datetime import date, timedelta
from math import asin, cos, radians, sin, sqrt

import cv2
import numpy as np

from ..config import MEDIA_DIR, source_path
from ..lib import video

COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]


def compass(bearing: float) -> str:
    return COMPASS[int(((bearing % 360) + 22.5) // 45) % 8]


def speed_word(v: float) -> str:
    return "fast" if v >= 0.6 else "medium" if v >= 0.3 else "slow"


def fit_georef(points: list) -> tuple[np.ndarray, np.ndarray]:
    """[name, lat, lon, x, y] -> 3x2 coefficients mapping (lon, lat, 1) to a pixel, and each point's error."""
    a = np.array([[lon, lat, 1.0] for _, lat, lon, _, _ in points])
    xy = np.array([[x, y] for *_, x, y in points], float)
    coef, *_ = np.linalg.lstsq(a, xy, rcond=None)
    return coef, np.hypot(*(a @ coef - xy).T)


def to_px(coef: np.ndarray, lat: float, lon: float) -> np.ndarray:
    return np.array([lon, lat, 1.0]) @ coef


def bearing_of(coef: np.ndarray, lat: float, u: float, v: float) -> float:
    """Compass bearing (0 north, 90 east) of a motion in the picture (u right, v down) at latitude lat."""
    dlon, dlat = np.linalg.solve(np.c_[coef[0], coef[1]], [u, v])
    return float(np.degrees(np.arctan2(dlon * cos(radians(lat)), dlat)) % 360)


def km_between(a: list, b: list) -> float:
    (la1, lo1), (la2, lo2) = (map(radians, a)), (map(radians, b))
    h = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))


def measure(frames: list[np.ndarray], parts: int) -> np.ndarray:
    """Mean optical flow over each of `parts` equal stretches: array [part, y, x, (u, v, |flow|)]."""
    n = len(frames) - 1
    out = np.zeros((parts, *frames[0].shape[:2], 3), np.float32)
    count = np.zeros(parts)
    prev = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
    for i in range(n):
        cur = cv2.cvtColor(frames[i + 1], cv2.COLOR_BGR2GRAY)
        fl = cv2.calcOpticalFlowFarneback(prev, cur, None, 0.5, 3, 9, 3, 5, 1.1, 0)
        p = i * parts // n
        out[p, ..., :2] += fl
        out[p, ..., 2] += np.hypot(fl[..., 0], fl[..., 1])
        count[p] += 1
        prev = cur
    return out / count[:, None, None, None]


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    w = cfg["window"]
    f0, f1 = round(w["from"] * info["fps"]), round(w["to"] * info["fps"])
    frames = [f for _, f in video.iter_frames(path, range(f0, f1 + 1))]
    print(f"Film {path.name}: frames {f0}-{f1} ({len(frames)})")

    coef, err = fit_georef(cfg["georef"])
    print(f"  places in the picture: worst {err.max():.1f} px, typical {np.sqrt((err ** 2).mean()):.1f} px")
    if err.max() > cfg["georef_max_px"]:
        raise SystemExit(f"Georeference off by {err.max():.1f} px: check the georef points")

    flow = measure(frames, w["parts"])
    mid = frames[len(frames) // 2]
    b, r = mid[..., 0].astype(int), mid[..., 2].astype(int)
    land = r > b + cfg["land_red_over_blue"]
    for p in range(w["parts"]):             # NASA's camera drifts a little: land must not move
        drift = np.median(flow[p, ..., 0][land]), np.median(flow[p, ..., 1][land])
        if max(map(abs, drift)) > 0.1:
            raise SystemExit(f"Part {p}: the camera moves ({drift} px a frame); choose a stiller window")
        flow[p, ..., 0] -= drift[0]
        flow[p, ..., 1] -= drift[1]
    k = 2 * cfg["radius"] + 1
    blur = lambda a: cv2.blur(a, (k, k))
    parts = [[blur(np.ascontiguousarray(flow[p, ..., c])) for c in range(3)] for p in range(w["parts"])]
    whole = [blur(np.ascontiguousarray(flow[..., c].mean(0))) for c in range(3)]
    fastest = float(np.percentile(np.stack([q[2] for q in parts]), 99.9))   # the fastest water, any part
    print(f"  fastest water {fastest:.3f} px a frame; land drift removed")

    start = date.fromisoformat(cfg["time"]["start"])
    day = lambda f: start + timedelta(days=f * cfg["time"]["days_per_frame"])
    dname = lambda d: f"{d.day} {d:%B %Y}"
    span = {"from": dname(day(f0)), "to": dname(day(f1))}
    H, W = mid.shape[:2]

    def at(fields: list, lat: float, lon: float) -> dict:
        x, y = to_px(coef, lat, lon)
        if not (0 <= x < W and 0 <= y < H):
            raise SystemExit(f"{lat}, {lon} is outside NASA's picture")
        xi, yi = int(round(x)), int(round(y))
        u, v, m = (float(f[yi, xi]) for f in fields)
        d = bearing_of(coef, lat, u, v)
        s = min(1.0, m / fastest)
        return {"x": round(x / W, 4), "y": round(y / H, 4), "dir": round(d), "compass": compass(d),
                "speed": round(s, 2), "speedWord": speed_word(s), "pct": round(s * 100)}

    def check(st: dict, got: dict) -> None:
        if "expect" in st:   # known geography: the measured direction must agree
            off = abs((got["dir"] - st["expect"] + 180) % 360 - 180)
            if off > st.get("within", 30):
                raise SystemExit(f"{st['title']}: measured {got['dir']} degrees, expected {st['expect']} +-{st.get('within', 30)}")
            print(f"  {st['title']}: {got['compass']} ({got['dir']} degrees, expected {st['expect']}), {got['pct']}% of fastest")

    steps = []
    for st in cfg["steps"]:
        out = {k: v for k, v in st.items() if k not in ("expect", "within", "at", "line")}
        fill = dict(span)
        if st["kind"] == "point":
            got = at(whole, *st["at"])
            check(st, got)
            out.update(got)
            fill.update(got)
        elif st["kind"] == "line":
            ln = st["line"]
            n = ln["samples"]
            pts = [[ln["from"][0] + (ln["to"][0] - ln["from"][0]) * i / (n - 1),
                    ln["from"][1] + (ln["to"][1] - ln["from"][1]) * i / (n - 1)] for i in range(n)]
            out["samples"] = [{**at(whole, *p), "km": round(km_between(ln["coast"], p) / 5) * 5} for p in pts]
            top = max(out["samples"], key=lambda q: q["speed"])
            fill.update(peak_km=top["km"], peak_pct=top["pct"],
                        edge_pct=min(out["samples"][0]["pct"], out["samples"][-1]["pct"]))
        elif st["kind"] == "series":
            got = at(whole, *st["at"])
            check(st, got)
            out.update({k: got[k] for k in ("x", "y")})
            frames_per = (f1 - f0) / w["parts"]
            out["parts"] = [{**at(parts[p], *st["at"]), "date": dname(day(f0 + p * frames_per))}
                            for p in range(w["parts"])]
            seq = [q["compass"] for q in out["parts"]]
            kinds = list(dict.fromkeys(seq))
            pct = [q["pct"] for q in out["parts"]]
            fill.update(first=seq[0], last=seq[-1], count=len(seq), speed_lo=min(pct), speed_hi=max(pct),
                        compasses=kinds[0] if len(kinds) == 1 else ", ".join(kinds[:-1]) + " and " + kinds[-1])
            fill["summary_key"] = "steady" if len(kinds) == 1 else "changing"
        for key in ("text", "after"):
            if key in out:
                tmpl = out[key][fill["summary_key"]] if isinstance(out[key], dict) else out[key]
                out[key] = " ".join(tmpl.split()).format(**fill)
        steps.append(out)

    out_dir = MEDIA_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / "gulf-stream.webp"), mid, [cv2.IMWRITE_WEBP_QUALITY, 82])

    return {
        "id": cfg["id"], "title": cfg["title"], "method": "optical-flow",
        "source": cfg["source"], **span,
        "image": f"media/{cfg['id']}/gulf-stream.webp", "alt": " ".join(cfg["alt"].split()),
        "width": W, "height": H,
        "cues": cfg["cues"], "steps": steps,
        "caveat": " ".join(cfg["caveat"].split()),
    }


if __name__ == "__main__":       # self-check: a texture moving right and up reads as east and north
    rng = np.random.default_rng(1)
    tex = cv2.GaussianBlur((rng.random((120, 160)) * 255).astype(np.uint8), (5, 5), 0)
    shift = lambda img, dx, dy: cv2.warpAffine(img, np.float32([[1, 0, dx], [0, 1, dy]]), (160, 120), borderMode=cv2.BORDER_REFLECT)
    east = [cv2.cvtColor(shift(tex, i, 0), cv2.COLOR_GRAY2BGR) for i in range(4)]
    north = [cv2.cvtColor(shift(tex, 0, -i), cv2.COLOR_GRAY2BGR) for i in range(4)]
    coef = np.array([[10.0, 0], [0, -10.0], [0, 0]])          # 10 px per degree, north up
    for frames, want in ((east, 90), (north, 0)):
        f = measure(frames, 1)[0]
        u, v = f[40:80, 50:110, 0].mean(), f[40:80, 50:110, 1].mean()
        got = bearing_of(coef, 0, u, v)
        assert abs((got - want + 180) % 360 - 180) < 5, (want, got, u, v)
    assert compass(350) == "north" and compass(50) == "northeast" and compass(257) == "west"
    print("flow direction ok")
