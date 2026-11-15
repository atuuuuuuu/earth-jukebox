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
# Letters the player already uses (public/app.js): play (K), W, D, H, S, M, C, and A for "all layers".
PLAYER_KEYS = set("kwdhsmca")


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
    # A track plays one chapter of its data, or several in a row (`chapters`).
    found = [next((c for c in data.get("chapters", []) if c.get("id") == i), None) for i in sw.get("chapters") or [sw.get("chapter")]]
    if None in found:
        return [f"{where}: sweep chapter '{sw.get('chapters') or sw.get('chapter')}' not in {src.name}"]
    chapter = {"frames": [f for c in found for f in c["frames"]]}
    if not g and len(data.get("line") or []) != data.get("steps", -1) * data.get("rows", -1):
        out.append(f"{where}: spin sweep data must hold steps x rows values in 'line'")
    if len(chapter["frames"]) != len(s.get("frames") or []):
        out.append(f"{where}: {len(s.get('frames') or [])} frames but sweep chapter has {len(chapter['frames'])}")
    for n, (f, fine) in enumerate(zip(s.get("frames") or [], chapter["frames"]), 1):
        if fine.get("image") and f.get("image") != fine.get("image"):
            out.append(f"{where} frame {n}: image differs from the sweep data")
        if not g:   # spin sweep: one line of rows per step, shared by the whole chapter
            continue
        arrays = [k for k in ("core", "glow", "gain", "loss", "temp") if k in fine]
        if not arrays or any(len(fine[k]) != cells for k in arrays):
            out.append(f"{where} frame {n}: sweep arrays must each hold {cells} cells")
        for L in s.get("layers") or []:
            if len((fine.get("layers") or {}).get(L.get("id"), [])) != cells:
                out.append(f"{where} frame {n}: sweep data needs {cells} cells for layer '{L.get('id')}'")
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
    if "scan" in sw and sw["scan"] not in ("east", "south"):
        out.append(f"{where}: sweep.scan must be \"east\" or \"south\", not {sw['scan']!r}")
    out.extend(check_views_data(s, data, sw.get("chapter"), where))
    return out


def check_views(s: dict, where: str) -> list[str]:
    """`views`: other ways to hear the track (regions, stories). Each map names its window and data."""
    out: list[str] = []
    v = s.get("views")
    if v is None:
        return out
    options = v.get("options") or []
    if not v.get("legend") or not options:
        return [f"{where}: views need a legend and at least one option"]
    ids = [o.get("id") for o in options]
    if len(set(ids)) != len(ids) or not all(ids) or "whole" in ids:
        out.append(f"{where}: view options need unique ids ('whole' is the whole map)")
    key = str(v.get("key", "")).lower()
    layer_keys = {str(L.get("key", "")).lower() for L in s.get("layers") or []}
    if "key" in v and (len(key) != 1 or not key.isalpha() or key in PLAYER_KEYS or key in layer_keys):
        out.append(f"{where}: the views key must be a single letter the player and the layers do not use")
    layer_ids = {L.get("id") for L in s.get("layers") or []}
    base_n = len(s.get("frames") or [])
    for o in options:
        at = f"{where} view '{o.get('id')}'"
        if not o.get("name") or not o.get("frames"):
            out.append(f"{at}: needs a name and frames")
            continue
        for n, f in enumerate(o["frames"], 1):
            when, box = f.get("when"), f.get("box") or []
            if not when or not isinstance(f.get("text"), str) or not f["text"].startswith(when):
                out.append(f"{at} map {n}: text must start with its 'when'")
            if (len(box) != 4 or not all(isinstance(x, (int, float)) for x in box)
                    or not (-180 <= box[0] < box[2] <= 180 and -90 <= box[1] < box[3] <= 90)):
                out.append(f"{at} map {n}: box must be [west, south, east, north] in degrees")
            if not isinstance(f.get("base"), int) or not 0 <= f["base"] < base_n:
                out.append(f"{at} map {n}: base must be the index of one of the track's maps")
            if f.get("focus") is not None and f["focus"] not in layer_ids:
                out.append(f"{at} map {n}: focus '{f['focus']}' is not one of the layers")
    return out


def check_views_data(s: dict, data: dict, chapter: str, where: str) -> list[str]:
    """Every map of every view points at data that the sweep engine can play: full-size arrays."""
    out: list[str] = []
    if not s.get("views"):
        return out
    items = {it.get("id"): it for it in (data.get("views") or {}).get("items", [])}
    for o in s["views"].get("options") or []:
        for n, f in enumerate(o.get("frames") or [], 1):
            at = f"{where} view '{o.get('id')}' map {n}"
            it = items.get(f.get("view"))
            if it is None:
                out.append(f"{at}: view '{f.get('view')}' not in the sweep data")
                continue
            g = it.get("grid") or {}
            cells = g.get("cols", 0) * g.get("rows", 0)
            chs = it.get("chapters") or {}
            fr = (chs.get(f.get("chapter") or chapter) or chs.get("still") or [])
            if not isinstance(f.get("frame"), int) or not 0 <= f["frame"] < len(fr):
                out.append(f"{at}: frame {f.get('frame')} not in the view's data")
                continue
            fine = fr[f["frame"]]
            arrays = [k for k in ("core", "glow", "gain", "loss", "temp") if k in fine]
            if any(len(fine[k]) != cells for k in arrays) or (not arrays and not fine.get("layers")):
                out.append(f"{at}: view arrays must each hold {cells} cells")
            for L in s.get("layers") or []:
                if len((fine.get("layers") or {}).get(L.get("id"), [])) != cells:
                    out.append(f"{at}: view data needs {cells} cells for layer '{L.get('id')}'")
            if f.get("box") != it.get("box"):
                out.append(f"{at}: box differs from the sweep data")
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
        is_grid = lambda g: (isinstance(g, list) and len(g) == GRID_ROWS
                             and all(isinstance(r, list) and len(r) == GRID_COLS and all(in_range(x) for x in r) for r in g))

        layers = s.get("layers")
        if layers is not None:
            ids, keys = [L.get("id") for L in layers], [str(L.get("key", "")).lower() for L in layers]
            if not layers or len(set(ids)) != len(ids) or not all(ids):
                bad(f"{where}: layers need unique ids")
            if len(set(keys)) != len(keys) or any(len(k) != 1 or not k.isalpha() or k in PLAYER_KEYS for k in keys):
                bad(f"{where}: layer keys must be different single letters the player does not use ({''.join(sorted(PLAYER_KEYS))})")
            for L in layers:
                if not L.get("name"):
                    bad(f"{where}: layer '{L.get('id')}' has no name")
                if L.get("image") and not (public / L["image"]).is_file():
                    bad(f"{where}: layer image not found: {L['image']}")
            for n, f in enumerate(frames, 1):
                for i in ids:
                    if not is_grid((f.get("layers") or {}).get(i)):
                        bad(f"{where} frame {n}: layer '{i}' must be {GRID_ROWS} rows of {GRID_COLS} numbers or nulls inside the range")

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

        a = s.get("about")
        if a is not None and not (all(isinstance(a.get(k), str) and a[k] for k in ("what", "who", "when", "where", "why", "how"))
                                  and a.get("journey") and all(j.get("title") and j.get("detail") for j in a["journey"])):
            bad(f"{where}: about needs what, who, when, where, why, how and a journey of title and detail")
        problems.extend(check_views(s, where))
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
