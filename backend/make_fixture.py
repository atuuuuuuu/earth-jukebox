"""Make fake NASA-style data with known answers, for testing and for the frontend's sample API.

    python3 backend/make_fixture.py data/sample

Writes:
  data/sample/colorbar.jpg   a legend like an SVS colour bar: white page, outlined bar, labels
  data/sample/frames/*.jpg   equirectangular SST-anomaly maps, one every 5 days, with land in grey
  data/sample/truth.json     the true numbers behind every frame, to compare the decoder against

The maps contain an El Nino that builds through 2026, so the Nino 3.4 bell has
something to find. None of this is real data.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import imwrite  # noqa: E402

W, H = 1440, 720                 # the size the real frames are extracted at
VMIN, VMAX = -4.0, 4.0           # SVS 5176's colour bar range
FIRST = date(2024, 6, 1)
STEP_DAYS = 5
N = 177                          # 2024-06-01 to 2026-10-29
LAND_BGR = (70, 80, 85)


def bar_colours(n=512):
    """Blue, light blue, a short flat white middle, light red, red (BGR order)."""
    stops = np.array([[110, 30, 10], [235, 190, 150], [255, 255, 255], [255, 255, 255],
                      [150, 170, 245], [20, 20, 170]], np.float32)
    xs = np.array([0, 0.3, 0.47, 0.53, 0.7, 1.0])
    t = np.linspace(0, 1, n)
    return np.stack([np.interp(t, xs, stops[:, c]) for c in range(3)], 1).astype(np.uint8)


def legend(bar):
    page = np.full((512, 1024, 3), 255, np.uint8)
    x0, x1, y0, y1 = 112, 912, 236, 276
    page[y0:y1, x0:x1] = cv2.resize(bar[None], (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
    cv2.rectangle(page, (x0 - 1, y0 - 1), (x1, y1), (0, 0, 0), 1)
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(page, "Sea surface temperature anomaly (degrees C)", (200, 200), font, 0.8, (0, 0, 0), 2)
    for text, x in (("-4", x0 - 18), ("0", (x0 + x1) // 2 - 8), ("4", x1 - 8)):
        cv2.putText(page, text, (x, 316), font, 0.8, (0, 0, 0), 2)
    return page, (x0, x1)


def main(out: Path, n: int = N, step_days: int = STEP_DAYS):
    (out / "frames").mkdir(parents=True, exist_ok=True)
    bar = bar_colours()
    page, bar_x = legend(bar)
    imwrite(out / "colorbar.jpg", page, [cv2.IMWRITE_JPEG_QUALITY, 92])

    lon = (np.arange(W) + 0.5) / W * 360 - 180
    lat = 90 - (np.arange(H) + 0.5) / H * 180
    LON, LAT = np.meshgrid(lon, lat)
    land = ((((LON + 100) / 30) ** 2 + ((LAT - 40) / 25) ** 2 < 1)
            | (((LON - 20) / 25) ** 2 + (LAT / 35) ** 2 < 1)
            | (((LON - 100) / 40) ** 2 + ((LAT - 50) / 20) ** 2 < 1)
            | (((LON - 135) / 18) ** 2 + ((LAT + 25) / 12) ** 2 < 1)
            | (LAT < -70))
    weight = np.cos(np.deg2rad(LAT))
    ocean = ~land
    in_box = (LAT >= -5) & (LAT <= 5) & (LON >= -170) & (LON <= -120)
    tropics = (LAT >= -20) & (LAT <= 20)
    rng = np.random.default_rng(7)

    truth = {"first": FIRST.isoformat(), "stepDays": step_days, "range": [VMIN, VMAX],
             "barX": bar_x, "ocean": float(weight[ocean].sum() / weight.sum()), "frames": []}
    for i in range(n):
        day = FIRST + timedelta(days=i * step_days)
        years = (day - date(2026, 1, 1)).days / 365.25
        # Pacific warm blob: weak La Nina in early 2025, El Nino growing through 2026.
        enso = -0.6 + 2.9 / (1 + np.exp(-4.5 * (years - 0.35)))
        field = (0.25 + 0.15 * years
                 + 0.8 * np.sin(np.deg2rad(LON * 2 + i * 4)) * np.cos(np.deg2rad(LAT))
                 + enso * np.exp(-(((LON + 140) / 38) ** 2 + (LAT / 8) ** 2))
                 + 2.0 * np.exp(-(((LON + 30) / 14) ** 2 + ((LAT - 45 + i * 0.1) / 9) ** 2)))
        field += cv2.GaussianBlur(rng.normal(0, 1.0, (H, W)).astype(np.float32), (0, 0), 8)
        field = np.clip(field, VMIN, VMAX)

        idx = np.round((field - VMIN) / (VMAX - VMIN) * (len(bar) - 1)).astype(int)
        img = bar[idx]
        img[land] = LAND_BGR
        imwrite(out / "frames" / f"{i + 1:04d}.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        truth["frames"].append({
            "date": day.isoformat(),
            "mean": float(np.average(field[ocean], weights=weight[ocean])),
            "nino34": float(np.average(field[in_box & ocean], weights=weight[in_box & ocean])),
            "tropics": float(np.average(field[tropics & ocean], weights=weight[tropics & ocean])),
        })
    truth["last"] = truth["frames"][-1]["date"]
    (out / "truth.json").write_text(json.dumps(truth, indent=1), encoding="utf-8")
    print(f"{n} frames, {truth['first']} to {truth['last']} -> {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "data/sample"))
