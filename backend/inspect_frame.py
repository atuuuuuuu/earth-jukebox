"""Check one real frame by eye before building everything: the Gate 1 test.

    python3 backend/inspect_frame.py data/sst/daily/0001.jpg data/sst/colorbar.jpg --range -4 4

Writes two pictures into the folder you run it from, and prints numbers:

  check_colorbar.png  the legend, with a green box where the decoder found the bar.
                      If the box misses the bar, set "colorbarCrop" in the config.
  check_frame.png     the frame, with land/no-data shaded purple and three spots
                      marked with their decoded values. Compare each spot's colour
                      with the colour bar: the numbers should match by eye.

Add --spot LAT,LON (as many as you like) to choose your own spots.
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("frame")
    p.add_argument("colorbar")
    p.add_argument("--range", nargs=2, type=float, required=True, metavar=("LOW", "HIGH"))
    p.add_argument("--spot", action="append", default=[], help="LAT,LON, for example 0,-140")
    p.add_argument("--left-lon", type=float, default=-180)
    p.add_argument("--max-dist", type=float, default=14.0)
    a = p.parse_args()

    bar = analyze.read_colourbar(a.colorbar, *a.range)
    legend = analyze.imread(a.colorbar)
    if bar.vertical:
        print("Colour bar: vertical (low end at the bottom)")
    else:
        cv2.rectangle(legend, (bar.start, bar.row - 6), (bar.end, bar.row + 6), (0, 200, 0), 2)
        print(f"Colour bar: row {bar.row}, from x={bar.start} to x={bar.end} ({len(bar.values)} colours)")
    analyze.imwrite("check_colorbar.png", legend)

    img = analyze.load_frame(a.frame)
    v = analyze.to_values(img, bar, a.max_dist)
    w = analyze.area_weights()
    f = analyze.summarize(v, w, hot=a.range[1] / 2, date="frame", units="", left_lon=a.left_lon)
    print(f"Mapped area: {f['valid']:.0%} of the Earth (an ocean map should be about 60-70%)")
    print(f"Map average: {f['mean']}   Niño 3.4 box: {f['nino34']}")

    spots = [tuple(map(float, s.split(","))) for s in a.spot] or [(0, -140), (40, -40), (-40, 80)]
    view = cv2.resize(img, (analyze.W * 2, analyze.H * 2), interpolation=cv2.INTER_NEAREST)
    shade = np.isnan(cv2.resize(v, (analyze.W * 2, analyze.H * 2), interpolation=cv2.INTER_NEAREST))
    view[shade] = (0.5 * view[shade] + 0.5 * np.array([160, 40, 160])).astype(np.uint8)
    for lat, lon in spots:
        y = int((90 - lat) / 180 * analyze.H)
        x = int(((lon - a.left_lon) % 360) / 360 * analyze.W)
        y0, y1, x0, x1 = max(y - 2, 0), y + 3, max(x - 2, 0), x + 3
        cell = v[y0:y1, x0:x1]
        value = float(np.nanmean(cell)) if np.isfinite(cell).any() else None
        text = "no data" if value is None else f"{value:+.2f}"
        print(f"Spot {lat:+.0f}, {lon:+.0f}: {text}")
        cv2.circle(view, (2 * x, 2 * y), 10, (0, 0, 0), 2)
        cv2.putText(view, text, (2 * x + 14, 2 * y + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 5)
        cv2.putText(view, text, (2 * x + 14, 2 * y + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    analyze.imwrite("check_frame.png", view)
    print("Wrote check_colorbar.png and check_frame.png. Open them and compare with the colour bar.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
