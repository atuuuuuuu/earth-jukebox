"""Check that the API files follow the contract in API.md, so the frontend can trust them.

    python3 backend/validate_api.py public

Prints every problem it finds and exits with an error if there is any.
Run it after every build, and before every deploy.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

COLS, GRID_COLS, GRID_ROWS = 16, 36, 18
TRACK_KEYS = ("id", "code", "title", "score", "frames", "firstDate", "lastDate", "units", "source")
SCORE_KEYS = ("api", "id", "units", "range", "hotLine", "ninoLine", "leftLon", "tuning", "frames")
FRAME_KEYS = ("date", "image", "mean", "spread", "hot", "clusters", "valid", "columns", "grid", "text")


def is_date(s) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except (TypeError, ValueError):
        return False


def check(public: Path) -> list[str]:
    problems: list[str] = []
    bad = problems.append
    index_path = public / "api" / "tracks.json"
    if not index_path.exists():
        return [f"Missing {index_path}. Run build_api.py first."]
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("api") != 1:
        bad("tracks.json: 'api' must be 1")
    tracks = index.get("tracks") or []
    if not tracks:
        bad("tracks.json: no tracks")
    for key in ("id", "code"):
        values = [t.get(key) for t in tracks]
        if len(values) != len(set(values)):
            bad(f"tracks.json: two tracks share the same {key}")

    for t in tracks:
        where = f"track {t.get('id', '?')}"
        for k in TRACK_KEYS:
            if k not in t:
                bad(f"{where}: missing '{k}'")
        score_path = public / t.get("score", "")
        if not score_path.is_file():
            bad(f"{where}: score file not found: {score_path}")
            continue
        s = json.loads(score_path.read_text(encoding="utf-8"))
        for k in SCORE_KEYS:
            if k not in s:
                bad(f"{where}: score missing '{k}'")
        if s.get("id") != t.get("id"):
            bad(f"{where}: score id is {s.get('id')}")
        lo, hi = (s.get("range") or [0, 0])[:2]
        if not lo < hi:
            bad(f"{where}: range must be [low, high]")
        frames = s.get("frames") or []
        if len(frames) != t.get("frames"):
            bad(f"{where}: tracks.json says {t.get('frames')} frames, score has {len(frames)}")
        in_range = lambda x: x is None or (isinstance(x, (int, float)) and lo - 1e-6 <= x <= hi + 1e-6)

        for n, f in enumerate(frames, 1):
            at = f"{where} frame {n}"
            for k in FRAME_KEYS:
                if k not in f:
                    bad(f"{at}: missing '{k}'")
            if not is_date(f.get("date")):
                bad(f"{at}: date '{f.get('date')}' is not YYYY-MM-DD")
            if not (public / str(f.get("image", ""))).is_file():
                bad(f"{at}: image not found: {f.get('image')}")
            if not in_range(f.get("mean")):
                bad(f"{at}: mean {f.get('mean')} outside the range")
            for k in ("nino34", "tropics"):
                if k in f and not in_range(f[k]):
                    bad(f"{at}: {k} {f[k]} outside the range")
            if "nino34" in f:
                rel, n34, trop = f.get("nino34Relative"), f.get("nino34"), f.get("tropics")
                if (rel is None) != (n34 is None or trop is None) or (
                        rel is not None and abs(rel - (n34 - trop)) > 0.002):
                    bad(f"{at}: nino34Relative must equal nino34 minus tropics")
            if not 0 <= f.get("hot", -1) <= 1 or not 0 <= f.get("valid", -1) <= 1:
                bad(f"{at}: hot and valid must be between 0 and 1")
            if not isinstance(f.get("clusters"), int) or f["clusters"] < 0:
                bad(f"{at}: clusters must be a whole number")
            cols = f.get("columns") or []
            if len(cols) != COLS or not all(in_range(x) for x in cols):
                bad(f"{at}: columns must be {COLS} numbers or nulls inside the range")
            grid = f.get("grid") or []
            if len(grid) != GRID_ROWS or any(len(r) != GRID_COLS or not all(in_range(x) for x in r) for r in grid):
                bad(f"{at}: grid must be {GRID_ROWS} rows of {GRID_COLS} numbers or nulls inside the range")
            if not isinstance(f.get("text"), str) or not f["text"].startswith(str(f.get("date"))):
                bad(f"{at}: text must start with the frame's date")

        if not any("label" in f for f in frames):
            dates = [f.get("date") for f in frames]
            if dates != sorted(dates):
                bad(f"{where}: frames are not in date order")
        kb = score_path.stat().st_size / 1024
        if kb > 2048:
            bad(f"{where}: score is {kb:.0f} KB; keep each score under 2 MB so it loads fast")
    return problems


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    public = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    found = check(public)
    for p in found:
        print("PROBLEM:", p)
    if found:
        sys.exit(f"{len(found)} problem(s) found.")
    print("API OK: every file follows the contract.")
