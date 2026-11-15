"""Track 08 — A 3D View of an Atmospheric River (SVS 4960). A camera film, read band by band.

NASA's film shows MERRA-2 water vapour on the move over the Pacific, 1 October to 14 December 2010:
blue shading, the deeper the blue the more vapour (its core is the atmospheric river). The camera
moves, so as for the ocean tour the picture is read in horizontal bands from top to bottom: how
much vapour is in each band, and how much of it is the river's deep-blue core, every 3 frames.

Rain, snow, snow depth and soil moisture (NASA's colour bars) are not read: in this 3D render the
rain is drawn under the see-through vapour, which tints it the same yellow-green as sunlit land.

NASA's clock is not even: it races through October and November, replays 10 to 14 December again
and again, and stops at 11 December 18:43 while the camera flies along the river. So the date of
every step is read from NASA's own date-only overlay movie, digit by digit, and lined up with the
film at the moments the clock jumps back (each one is a visible jump in the picture).
"""
from __future__ import annotations

from datetime import datetime, timedelta

import cv2
import numpy as np

from ..config import MEDIA_DIR, source_path
from ..lib import transcode, video

MONTHS = {"Oct": 10, "Nov": 11, "Dec": 12}


# ---------- NASA's clock ----------

def glyphs(frame: np.ndarray, dc: dict) -> dict[str, list[np.ndarray]]:
    """The date overlay's characters, one 24x32 image each, grouped by field (mon, day, hour, min)."""
    y0, y1 = dc["rows"]
    ink = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)[y0:y1] > dc["ink"]
    cols = np.append(ink.any(axis=0), False)
    out: dict[str, list[np.ndarray]] = {k: [] for k in dc["fields"]}
    start = None
    for x, on in enumerate(cols):
        if on and start is None:
            start = x
        elif not on and start is not None:
            if x - start >= dc["min_glyph"]:            # the colon is narrower
                mid = (start + x) / 2
                for k, (lo, hi) in dc["fields"].items():
                    if lo <= mid < hi:
                        g = ink[:, start:x]
                        ys = np.where(g.any(axis=1))[0]
                        out[k].append(cv2.resize(g[ys[0]: ys[-1] + 1].astype(np.float32), (24, 32),
                                                 interpolation=cv2.INTER_AREA))
            start = None
    return out


def read_clock(path, dc: dict) -> tuple[np.ndarray, float]:
    """Minutes since dc['start'] on every frame of NASA's date-only movie, and the worst match error.

    The digits are taught by a few frames read by eye (dc['known']: second -> "Mon DD HH MM")."""
    info = video.video_info(path)
    known = {int(round(float(sec) * info["fps"])): text for sec, text in dc["known"].items()}
    taught = {i: glyphs(f, dc) for i, f in video.iter_frames(path, known)}   # pass 1: only the known frames
    digits: dict[str, list] = {}
    months = {}
    for i, text in known.items():
        g = taught[i]
        mon, *nums = text.split()
        months[mon] = np.hstack(g["mon"])
        for field, s in zip(("day", "hour", "min"), nums):
            for ch, im in zip(s, g[field]):
                digits.setdefault(ch, []).append(im)
    digits = {k: np.mean(v, axis=0) for k, v in digits.items()}
    if sorted(digits) != list("0123456789"):
        raise RuntimeError(f"date key teaches only digits {sorted(digits)}; add a known frame")

    def best(im, temps):
        err = {k: float(((im - t) ** 2).mean()) for k, t in temps.items()}
        k = min(err, key=err.get)
        return k, err[k]

    t0 = datetime.fromisoformat(dc["start"])
    minutes, worst = np.zeros(info["frames"], np.float64), 0.0
    for i, f in video.iter_frames(path, range(info["frames"])):    # pass 2: read each frame, keep one number
        g = glyphs(f, dc)
        if len(g["mon"]) != 3 or any(len(g[k]) != 2 for k in ("day", "hour", "min")):
            raise RuntimeError(f"date overlay frame {i}: unexpected characters")
        mon, e = best(np.hstack(g["mon"]), months)
        worst = max(worst, e)
        vals = []
        for k in ("day", "hour", "min"):
            pair = [best(im, digits) for im in g[k]]
            worst = max(worst, *(e for _, e in pair))
            vals.append(int("".join(c for c, _ in pair)))
        when = datetime(t0.year, MONTHS[mon], vals[0], vals[1], vals[2])
        minutes[i] = (when - t0).total_seconds() / 60
    return minutes, worst


