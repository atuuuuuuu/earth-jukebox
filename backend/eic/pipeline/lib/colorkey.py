"""Colour key -> value lookup, matched in Lab space."""
from __future__ import annotations

import cv2
import numpy as np


def find_bar(frame: np.ndarray, rect: list[int]) -> tuple[int, int, int, int]:
    """Locate a horizontal colour bar inside rect (x0,y0,x1,y1). Returns bar bbox in frame coords.

    The bar is the widest run of bright, saturated-or-white pixels; text rows are thin and gappy.
    """
    x0, y0, x1, y1 = rect
    region = frame[y0:y1, x0:x1]
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    on = hsv[..., 2] > 90
    fill = on.mean(axis=1)                      # fraction of lit pixels per row
    rows = np.where(fill > 0.6)[0]
    if rows.size == 0:
        raise RuntimeError("Colour bar not found; check key_search_rect")
    ry0, ry1 = rows.min(), rows.max() + 1
    cols = np.where(on[ry0:ry1].mean(axis=0) > 0.8)[0]
    return x0 + cols.min(), y0 + ry0, x0 + cols.max() + 1, y0 + ry1


def sample_key(frame: np.ndarray, bbox, v0: float, v1: float, n: int = 64) -> tuple[np.ndarray, np.ndarray]:
    """Sample n colours along the bar's middle rows. Returns (bgr[n,3] float, values[n])."""
    bx0, by0, bx1, by1 = bbox
    inset = max(2, (by1 - by0) // 4)
    strip = frame[by0 + inset : by1 - inset, bx0 + 3 : bx1 - 3].astype(np.float32)
    colours = strip.mean(axis=0)                # mean over rows -> [width, 3]
    xs = np.linspace(0, colours.shape[0] - 1, n).astype(int)
    values = np.linspace(v0, v1, n, dtype=np.float32)
    return colours[xs], values


def bgr_to_lab(bgr: np.ndarray) -> np.ndarray:
    """float BGR in 0..255 (any shape [...,3]) -> float Lab (L 0..100)."""
    arr = np.clip(bgr, 0, 255).astype(np.float32).reshape(-1, 1, 3) / 255.0
    lab = cv2.cvtColor(arr, cv2.COLOR_BGR2LAB)
    return lab.reshape(bgr.shape)


def normalise_brightness(bgr: np.ndarray) -> np.ndarray:
    """Scale each colour so its brightest channel is 255 (keeps hue, drops intensity)."""
    peak = bgr.max(axis=-1, keepdims=True)
    return np.where(peak > 0, bgr / np.maximum(peak, 1e-6) * 255.0, 0)


def match(lab_px: np.ndarray, key_lab: np.ndarray, key_vals: np.ndarray, max_dist: float):
    """Nearest key colour per pixel. Returns (value, distance); value is NaN where too far."""
    flat = lab_px.reshape(-1, 3)
    out_v = np.empty(flat.shape[0], np.float32)
    out_d = np.empty(flat.shape[0], np.float32)
    chunk = 1 << 18
    for s in range(0, flat.shape[0], chunk):
        d = np.linalg.norm(flat[s : s + chunk, None, :] - key_lab[None, :, :], axis=2)
        idx = d.argmin(axis=1)
        out_v[s : s + chunk] = key_vals[idx]
        out_d[s : s + chunk] = d[np.arange(idx.size), idx]
    out_v[out_d > max_dist] = np.nan
    shape = lab_px.shape[:-1]
    return out_v.reshape(shape), out_d.reshape(shape)
