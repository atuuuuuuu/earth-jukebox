"""Turn NASA Earth Information Center map frames back into numbers.

The one idea behind this file: a colour on an EIC map is a drawing of a number,
and the map's colour bar says which number. For every pixel we find the nearest
colour on the bar and read its number back. A pixel that matches no bar colour
(land, labels, borders) becomes NaN, which means "no data", and the music stays
silent there.

Everything assumes a full-globe equirectangular map: x runs 360 degrees of
longitude starting at `left_lon`, y runs from 90 N at the top to 90 S at the
bottom.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import label
from scipy.spatial import cKDTree

W, H = 720, 360          # analysis size in pixels: 0.5 degrees per pixel
COLS = 16                # longitude strips in one west-to-east scan
GRID = (36, 18)          # 10-degree cells (columns, rows) for the listening cursor
MIN_PATCH = 40           # smallest hot patch that counts, in analysis pixels
NINO34_LAT = (-5.0, 5.0)         # the Nino 3.4 box: 5S to 5N ...
NINO34_LON = (-170.0, -120.0)    # ... and 170W to 120W
TROPICS_LAT = (-20.0, 20.0)      # the tropical ocean, for the relative index
NINO_LINE = 0.5          # NOAA's El Nino threshold, applied to the RELATIVE Nino 3.4, degrees C


# ---------------------------------------------------------------- files

def imread(path) -> np.ndarray | None:
    """Like cv2.imread, but also works when the path has non-English letters (Windows)."""
    try:
        data = np.fromfile(str(path), dtype=np.uint8)
    except OSError:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None


def imwrite(path, img: np.ndarray, params=()) -> None:
    """Like cv2.imwrite, but also works when the path has non-English letters (Windows)."""
    ok, buf = cv2.imencode(Path(path).suffix or ".png", img, list(params))
    if not ok:
        raise ValueError(f"Could not encode image for {path}")
    buf.tofile(str(path))


# ---------------------------------------------------------------- colour bar

def to_lab(bgr: np.ndarray) -> np.ndarray:
    """OpenCV BGR (0-255) to CIE Lab, where distance roughly matches what eyes see."""
    return cv2.cvtColor(bgr.astype(np.float32) / 255, cv2.COLOR_BGR2Lab)


@dataclass
class ColourBar:
    tree: cKDTree          # fast nearest-colour lookup
    values: np.ndarray     # the number each bar colour stands for
    row: int               # image row (or column, if vertical) the colours came from
    start: int             # first pixel of the bar along that row
    end: int               # last pixel of the bar along that row
    vertical: bool


def _longest_run(mask: np.ndarray) -> tuple[int, int]:
    """Start and end (inclusive) of the longest run of True values; (-1, -1) if none."""
    best, start = (-1, -1), None
    for i, on in enumerate(np.append(mask, False)):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if i - 1 - start > best[1] - best[0]:
                best = (start, i - 1)
            start = None
    return best


def _find_horizontal_bar(lab: np.ndarray) -> tuple[int, int, int, int] | None:
    """Find a horizontal colour bar in a legend image.

    Rows inside the bar look the same as the rows above and below them (each
    column of a bar is one colour), yet change a lot from left to right. Text
    rows change from one row to the next, and background rows do not change
    from left to right. Returns (first_row, last_row, start_col, end_col).
    """
    h, w, _ = lab.shape
    across = lab.std(axis=1).sum(axis=1)                                  # left-to-right variety
    down = np.r_[np.abs(np.diff(lab, axis=0)).mean(axis=(1, 2)), np.inf]  # change to next row
    rows = (across > 8) & (down < 2.5)
    r0, r1 = _longest_run(rows)
    if r0 < 0 or r1 - r0 < 3:
        return None

    band = np.median(lab[r0 + (r1 - r0) // 4: r1 - (r1 - r0) // 4 + 1], axis=0)   # (w, 3)
    corners = np.array([lab[0, 0], lab[0, -1], lab[-1, 0], lab[-1, -1]])
    background = np.median(corners, axis=0)
    off_bg = np.linalg.norm(band - background, axis=1)
    # The bar proper is coloured for its full height. The pointed "beyond the
    # range" arrows that legends like NASA's add at each end are not, so this
    # leaves them out: the range runs from where one arrow ends to the other.
    coloured = np.linalg.norm(lab - background, axis=2) > 6
    mid = (r0 + r1) // 2
    up, down = coloured[:mid + 1][::-1], coloured[mid:]
    height = (np.where(up.all(axis=0), len(up), np.argmin(up, axis=0))
              + np.where(down.all(axis=0), len(down), np.argmin(down, axis=0)) - 1) * coloured[mid]
    tall = height >= height.max() - 1      # unbroken colour through the bar's full height
    c0, c1 = _longest_run(tall)
    if c0 < 0:
        return None

    # A bar can contain the background colour itself, like the white middle of
    # a blue-white-red bar on a white page. Bridge a gap when the bar fades into
    # the background on both sides of it; a label beside the bar does not fade.
    runs, start = [], None
    for i, on in enumerate(np.append(tall, False)):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append((start, i - 1))
            start = None
    fades = lambda i: off_bg[i] < 30
    k = runs.index((c0, c1))
    while k > 0 and fades(runs[k - 1][1]) and fades(c0):
        k -= 1
        c0 = runs[k][0]
    k = [r[1] for r in runs].index(c1)
    while k < len(runs) - 1 and fades(runs[k + 1][0]) and fades(c1):
        k += 1
        c1 = runs[k][1]
    if c1 - c0 < 32:
        return None

    # Trim an outline: at a bar's ends the colour jumps far more than between
    # neighbouring bar colours.
    steps = np.linalg.norm(np.diff(band[c0:c1 + 1], axis=0), axis=1)
    typical = max(float(np.median(steps)), 0.5)
    while c1 - c0 > 32 and steps[0] > 4 * typical + 3:
        c0 += 1
        steps = steps[1:]
    while c1 - c0 > 32 and steps[-1] > 4 * typical + 3:
        c1 -= 1
        steps = steps[:-1]
    if c1 - c0 < 3 * (r1 - r0 + 1):        # a colour bar is much longer than it is thick
        return None
    return r0, r1, c0 + 1, c1 - 1          # one more pixel in, away from anti-aliasing


def read_colourbar(path: str | Path, vmin: float, vmax: float, crop=None,
                   orientation: str = "auto") -> ColourBar:
    """Read a colour bar image. Its low end must be on the left (or bottom, if vertical).

    `crop` = [x0, y0, x1, y1] cuts the image first, for legends the automatic
    search gets wrong. `orientation` is "auto", "horizontal" or "vertical".
    """
    img = imread(path)
    if img is None:
        raise FileNotFoundError(f"Could not read the colour bar image: {path}")
    if crop:
        x0, y0, x1, y1 = crop
        img = img[y0:y1, x0:x1]
    lab = to_lab(img)

    found, vertical = None, False
    if orientation in ("auto", "horizontal"):
        found = _find_horizontal_bar(lab)
    if found is None and orientation in ("auto", "vertical"):
        # A vertical bar has its high end at the top. Turning the image a
        # quarter turn clockwise puts the bottom (low) end on the left.
        turned = np.rot90(lab, k=-1).copy()
        found = _find_horizontal_bar(turned)
        vertical = found is not None
        if vertical:
            lab = turned
    if found is None:
        raise ValueError(
            f"No colour bar found in {path}. Crop the image to the bar with 'colorbarCrop' "
            "([x0, y0, x1, y1] in pixels) in the config.")

    r0, r1, c0, c1 = found
    colours = _despike(np.median(lab[r0 + (r1 - r0) // 4: r1 - (r1 - r0) // 4 + 1, c0:c1 + 1], axis=0))
    values = np.linspace(vmin, vmax, len(colours))
    return ColourBar(cKDTree(colours), _share_flat_runs(colours, values), (r0 + r1) // 2, c0, c1, vertical)


def _despike(colours: np.ndarray, limit: float = 12.0) -> np.ndarray:
    """Remove tick marks drawn across the bar: a column far from the colours a few
    pixels either side of it is a tick, not part of the colour scale."""
    out = colours.copy()
    for i in range(5, len(colours) - 5):
        ref = np.median(np.r_[colours[i - 5:i - 1], colours[i + 2:i + 6]], axis=0)
        if np.linalg.norm(colours[i] - ref) > limit:
            out[i] = ref
    return out


def _share_flat_runs(colours: np.ndarray, values: np.ndarray, same: float = 0.8) -> np.ndarray:
    """Where the bar holds one colour for a stretch (like a white middle), that colour
    stands for the whole stretch, so read it as the stretch's middle value."""
    out = values.copy()
    start = 0
    for i in range(1, len(colours) + 1):
        if i == len(colours) or np.linalg.norm(colours[i] - colours[start]) > same:
            if i - start > 1:
                out[start:i] = values[start:i].mean()
            start = i
    return out