def align(clock: np.ndarray, jumps_seen: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    """Frame anchors (film frame, clock frame). Every time NASA's clock jumps back, the picture jumps
    too: the film's biggest frame-to-frame change within `window` frames is the same moment. The two
    movies start together and end together; between anchors, frames are spread evenly."""
    back = [j + 1 for j in np.where(np.diff(clock) < -60)[0]]
    back = [j for k, j in enumerate(back) if k == 0 or j - back[k - 1] > 5]
    film, clk = [0], [0]
    for j in back:
        lo, hi = max(0, j - window), min(len(jumps_seen), j + window + 1)
        w = jumps_seen[lo:hi]
        a = lo + int(w.argmax())
        if w.max() > 4 * np.median(w) and a > film[-1]:
            film.append(a)
            clk.append(j)
    film.append(len(jumps_seen) - 1)
    clk.append(len(clock) - 1)
    return np.array(film), np.array(clk)


# ---------- What the picture holds ----------

def vapour_value(small: np.ndarray, ex: dict) -> np.ndarray:
    """0..1: NASA's blue vapour shading. Teal = a little, deep blue = a lot. Grey sea, land, white
    wind streaks and clouds score 0 (no colour)."""
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1] / 255, hsv[..., 2] / 255
    lo0, lo1, hi1, hi0 = ex["vapour_hue"]        # OpenCV hue (0..180): ramps up, full, ramps down
    hue = np.clip(np.minimum((h - lo0) / (lo1 - lo0), (hi0 - h) / (hi0 - hi1)), 0, 1)
    sat = np.clip((s - ex["vapour_sat"][0]) / (ex["vapour_sat"][1] - ex["vapour_sat"][0]), 0, 1)
    return hue * sat * (v > ex["min_value"])


def bands(img: np.ndarray, rows: int) -> np.ndarray:
    """Mean of each of `rows` horizontal bands, top first."""
    return cv2.resize(img.astype(np.float32), (1, rows), interpolation=cv2.INTER_AREA)[:, 0]


# ---------- The track ----------

def day_text(d: datetime) -> str:
    return f"{d.day} {d:%B %Y}"


def span_text(mins: np.ndarray, t0: datetime) -> str:
    """The dates a scene shows, in words: a range, how often NASA's clock jumps back, or a still clock."""
    d0, d1 = (t0 + timedelta(minutes=float(m)) for m in (mins.min(), mins.max()))
    if mins.max() - mins.min() < 60:
        return f"{day_text(d0)} at {d0:%H:%M} UTC, NASA's clock standing still"
    first = f"{d0.day}" if (d0.month, d0.year) == (d1.month, d1.year) else (
        f"{d0.day} {d0:%B}" if d0.year == d1.year else day_text(d0))
    back = np.flatnonzero(np.diff(mins) < -60)
    jumps = len(back) - int(np.sum(np.diff(back) == 1))     # a jump drawn over two frames counts once
    again = f", as NASA's clock jumps back {jumps} time{'s' if jumps > 1 else ''}" if jumps else ""
    return f"{first} to {day_text(d1)}{again}"


