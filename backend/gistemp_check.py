"""Check the A3 numbers against NASA's own published global temperatures.

    python3 backend/gistemp_check.py backend/tracks.config.json data/gistemp/GLB.Ts+dSST.csv

NASA GISS publishes the yearly global mean of GISTEMP v4 in GLB.Ts+dSST.csv
(https://data.giss.nasa.gov/gistemp/, "Land-Ocean: Global Means", column J-D).
This decodes every yearly frame of the "gistemp" source back into numbers, the
same way the music does, and compares its map average with NASA's value.

Two notes for reading the result:
- The video's colours stop at +2 degrees C, so a place hotter than that reads +2:
  the hottest recent years come out slightly low.
- The map average leaves out places with no data, so it is not exactly NASA's
  global mean, which is computed from the full analysis.
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze  # noqa: E402
import build_api  # noqa: E402


def nasa_yearly(path: Path) -> dict[int, float]:
    out = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if len(row) > 13 and row[0].isdigit() and row[13] not in ("***", ""):
                out[int(row[0])] = float(row[13])     # J-D: the January to December mean
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) != 3:
        sys.exit("Usage: python3 backend/gistemp_check.py backend/tracks.config.json GLB.Ts+dSST.csv")
    config, table = Path(sys.argv[1]), Path(sys.argv[2])
    cfg = json.loads(config.read_text(encoding="utf-8"))
    src = build_api.Source("gistemp", cfg["sources"]["gistemp"], config.parent)
    nasa = nasa_yearly(table)
    years, ours, ref = [], [], []
    for i, d in enumerate(src.dates):
        if d.year in nasa:
            v = src.values(i)
            ok = ~np.isnan(v)
            years.append(d.year)
            ours.append(float((np.nan_to_num(v) * src.weights).sum() / src.weights[ok].sum()))
            ref.append(nasa[d.year])
    ours, ref = np.array(ours), np.array(ref)
    err = ours - ref
    worst = int(np.abs(err).argmax())
    print(f"{len(years)} years, {years[0]} to {years[-1]}")
    print(f"  correlation with NASA's yearly global mean: {np.corrcoef(ours, ref)[0, 1]:.3f}")
    print(f"  difference: mean {err.mean():+.3f}, typical {err.std():.3f}, "
          f"largest {err[worst]:+.2f} degrees C ({years[worst]})")
    for y in (years[0], 1950, 2000, years[-1]):
        if y in years:
            k = years.index(y)
            print(f"  {y}: ours {ours[k]:+.2f}, NASA {ref[k]:+.2f}")
