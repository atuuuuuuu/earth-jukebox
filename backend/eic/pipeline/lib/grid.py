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


def to_ints(arr: np.ndarray, scale: float = 100.0) -> list[int]:
    """0..1 floats -> flat row-major ints 0..100 (compact JSON)."""
    return np.clip(np.rint(arr * scale), 0, scale).astype(int).ravel().tolist()
