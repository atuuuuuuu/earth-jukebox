"""Pool full-resolution value maps to a coarse lat/lon grid."""
from __future__ import annotations

import numpy as np


def _blocks(arr: np.ndarray, rows: int, cols: int) -> np.ndarray:
    h, w = arr.shape
    if h % rows or w % cols:
        raise ValueError(f"{w}x{h} not divisible into {cols}x{rows} grid")
    return arr.reshape(rows, h // rows, cols, w // cols)


def pool(arr: np.ndarray, rows: int, cols: int, how: str = "mean") -> np.ndarray:
    b = _blocks(arr, rows, cols)
    if how == "mean":
        return b.mean(axis=(1, 3))
    if how == "max":
        return b.max(axis=(1, 3))
    if how == "sum":
        return b.sum(axis=(1, 3))
    raise ValueError(how)


def box_grid(box: list[float], deg: float) -> dict:
    """The fine grid of a box [west, south, east, north] in cells of `deg` degrees (row 0 = north)."""
    west, south, east, north = box
    cols, rows = round((east - west) / deg), round((north - south) / deg)
    if abs(cols * deg - (east - west)) > 1e-6 or abs(rows * deg - (north - south)) > 1e-6:
        raise ValueError(f"box {box} is not a whole number of {deg} degree cells")
    return {"cols": cols, "rows": rows, "lonWest": west, "latNorth": north, "cellDeg": deg}


def pool_box(arr: np.ndarray, box: list[float], deg: float, how: str = "mean") -> np.ndarray:
    """Pool the part of an equirectangular world map (row 0 = 90 N, column 0 = 180 W) inside
    box = [west, south, east, north] into cells of `deg` degrees, row 0 = north.

    When the map's pixels do not divide evenly into cells, each cell takes every pixel it touches."""
    h, w = arr.shape[:2]
    g = box_grid(box, deg)
    xs = [(g["lonWest"] + 180 + j * deg) / 360 * w for j in range(g["cols"] + 1)]
    ys = [(90 - g["latNorth"] + i * deg) / 180 * h for i in range(g["rows"] + 1)]
    f = {"mean": np.mean, "max": np.max}[how]
    out = np.zeros((g["rows"], g["cols"]), np.float32)
    for i in range(g["rows"]):
        y0 = int(np.floor(ys[i]))
        y1 = max(y0 + 1, int(np.ceil(ys[i + 1])))
        band = arr[y0:y1]
        for j in range(g["cols"]):
            x0 = int(np.floor(xs[j]))
            out[i, j] = f(band[:, x0 : max(x0 + 1, int(np.ceil(xs[j + 1])))])
    return out


def to_ints(arr: np.ndarray, scale: float = 100.0) -> list[int]:
    """0..1 floats -> flat row-major ints 0..100 (compact JSON)."""
    return np.clip(np.rint(arr * scale), 0, scale).astype(int).ravel().tolist()
