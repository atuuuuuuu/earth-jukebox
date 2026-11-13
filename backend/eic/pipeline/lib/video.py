"""Frame access for large NASA videos (8K HEVC decodes fine through OpenCV's FFmpeg)."""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable, Iterator

import cv2
import numpy as np


def video_info(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    info = {
        "fps": cap.get(cv2.CAP_PROP_FPS),
        "frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    cap.release()
    return info


def iter_frames(
    path: Path, wanted: Iterable[int], crop: Callable[[np.ndarray], np.ndarray] | None = None
) -> Iterator[tuple[int, np.ndarray]]:
    """Yield (index, BGR frame) for the wanted indices, decoding sequentially.

    Sequential grab() is far faster and more reliable than seeking in HEVC.
    `crop` is applied immediately so we never hold many full 8K frames.
    """
    wanted = sorted(set(wanted))
    if not wanted:
        return
    want = set(wanted)
    cap = cv2.VideoCapture(str(path))
    i = 0
    try:
        while i <= wanted[-1]:
            if not cap.grab():
                break
            if i in want:
                ok, frame = cap.retrieve()
                if ok:
                    yield i, (crop(frame) if crop else frame)
            i += 1
    finally:
        cap.release()


def window_indices(start: int, end: int, n: int) -> list[int]:
    """n frame indices centred in [start, end), avoiding cross-fades at the edges."""
    length = end - start
    if length <= n:
        return list(range(start, end))
    mid = start + length // 2
    half = n // 2
    return list(range(mid - half, mid - half + n))


def median_stack(frames: list[np.ndarray]) -> np.ndarray:
    """Per-pixel median: removes compression flicker without blurring edges."""
    if len(frames) == 1:
        return frames[0]
    return np.median(np.stack(frames, axis=0), axis=0).astype(np.uint8)
