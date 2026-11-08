"""Compare the decoded El Niño numbers for one month with NOAA's monthly discussion.

    python3 backend/nino_check.py backend/tracks.config.json 2026-09

NOAA's ENSO Diagnostic Discussion (cpc.ncep.noaa.gov) reports the RELATIVE
Niño 3.4 for the past month. This prints our month average of that number,
decoded from every daily frame of the month.
"""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze  # noqa: E402
import build_api  # noqa: E402

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) != 3:
        sys.exit("Usage: python3 backend/nino_check.py backend/tracks.config.json YYYY-MM")
    config, month = Path(sys.argv[1]), sys.argv[2]
    cfg = json.loads(config.read_text(encoding="utf-8"))
    year, mon = map(int, month.split("-"))
    for name, s in cfg["sources"].items():
        src = build_api.Source(name, s, config.parent)
        days = [i for i, d in enumerate(src.dates) if (d.year, d.month) == (year, mon)]
        if not days:
            print(f"{name}: no frames in {month}")
            continue
        n34 = [analyze.box_mean(src.values(i), src.weights, analyze.NINO34_LAT, analyze.NINO34_LON, src.left_lon) for i in days]
        trop = [analyze.box_mean(src.values(i), src.weights, analyze.TROPICS_LAT, (-180, 180), src.left_lon) for i in days]
        a, b = sum(n34) / len(n34), sum(trop) / len(trop)
        print(f"{name}, {month} ({len(days)} frames): Niño 3.4 {a:+.2f}, tropics {b:+.2f}, "
              f"relative Niño 3.4 {a - b:+.2f} degrees C")