# ---------------------------------------------------------------- one frame

def load_frame(path: str | Path, crop=None) -> np.ndarray:
    img = imread(path)
    if img is None:
        raise FileNotFoundError(f"Could not read frame: {path}")
    if crop:
        x0, y0, x1, y1 = crop
        img = img[y0:y1, x0:x1]
    return img


def to_values(img: np.ndarray, bar: ColourBar, max_dist: float = 14.0,
              land_colours=(), land_radius: float = 10.0) -> np.ndarray:
    """Invert the colour map. Returns an H x W array of numbers, NaN where there is no data.

    Nearest-neighbour resizing keeps real map colours; smooth resizing would
    blend them into shades the bar does not contain.
    """
    small = cv2.resize(img, (W, H), interpolation=cv2.INTER_NEAREST)
    lab = to_lab(small).reshape(-1, 3)
    dist, idx = bar.tree.query(lab)
    out = bar.values[idx].astype(float)
    out[dist > max_dist] = np.nan
    for colour in land_colours:                      # colours to treat as land, as [B, G, R]
        ref = to_lab(np.array([[colour]], np.uint8))[0, 0]
        out[np.linalg.norm(lab - ref, axis=1) < land_radius] = np.nan
    return out.reshape(H, W)


def ignore_boxes(v: np.ndarray, boxes, frame_shape) -> np.ndarray:
    """Mark rectangles of the frame as no data, such as a burned-in date box.
    Boxes are [x0, y0, x1, y1] in the frame's own pixels."""
    fh, fw = frame_shape[:2]
    for x0, y0, x1, y1 in boxes:
        v[int(y0 * H / fh):int(np.ceil(y1 * H / fh)), int(x0 * W / fw):int(np.ceil(x1 * W / fw))] = np.nan
    return v


