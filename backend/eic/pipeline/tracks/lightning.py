"""Track 07 — Lightning from the ISS: a flat world map video -> lightning grids for equal parts of it, in order.

NASA's Science On a Sphere movie is equirectangular, so the frame *is* the map. Each frame shows the
strikes of a 10-day window as yellow dots on a grey base map. The movie has no date label and does not
run at an even speed (the storms' yearly swing north and south takes 650 to 1260 frames), so we never
guess dates: we cut the part of the movie that shows lightning into equal parts, in order.

Everything is read at the movie's own resolution (4096 x 2048, about 0.09 degrees per pixel). Most
marks are only 2 to 8 pixels across, so shrinking the frame before deciding what is yellow, or
averaging over big cells first, loses them. For each part we write:

  * a 3-degree grid: how much of each cell is covered by yellow marks, averaged over the part;
  * marks: how many separate marks first appear in each 1 x 3 degree cell during the part. A mark
    stays on screen for about 24 frames (the movie's 10-day window), so it is counted once, in the
    sample where it first appears; marks that touch when they appear count by their area.

These are dots drawn in a movie, not NASA's measured flashes: dots that land on dots already shown
are not seen, and the densest storms saturate. The counts are relative, like everything else here.
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


class MarkCounter:
    """Counts lightning marks the first time they appear, at the movie's own resolution.

    A sample's marks are the yellow pixels above `detect` that were not already shown (above the
    lower `shown` level, widened by 2 pixels for compression jitter) in the sample before. Each
    connected group of such pixels is one mark, or, when new marks touch, area / `mark_area` marks.
    """

    def __init__(self, mk: dict, width: int, height: int):
        self.mk, self.w, self.h = mk, width, height
        self.rows, self.cols = mk["rows"], mk["cols"]
        self.shown = None
        self.widen = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        self.mark_area = None

    def _groups(self, mask: np.ndarray):
        n, _, st, cen = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
        return st[1:], cen[1:]

    def add(self, s: np.ndarray, out: np.ndarray) -> int:
        """Add the marks that appear in strike map `s` to the count grid `out`; return how many."""
        mk = self.mk
        if self.mark_area is None:
            # One mark's area: the median of the separate marks in the first frame read.
            st, _ = self._groups(s > mk["detect"])
            areas = st[:, cv2.CC_STAT_AREA]
            self.mark_area = float(np.median(areas[areas <= 40])) if len(areas) else 6.0
        new = s > mk["detect"]
        if self.shown is not None:
            new &= cv2.dilate(self.shown.astype(np.uint8), self.widen) == 0
        self.shown = s > mk["shown"]
        st, cen = self._groups(new)
        if not len(st):
            return 0
        area = st[:, cv2.CC_STAT_AREA]
        # A single pixel counts only when it is clearly yellow; fainter ones are compression noise.
        peak1 = s[st[:, cv2.CC_STAT_TOP], st[:, cv2.CC_STAT_LEFT]]
        keep = (area >= mk["min_area"]) | (peak1 >= 0.5)
        count = np.maximum(1, np.rint(area / self.mark_area)).astype(np.int64)[keep]
        lon = cen[keep, 0] / self.w * 360 - 180
        lat = 90 - cen[keep, 1] / self.h * 180
        r = np.floor((mk["lat_north"] - lat) / (2 * mk["lat_north"] / self.rows)).astype(int)
        c = np.floor((lon + 180) / (360 / self.cols)).astype(int)
        ok = (r >= 0) & (r < self.rows)
        np.add.at(out, (r[ok], np.clip(c[ok], 0, self.cols - 1)), count[ok])
        return int(count[ok].sum())


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    tm, ex, md = cfg["time"], cfg["extraction"], cfg["media"]
    mk = ex["marks"]
    rows, cols = ex["grid"]["rows"], ex["grid"]["cols"]
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
    marks = np.zeros((parts, mk["rows"], mk["cols"]), np.int64)
    counter = MarkCounter(mk, info["width"], info["height"])
    base = None
    # Start one sample early, so the marks already on screen when the lightning starts are known.
    wanted = [i for i in picks if first - tm["sample_every"] <= i < last]
    for k, (i, frame) in enumerate(video.iter_frames(path, wanted)):
        s = strike_value(frame, ex)                    # at the movie's own resolution
        if i < first:
            counter.shown = s > mk["shown"]
            continue
        m = part_of(i)
        # Area averages of the full-resolution strike map, so a 3-pixel mark still counts.
        cell[m] += cv2.resize(s, (cols, rows), interpolation=cv2.INTER_AREA)
        dens[m] += cv2.resize(s, disp, interpolation=cv2.INTER_AREA)
        counter.add(s, marks[m])
        d = cv2.resize(frame, disp, interpolation=cv2.INTER_AREA)
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
    print(f"  one mark is about {counter.mark_area:.1f} pixels; marks per part {marks.sum(axis=(1, 2)).tolist()}")

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
            "markCount": int(marks[m].sum()),
            "marks": marks[m].ravel().tolist(),       # row-major, see markGrid
        })

    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "moving-sweep",
        "source": cfg["source"],
        "grid": {"cols": cols, "rows": rows, "lonWest": -180, "latNorth": 90, "cellDeg": 360 / cols},
        # Mark counts per part: rows of latDeg from latNorth southward, cols of lonDeg from lonWest.
        "markGrid": {"cols": mk["cols"], "rows": mk["rows"], "lonWest": -180, "latNorth": mk["lat_north"],
                     "lonDeg": 360 / mk["cols"], "latDeg": 2 * mk["lat_north"] / mk["rows"],
                     "markArea": round(counter.mark_area, 2)},
        "chapters": [{"id": "parts", "title": "Lightning, in order",
                      "secondsPerSweep": cfg["playback"]["seconds_per_sweep"], "frames": frames}],
        "crossfade": 0.6,
        "legend": cfg["legend"],
    }
