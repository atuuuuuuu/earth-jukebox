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

GRID_COLS, GRID_ROWS = 36, 18
TRACK_KEYS = ("id", "code", "title", "score", "frames", "firstDate", "lastDate", "units", "source")
SCORE_KEYS = ("api", "id", "units", "range", "hotLine", "leftLon", "frames")
FRAME_KEYS = ("date", "image", "mean", "spread", "hot", "clusters", "valid", "grid", "text")


def is_date(s) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except (TypeError, ValueError):
        return False


def check_sweep(public: Path, s: dict, where: str) -> list[str]:
    """A sweep score names the fine grid the sweep engine plays: it must exist and match the frames."""
    out: list[str] = []
    sw = s.get("sweep") or {}
    src = public / str(sw.get("src", ""))
    if not src.is_file():
        return [f"{where}: sweep data not found: {src}"]
    data = json.loads(src.read_text(encoding="utf-8"))
    g = data.get("grid") or {}
    cells = g.get("cols", 0) * g.get("rows", 0)
    chapter = next((c for c in data.get("chapters", []) if c.get("id") == sw.get("chapter")), None)
    if chapter is None:
        return [f"{where}: sweep chapter '{sw.get('chapter')}' not in {src.name}"]
    if not g and len(data.get("line") or []) != data.get("steps", -1) * data.get("rows", -1):
        out.append(f"{where}: spin sweep data must hold steps x rows values in 'line'")
    if len(chapter["frames"]) != len(s.get("frames") or []):
        out.append(f"{where}: {len(s.get('frames') or [])} frames but sweep chapter has {len(chapter['frames'])}")
    for n, (f, fine) in enumerate(zip(s.get("frames") or [], chapter["frames"]), 1):
        if fine.get("image") and f.get("image") != fine.get("image"):
            out.append(f"{where} frame {n}: image differs from the sweep data")
        if not g:   # spin sweep: one line of rows per step, shared by the whole chapter
            continue
        arrays = [k for k in ("core", "glow", "gain", "loss") if k in fine]
        if not arrays or any(len(fine[k]) != cells for k in arrays):
            out.append(f"{where} frame {n}: sweep arrays must each hold {cells} cells")
    if s.get("lesson"):
        lesson = public / str(s["lesson"])
        if not lesson.is_file():
            out.append(f"{where}: lesson not found: {lesson}")
        else:
            steps = json.loads(lesson.read_text(encoding="utf-8")).get("steps") or []
            if not steps or any(not st.get("title") or not st.get("text") for st in steps):
                out.append(f"{where}: a lesson needs steps, each with a title and a text")
    if not (s.get("legend") or {}).get("items"):
        out.append(f"{where}: a sweep score needs a legend with items (the Key reads it)")
    return out


def check(public: Path) -> list[str]:
    problems: list[str] = []
    bad = problems.append
    index_path = public / "api" / "tracks.json"
    if not index_path.exists():
        return [f"Missing {index_path}. Run npm run api (build_sweep.py) first."]
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
            if not is_date(f.get("date")) and not (f.get("date") is None and f.get("when")):
                bad(f"{at}: date '{f.get('date')}' is not YYYY-MM-DD (a sweep map with a 'when' may have none)")
            if not (public / str(f.get("image", ""))).is_file():
                bad(f"{at}: image not found: {f.get('image')}")
            if not in_range(f.get("mean")):
                bad(f"{at}: mean {f.get('mean')} outside the range")
            if not 0 <= f.get("hot", -1) <= 1 or not 0 <= f.get("valid", -1) <= 1:
                bad(f"{at}: hot and valid must be between 0 and 1")
            if not isinstance(f.get("clusters"), int) or f["clusters"] < 0:
                bad(f"{at}: clusters must be a whole number")
            grid = f.get("grid") or []
            if len(grid) != GRID_ROWS or any(len(r) != GRID_COLS or not all(in_range(x) for x in r) for r in grid):
                bad(f"{at}: grid must be {GRID_ROWS} rows of {GRID_COLS} numbers or nulls inside the range")
            # Yearly tracks speak only the year ("words.dates": "year"), so their text starts with it.
            stamp = f.get("when") or (str(f.get("date"))[:4] if (s.get("words") or {}).get("dates") == "year" else str(f.get("date")))
            if not isinstance(f.get("text"), str) or not f["text"].startswith(stamp):
                bad(f"{at}: text must start with '{stamp}'")

        if s.get("engine") == "sweep":
            problems.extend(check_sweep(public, s, where))

        if not any("label" in f for f in frames) and all(f.get("date") for f in frames):
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