def pixel_lat_lon(left_lon: float = -180.0) -> tuple[np.ndarray, np.ndarray]:
    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    lon = (left_lon + (np.arange(W) + 0.5) * 360 / W + 180) % 360 - 180
    return lat, lon


def area_weights() -> np.ndarray:
    """A pixel near the pole covers less of the Earth: weight each one by cos(latitude)."""
    lat, _ = pixel_lat_lon()
    return np.tile(np.cos(np.deg2rad(lat))[:, None], (1, W))


def wmean(v: np.ndarray, w: np.ndarray):
    ok = np.isfinite(v)
    return round(float(np.average(v[ok], weights=w[ok])), 3) if ok.any() else None


def cells(v: np.ndarray, w: np.ndarray, cols: int, rows: int) -> list[list]:
    """Area-weighted mean of each cell, north row first, west column first."""
    out = []
    for vr, wr in zip(np.array_split(v, rows, 0), np.array_split(w, rows, 0)):
        out.append([wmean(a, b) for a, b in zip(np.array_split(vr, cols, 1), np.array_split(wr, cols, 1))])
    return out


def box_mean(v: np.ndarray, w: np.ndarray, lat_range, lon_range, left_lon: float = -180.0):
    """Area-weighted mean inside a lat/lon box. Works for boxes that cross 180 degrees too."""
    lat, lon = pixel_lat_lon(left_lon)
    rows = (lat >= lat_range[0]) & (lat <= lat_range[1])
    width = lon_range[1] - lon_range[0]
    if width >= 360:                             # all the way round
        cols = np.ones_like(lon, dtype=bool)
    else:
        cols = ((lon - lon_range[0]) % 360) <= width % 360
    return wmean(v[np.ix_(rows, cols)], w[np.ix_(rows, cols)])


