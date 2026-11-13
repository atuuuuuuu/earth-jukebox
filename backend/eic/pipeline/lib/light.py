"""Separate small bright features (city lights) from a dim base map."""
from __future__ import annotations

import cv2
import numpy as np


def tophat_excess(bgr: np.ndarray, kernel_px: int) -> np.ndarray:
    """Per-channel white top-hat: brightness above the local background, float32 BGR.

    The base map (deserts, ice, relief) varies slowly; city lights are small and bright.
    Morphological opening estimates the background under each light.
    """
    se = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_px, kernel_px))
    img = bgr.astype(np.float32)
    bg = cv2.morphologyEx(img, cv2.MORPH_OPEN, se)
    return np.clip(img - bg, 0, None)


def luminance(bgr: np.ndarray) -> np.ndarray:
    b, g, r = bgr[..., 0], bgr[..., 1], bgr[..., 2]
    return 0.114 * b + 0.587 * g + 0.299 * r
