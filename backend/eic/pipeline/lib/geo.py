"""Geometry helpers: cut one equirectangular world out of a frame, lat/lon <-> pixel."""
from __future__ import annotations

import cv2
import numpy as np


def apply_masks(frame: np.ndarray, rects: list[list[int]], fill=(0, 0, 0)) -> np.ndarray:
    """Paint non-data overlays (labels, colour bars) with a flat fill. Rects are x0,y0,x1,y1."""
    out = frame.copy()
    for x0, y0, x1, y1 in rects or []:
        out[y0:y1, x0:x1] = fill
    return out


def extract_world(frame: np.ndarray, geom: dict) -> np.ndarray:
    """Return an equirectangular image whose column 0 is 180°W and row 0 is 90°N."""
    x0, w, h = geom["map_x0"], geom["map_width"], geom["map_height"]
    world = frame[:h, x0 : x0 + w]
    shift = int(round((geom["lon_at_x0"] + 180.0) / 360.0 * w))
    return np.roll(world, shift, axis=1)


def to_display(world: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resize to a true 2:1 map for the browser."""
    return cv2.resize(world, (width, height), interpolation=cv2.INTER_AREA)


def lonlat_to_px(lon: float, lat: float, width: int, height: int) -> tuple[int, int]:
    x = int(((lon + 180.0) % 360.0) / 360.0 * width)
    y = int((90.0 - lat) / 180.0 * height)
    return min(max(x, 0), width - 1), min(max(y, 0), height - 1)


def lonlat_to_cell(lon: float, lat: float, cols: int, rows: int) -> tuple[int, int]:
    """(row, col) of the grid cell containing lon/lat."""
    c = int(((lon + 180.0) % 360.0) / 360.0 * cols)
    r = int((90.0 - lat) / 180.0 * rows)
    return min(max(r, 0), rows - 1), min(max(c, 0), cols - 1)
