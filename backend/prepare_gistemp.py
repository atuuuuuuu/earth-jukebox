"""Prepare NASA SVS 5603 (GISTEMP, 1880 to 2025) for build_api.py. No ffmpeg needed.

    python3 backend/prepare_gistemp.py data/gistemp

Put these two files from https://svs.gsfc.nasa.gov/5603 in the folder first:
  GISTEMP_2025_equirectangular_2048p.mp4   the flat (equirectangular) map video
  Map_HD_2025_nosmoothing.png              the 2025 map with the labelled colour bar

It writes:
  yearly/1880.png ... yearly/2025.png      one frame per year
  colorbar.png                             the bar from the labelled map, on black

What the video holds, checked by eye and by numbers (see README, "A3"):
- 1741 different frames, then the last one held for 2 seconds. Each frame is a
  12-month average, one month apart: Jan-Dec 1880 first, Jan-Dec 2025 last.
  Every 12th frame is therefore one calendar year, dated at its middle, 1 July.
- The colours are the same palette as the labelled map's bar, but spread over
  -2 to +2 degrees C, not -4 to +4. That is why tracks.config.json sets the
  range to [-2, 2]. backend/gistemp_check.py confirms it against NASA's table.
"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze  # noqa: E402

VIDEO = "GISTEMP_2025_equirectangular_2048p.mp4"
LABELLED = "Map_HD_2025_nosmoothing.png"
FIRST_YEAR, MONTHS = 1880, 1741
BAR = (995, 1032, 661, 1260)      # rows and columns of the bar inside the 1920x1080 labelled map, inside its outline


def main(folder: Path) -> None:
    out = folder / "yearly"
    out.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(folder / VIDEO))
    if not cap.isOpened():
        sys.exit(f"Cannot open {folder / VIDEO}")
    saved = 0
    for k in range(MONTHS):
        if not cap.grab():
            sys.exit(f"The video ended after {k} frames; expected {MONTHS}. Is it the 2025 version?")
        if k % 12 == 0:
            ok, frame = cap.retrieve()
            # Nearest-neighbour scaling keeps NASA's exact colours.
            analyze.imwrite(out / f"{FIRST_YEAR + k // 12}.png",
                            cv2.resize(frame, (1440, 720), interpolation=cv2.INTER_NEAREST))
            saved += 1
    print(f"{saved} yearly frames, {FIRST_YEAR} to {FIRST_YEAR + saved - 1} -> {out}")

    img = analyze.imread(folder / LABELLED)
    if img is None or img.shape[:2] != (1080, 1920):
        sys.exit(f"Expected {LABELLED} at 1920x1080")
    r0, r1, c0, c1 = BAR
    bar = img[r0:r1, c0:c1]
    padded = np.zeros((bar.shape[0] + 40, bar.shape[1] + 40, 3), np.uint8)   # black around it, so the bar is found
    padded[20:-20, 20:-20] = bar
    analyze.imwrite(folder / "colorbar.png", padded)
    found = analyze.read_colourbar(folder / "colorbar.png", -2, 2)
    print(f"colour bar: {len(found.values)} colours -> {folder / 'colorbar.png'}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 backend/prepare_gistemp.py data/gistemp")
    main(Path(sys.argv[1]))