def build(cfg: dict) -> dict:
    path, clock_path = source_path(cfg), source_path(cfg, "dates")
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    ex, tm, md, dc = cfg["extraction"], cfg["time"], cfg["media"], cfg["dates"]
    rows, fps_step = ex["rows"], tm["frames_per_step"]
    steps = info["frames"] // fps_step

    vap = np.zeros((steps, rows), np.float32)        # all the vapour in each band
    core = np.zeros((steps, rows), np.float32)       # how much of each band is the river's deep-blue core
    whole = np.zeros(steps, np.float32)
    jumps_seen = np.zeros(info["frames"], np.float32)
    prev = None
    for i, f in video.iter_frames(path, range(info["frames"])):
        small = cv2.resize(f, (ex["width"], ex["height"]), interpolation=cv2.INTER_AREA)
        tiny = cv2.resize(small, (320, 180), interpolation=cv2.INTER_AREA).astype(np.int16)
        if prev is not None:
            jumps_seen[i] = np.abs(tiny - prev).mean()
        prev = tiny
        s = i // fps_step
        if s >= steps:
            continue
        v = vapour_value(small, ex)
        vap[s] += bands(v, rows) / fps_step
        core[s] = np.maximum(core[s], bands(v >= ex["core"], rows))
        whole[s] += v.mean() / fps_step
        if i % 1500 == 0:
            print(f"  frame {i}/{info['frames']}")

    vscale, cscale = float(np.percentile(vap, 99.8)), float(np.percentile(core, 99.8))
    vap, core = np.clip(vap / vscale, 0, 1), np.clip(core / cscale, 0, 1)
    print(f"  steps {steps}, rows {rows}; vapour scale {vscale:.3f}, core scale {cscale:.3f}; "
          f"steps with a strong core {float((core.max(axis=1) > 0.65).mean()):.1%}")

    clock, worst = read_clock(clock_path, dc)
    film_a, clock_a = align(clock, jumps_seen, dc["align_window"])
    print(f"  NASA clock: {len(clock)} frames read, worst digit error {worst:.3f}; "
          f"{len(film_a)} anchors, film offset {', '.join(str(int(c - f)) for f, c in zip(film_a, clock_a))}")
    if worst > dc["max_error"]:
        raise RuntimeError(f"date overlay read badly (error {worst:.3f}); check dates.known")
    at = np.rint(np.interp(np.arange(steps) * fps_step, film_a, clock_a)).astype(int)
    minutes = np.rint(clock[at]).astype(int)
    t0 = datetime.fromisoformat(dc["start"])

    out_dir = MEDIA_DIR / cfg["id"]
    dest = out_dir / "film.mp4"
    if not dest.exists() or ex.get("rebuild_video"):
        transcode.to_web_mp4(path, dest, md["width"], md["height"], md["crf"])
    print(f"  web video {dest.stat().st_size / 1e6:.1f} MB")

    frames = []
    for n, sc in enumerate(cfg["scenes"], 1):
        s0 = int(round(sc["from"] * info["fps"] / fps_step))
        s1 = min(steps, int(round(sc["to"] * info["fps"] / fps_step))) if sc.get("to") else steps
        img = f"scene-{n}.webp"
        mid = int((s0 + s1) / 2 * fps_step)
        still = next(f for _, f in video.iter_frames(path, [mid]))
        small = cv2.resize(still, (md["width"], md["height"]), interpolation=cv2.INTER_AREA)
        out_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_dir / img), small, [cv2.IMWRITE_WEBP_QUALITY, 80])
        if n == 1:
            cv2.imwrite(str(out_dir / "poster.webp"), small, [cv2.IMWRITE_WEBP_QUALITY, 80])
        frames.append({
            "label": sc["title"], "ariaLabel": sc["title"], "place": sc["place"],
            "startStep": s0, "steps": s1 - s0,
            "span": span_text(minutes[s0:s1], t0),
            "image": f"media/{cfg['id']}/{img}",
            "alt": sc["alt"],
            "level": float(whole[s0:s1].mean()),
            "story": sc["story"].strip(),
        })
    top = max(f["level"] for f in frames)
    for f in frames:
        f["relative"] = round(f.pop("level") / top, 3)

    return {
        "id": cfg["id"], "title": cfg["title"], "short": cfg["short"], "method": "camera-bands",
        "source": cfg["source"],
        "media": {"type": "video", "src": f"media/{cfg['id']}/film.mp4", "poster": f"media/{cfg['id']}/poster.webp",
                  "width": md["width"], "height": md["height"], "aspect": round(info["width"] / info["height"], 4),
                  "duration": round(info["frames"] / info["fps"], 3), "fps": info["fps"]},
        "rows": rows, "steps": steps, "framesPerStep": fps_step,
        # NASA's clock at every step: minutes after startDate 00:00 UTC, read from its date overlay.
        "startDate": t0.date().isoformat(), "minutes": minutes.tolist(),
        "chapters": [{"id": "scenes", "title": "The film, scene by scene", "frames": frames}],
        "line": np.rint(vap * 100).astype(int).ravel().tolist(),
        "peak": np.rint(core * 100).astype(int).ravel().tolist(),
        "legend": cfg["legend"],
    }


if __name__ == "__main__":                       # self-checks on drawn pictures, no NASA files needed
    ex = {"vapour_hue": [80, 92, 122, 132], "vapour_sat": [0.35, 0.85], "min_value": 0.2}
    img = np.full((40, 80, 3), (95, 80, 90), np.uint8)            # BGR grey-violet sea
    img[:, :20] = (225, 120, 30)                                    # deep blue vapour
    img[:, 20:40] = (150, 150, 90)                                  # teal: a little vapour
    img[18:19, 40:80] = (250, 250, 250)                             # a white wind streak
    v = vapour_value(img, ex)
    assert v[5, 5] > 0.8 and 0.05 < v[5, 30] < 0.6 and v[18, 60] == 0 and v[5, 60] == 0, (v[5, 5], v[5, 30], v[18, 60])
    clock = np.array([0, 10, 20, 30, 5, 15, 25, 35], float) * 60
    seen = np.ones(8, np.float32)
    seen[4] = 50                                                    # the picture jumps where the clock jumps back
    f_a, c_a = align(clock, seen, 2)
    assert list(f_a) == [0, 4, 7] and list(c_a) == [0, 4, 7], (f_a, c_a)
    t0 = datetime(2010, 10, 1)
    assert span_text(np.array([100000.0, 100020.0]), t0) == "9 December 2010 at 10:40 UTC, NASA's clock standing still"
    assert span_text(np.array([0.0, 99000.0]), t0) == "1 October to 8 December 2010"
    assert span_text(np.array([98000.0, 99500.0, 98800.0, 98000.0, 99500.0]), t0) == "8 to 9 December 2010, as NASA's clock jumps back 1 time"
    print("vapour, clock alignment and spans ok")