# ---------------------------------------------------------------- summaries

def _signed(x: float) -> str:
    return f"{x:+.1f}"


def describe(f: dict, units: str, left_lon: float = -180.0) -> str:
    """The spoken description, built from the same numbers as the sound."""
    parts = [f"{f['date']}."]
    known = [(v, k) for k, v in enumerate(f["columns"]) if v is not None]
    if not known or f["mean"] is None:
        return f"{f['date']}. No mapped data in this frame."
    parts.append(f"Map average {_signed(f['mean'])} {units}.")
    if f.get("nino34Relative") is not None:
        side = "above" if f["nino34Relative"] > NINO_LINE else "below"
        parts.append(f"Niño 3.4 at {_signed(f['nino34'])}, {_signed(f['nino34Relative'])} "
                     f"relative to the tropics, {side} the El Niño line.")
    peak, k = max(known)
    lon = (left_lon + (k + 0.5) * 360 / COLS + 180) % 360 - 180
    side = "W" if lon < 0 else "E"
    parts.append(f"Highest strip near {abs(lon):.0f} degrees {side}, at {_signed(peak)}.")
    n = f["clusters"]
    parts.append(f"{f['hot'] * 100:.0f} percent of the mapped area is above the hot line, "
                 f"in {n} {'patch' if n == 1 else 'patches'}.")
    return " ".join(parts)


def summarize(v: np.ndarray, w: np.ndarray, *, hot: float, date: str, units: str,
              left_lon: float = -180.0, nino34: bool = True) -> dict:
    """Everything the browser needs to play one frame."""
    ok = np.isfinite(v)
    mean = wmean(v, w)
    if mean is None:
        f = {"date": date, "mean": None, "spread": 0.0, "hot": 0.0, "clusters": 0,
             "valid": 0.0, "columns": [None] * COLS, "grid": [[None] * GRID[0] for _ in range(GRID[1])]}
        if nino34:
            f.update(nino34=None, tropics=None, nino34Relative=None)
        f["text"] = describe(f, units, left_lon)
        return f

    spread = float(np.sqrt(np.average((v[ok] - mean) ** 2, weights=w[ok])))
    hot_mask = ok & (np.nan_to_num(v, nan=-np.inf) >= hot)
    blobs, _ = label(hot_mask, structure=np.ones((3, 3)))
    sizes = np.bincount(blobs.ravel())[1:]
    f = {
        "date": date,
        "mean": mean,
        "spread": round(spread, 3),
        "hot": round(float(w[hot_mask].sum() / w[ok].sum()), 4),
        "clusters": int((sizes >= MIN_PATCH).sum()),
        "valid": round(float(w[ok].sum() / w.sum()), 4),
        "columns": cells(v, w, COLS, 1)[0],
        "grid": cells(v, w, *GRID),
    }
    if nino34:
        # NOAA now judges El Nino by the RELATIVE Nino 3.4: the box minus the
        # whole tropical ocean, so a warming ocean alone cannot ring the bell.
        f["nino34"] = box_mean(v, w, NINO34_LAT, NINO34_LON, left_lon)
        f["tropics"] = box_mean(v, w, TROPICS_LAT, (-180.0, 180.0), left_lon)
        f["nino34Relative"] = (None if f["nino34"] is None or f["tropics"] is None
                               else round(f["nino34"] - f["tropics"], 3))
    f["text"] = describe(f, units, left_lon)
    return f
