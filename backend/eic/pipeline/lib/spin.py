"""Spin sweep: read a thin vertical line through a rotating globe's centre, frame by frame.

The Earth's rotation does the scanning. Rows are equal steps of latitude along the central
meridian (orthographic view centred on latitude `lat0`), so pitch-by-latitude stays honest
even though the limb is foreshortened on screen.
"""
from __future__ import annotations

import numpy as np


def row_edges_px(cy: float, r: float, lat_top: float, lat_step: float, rows: int, lat0: float = 0.0) -> np.ndarray:
    """Screen y of the edges between latitude rows (rows + 1 values, top first)."""
    lats = lat_top - lat_step * np.arange(rows + 1)
    return cy - r * np.sin(np.radians(lats - lat0))


def pool_rows(strip: np.ndarray, edges: np.ndarray, y0: int) -> tuple[np.ndarray, np.ndarray]:
    """Pool a value strip [h, w] (whose first row is screen y0) into latitude rows.

    Returns (mean, peak): the mean value and the 90th-percentile value in each row.
    """
    rows = len(edges) - 1
    mean = np.zeros(rows, np.float32)
    peak = np.zeros(rows, np.float32)
    for i in range(rows):
        a = int(round(edges[i])) - y0
        b = max(a + 1, int(round(edges[i + 1])) - y0)
        box = strip[a:b]
        mean[i] = box.mean()
        peak[i] = np.percentile(box, 90)
    return mean, peak
