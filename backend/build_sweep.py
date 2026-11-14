"""Build the API for the sweep tracks (Night Lights): 3-degree grids in, scores out.

    python3 backend/build_sweep.py backend/sweep.config.json

Stage 1 (backend/eic, needs the NASA videos, numpy and OpenCV) reads NASA's Earth
Information Center video into a 3-degree grid and the map images:

    public/data/01_night_lights.json    120 x 60 cells per map (core, glow, gain, loss)
    public/media/01_night_lights/*.webp  the maps, 2048 x 1024, 180 W at the left edge

Stage 2, this script, uses only the Python standard library. For every track in the
config it writes a score that follows backend/API.md, so every part of the page works
on it (Describe, Listen to one spot, Hear the change, the globe and the flat map):

    api/scores/<track id>.json   grid (18 x 36), mean, text ... per map
    api/tracks.json              the sweep tracks added or replaced; other tracks kept

The sweep engine itself plays the full 3-degree grid: the score names it in "sweep".
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

API_VERSION = 1
GRID_ROWS, GRID_COLS = 18, 36
LAT_MIN, LAT_MAX = -60.0, 76.0   # the same rows the sweep engine reads: no ice-sheet texture

# Big cities, most populous first. Only used to name a 10-degree square in the spoken text;
# the light itself always comes from the NASA map.
PLACES = [
    ("Tokyo", 35.7, 139.7), ("Delhi", 28.6, 77.2), ("Shanghai", 31.2, 121.5), ("São Paulo", -23.5, -46.6),
    ("Mexico City", 19.4, -99.1), ("Cairo", 30.0, 31.2), ("Mumbai", 19.1, 72.9), ("Beijing", 39.9, 116.4),
    ("Dhaka", 23.8, 90.4), ("Osaka", 34.7, 135.5), ("New York", 40.7, -74.0), ("Karachi", 24.9, 67.0),
    ("Buenos Aires", -34.6, -58.4), ("Istanbul", 41.0, 29.0), ("Kolkata", 22.6, 88.4), ("Manila", 14.6, 121.0),
    ("Lagos", 6.5, 3.4), ("Rio de Janeiro", -22.9, -43.2), ("Kinshasa", -4.3, 15.3), ("Guangzhou", 23.1, 113.3),
    ("Los Angeles", 34.1, -118.2), ("Moscow", 55.8, 37.6), ("Lahore", 31.5, 74.3), ("Bangalore", 13.0, 77.6),
    ("Paris", 48.9, 2.4), ("Bogotá", 4.7, -74.1), ("Jakarta", -6.2, 106.8), ("Lima", -12.0, -77.0),
    ("Bangkok", 13.8, 100.5), ("Seoul", 37.6, 127.0), ("London", 51.5, -0.1), ("Tehran", 35.7, 51.4),
    ("Chicago", 41.9, -87.6), ("Chengdu", 30.7, 104.1), ("Ho Chi Minh City", 10.8, 106.7), ("Luanda", -8.8, 13.2),
    ("Riyadh", 24.7, 46.7), ("Baghdad", 33.3, 44.4), ("Santiago", -33.4, -70.7), ("Madrid", 40.4, -3.7),
    ("Toronto", 43.7, -79.4), ("Johannesburg", -26.2, 28.0), ("Houston", 29.8, -95.4), ("Dallas", 32.8, -96.8), ("Washington", 38.9, -77.0), ("Atlanta", 33.7, -84.4),
    ("Miami", 25.8, -80.2), ("Berlin", 52.5, 13.4), ("Kyiv", 50.5, 30.5), ("Caracas", 10.5, -66.9),
    ("Nairobi", -1.3, 36.8), ("Addis Ababa", 9.0, 38.7), ("Sydney", -33.9, 151.2), ("Melbourne", -37.8, 145.0),
    ("Dubai", 25.2, 55.3), ("Kabul", 34.5, 69.2), ("Tashkent", 41.3, 69.3), ("Almaty", 43.2, 76.9),
    ("San Francisco", 37.8, -122.4), ("Seattle", 47.6, -122.3), ("Denver", 39.7, -105.0), ("Phoenix", 33.4, -112.1),
    ("Havana", 23.1, -82.4), ("Accra", 5.6, -0.2), ("Dakar", 14.7, -17.4), ("Khartoum", 15.5, 32.5),
    ("Casablanca", 33.6, -7.6), ("Algiers", 36.8, 3.1), ("Rome", 41.9, 12.5), ("Warsaw", 52.2, 21.0), ("Milan", 45.5, 9.2), ("Perth", -32.0, 115.9),
    ("Singapore", 1.35, 103.8), ("Kuala Lumpur", 3.1, 101.7), ("Taipei", 25.0, 121.6), ("Yangon", 16.8, 96.2),
    ("Novosibirsk", 55.0, 82.9), ("Ulaanbaatar", 47.9, 106.9), ("Vladivostok", 43.1, 131.9), ("Cape Town", -33.9, 18.4),
    ("Auckland", -36.8, 174.8), ("Honolulu", 21.3, -157.9), ("Anchorage", 61.2, -149.9), ("Reykjavík", 64.1, -21.9),
    # Smaller cities, so the stormiest and emptiest squares still get a name.
    ("Bangui", 4.4, 18.6), ("Kisangani", 0.5, 25.2), ("Kananga", -5.9, 22.4), ("Lubumbashi", -11.7, 27.5),
    ("Juba", 4.85, 31.6), ("Yaoundé", 3.9, 11.5), ("Billings", 45.8, -108.5), ("Winnipeg", 49.9, -97.1),
    ("Prince George", 53.9, -122.7), ("Calgary", 51.0, -114.1), ("Lhasa", 29.65, 91.1), ("Xining", 36.6, 101.8),
    ("Asunción", -25.3, -57.6), ("Manaus", -3.1, -60.0), ("Darwin", -12.5, 130.8), ("Port Moresby", -9.4, 147.2),
]


class ConfigError(Exception):
    pass


# ---------------------------------------------------------------- geometry

def cell_lat(r: int) -> float:
    """Centre latitude of 10-degree grid row r (row 0 = 80 to 90 N)."""
    return 90 - (r + 0.5) * 10


def cell_lon(c: int, left_lon: float = -180) -> float:
    return left_lon + (c + 0.5) * 10


def deg_text(lat: float, lon: float) -> str:
    ns = "north" if lat > 0 else "south" if lat < 0 else ""
    ew = "east" if lon > 0 else "west" if lon < 0 else ""
    a = f"{abs(round(lat))} degrees {ns}".strip() if round(lat) else "the equator"
    b = f"{abs(round(lon))} degrees {ew}".strip()
    return f"{a}, {b}"


def place_in(r: int, c: int) -> str | None:
    """The most populous listed city inside 10-degree cell (r, c), if any."""
    top, west = 90 - r * 10, -180 + c * 10
    for name, lat, lon in PLACES:
        if top - 10 <= lat < top and west <= lon < west + 10:
            return name
    return None


def where(r: int, c: int) -> str:
    name = place_in(r, c)
    return f"around {name}" if name else f"around {deg_text(cell_lat(r), cell_lon(c))}"


def pool(values: list[float], g: dict, lat_range: tuple[float, float] = (LAT_MIN, LAT_MAX)) -> list[list[float | None]]:
    """Average a fine grid (row 0 = north, col 0 = west) into 18 x 36 cells of 10 degrees.

    Each fine cell goes to the 10-degree cell that holds its centre, weighted by area (cos lat).
    Rows outside lat_range are not read; a cell with none of them left is None.
    """
    rows, cols, step = g["rows"], g["cols"], g["cellDeg"]
    total = [[0.0] * GRID_COLS for _ in range(GRID_ROWS)]
    weight = [[0.0] * GRID_COLS for _ in range(GRID_ROWS)]
    for r in range(rows):
        lat = g["latNorth"] - (r + 0.5) * step
        if not lat_range[0] <= lat <= lat_range[1]:
            continue
        w = math.cos(math.radians(lat))
        R = min(GRID_ROWS - 1, int((90 - lat) // 10))
        for c in range(cols):
            v = values[r * cols + c]
            if v is None:                       # no reading in this fine cell
                continue
            lon = g["lonWest"] + (c + 0.5) * step
            C = min(GRID_COLS - 1, int(((lon + 180) % 360) // 10))
            total[R][C] += w * v
            weight[R][C] += w
    return [[total[R][C] / weight[R][C] if weight[R][C] else None for C in range(GRID_COLS)] for R in range(GRID_ROWS)]


def percentile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    if not xs:
        return 1.0
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def clusters(grid: list[list[float | None]], line: float) -> int:
    """Separate patches of cells at or above `line` (4 neighbours; east and west edges join)."""
    seen = set()
    n = 0
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            if (r, c) in seen or grid[r][c] is None or grid[r][c] < line:
                continue
            n += 1
            todo = [(r, c)]
            seen.add((r, c))
            while todo:
                y, x = todo.pop()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, (x + dx) % GRID_COLS
                    if 0 <= yy < GRID_ROWS and (yy, xx) not in seen and grid[yy][xx] is not None and grid[yy][xx] >= line:
                        seen.add((yy, xx))
                        todo.append((yy, xx))
    return n


def stats(grid: list[list[float | None]], hot_line: float) -> dict:
    w_all = w_data = s = s2 = w_hot = 0.0
    for r in range(GRID_ROWS):
        w = math.cos(math.radians(cell_lat(r)))
        for c in range(GRID_COLS):
            w_all += w
            v = grid[r][c]
            if v is None:
                continue
            w_data += w
            s += w * v
            s2 += w * v * v
            if v >= hot_line:
                w_hot += w
    if not w_data:
        return {"mean": None, "spread": 0.0, "hot": 0.0, "valid": 0.0, "clusters": 0}
    mean = s / w_data
    return {
        "mean": round(mean, 4),
        "spread": round(math.sqrt(max(0.0, s2 / w_data - mean * mean)), 4),
        "hot": round(w_hot / w_data, 4),
        "valid": round(w_data / w_all, 4),
        "clusters": clusters(grid, hot_line),
    }


def ranked(grid, sign: int = 1, n: int = 3, floor: float = 0.0) -> list[tuple[int, int, float]]:
    cells = [(r, c, v) for r, row in enumerate(grid) for c, v in enumerate(row) if v is not None and sign * v > floor]
    return sorted(cells, key=lambda t: -sign * t[2])[:n]


def r3(grid):
    return [[None if v is None else round(v, 3) for v in row] for row in grid]


def listing(cells) -> str:
    """'around Tokyo, around Delhi and around Lagos'; semicolons once coordinates (with commas) appear."""
    names = [where(r, c) for r, c, _ in cells]
    if len(names) == 1:
        return names[0]
    if any("degrees" in n for n in names):
        return "; ".join(names[:-1]) + "; and " + names[-1]
    return ", ".join(names[:-1]) + " and " + names[-1]


# ---------------------------------------------------------------- tracks

def build_years(data: dict, chapter: dict, t: dict) -> list[dict]:
    g = data["grid"]
    pooled = [pool([v / 100 for v in f["glow"]], g) for f in chapter["frames"]]
    # One fixed scale for the whole track: 1 = the brightest 10-degree squares of any year.
    scale = percentile([v for grid in pooled for row in grid for v in row if v], 0.99) or 1.0
    base = chapter["frames"][0]["label"]
    frames = []
    for f, grid in zip(chapter["frames"], pooled):
        grid = [[None if v is None else min(1.0, v / scale) for v in row] for row in grid]
        st = stats(grid, t["hotLine"])
        rel = f.get("relativeTotal")
        if f["label"] == base or rel is None:
            change = f"Baseline year for this track."
        else:
            pct = round((rel - 1) * 100)
            change = f"Total light in NASA's map: {abs(pct)} percent {'more' if pct >= 0 else 'less'} than {base}."
        bright = ranked(grid, 1, 3, 0.05)
        text = (f"{f['label']}. {change} Brightest: {listing(bright)}. "
                f"Bright light, half the brightest level or more, covers {round(st['hot'] * 100, 1)} percent "
                f"of the map read, in {st['clusters']} patches.")
        frames.append({
            "date": f"{int(f['label']):04d}-07-01",
            "when": f["label"],
            "image": f["image"],
            "alt": f.get("alt", ""),
            **st,
            "relativeTotal": rel,
            "grid": r3(grid),
            "text": text,
        })
    return frames


def build_change(data: dict, chapter: dict, t: dict) -> list[dict]:
    g = data["grid"]
    frames = []
    for f in chapter["frames"]:
        raw = pool([(a - b) / 100 for a, b in zip(f["gain"], f["loss"])], g)
        scale = percentile([abs(v) for row in raw for v in row if v], 0.99) or 1.0
        grid = [[None if v is None else max(-1.0, min(1.0, v / scale)) for v in row] for row in raw]
        st = stats(grid, t["hotLine"])
        cells = [(r, v) for r, row in enumerate(grid) for v in row if v is not None]
        w = lambda r: math.cos(math.radians(cell_lat(r)))
        wsum = sum(w(r) for r, _ in cells) or 1
        more = sum(w(r) for r, v in cells if v >= 0.05) / wsum
        less = sum(w(r) for r, v in cells if v <= -0.05) / wsum
        gains, losses = ranked(grid, 1, 3, 0.05), ranked(grid, -1, 3, 0.05)
        end = data["chapters"][0]["frames"][-1]["label"] if data["chapters"][0]["frames"] else "2023"
        start = data["chapters"][0]["frames"][0]["label"] if data["chapters"][0]["frames"] else "2012"
        when = f"Change from {start} to {end}"
        text = (f"{when}. Light grew in {round(more * 100, 1)} percent of the map read "
                f"and dimmed in {round(less * 100, 1)} percent. "
                + (f"Most new light: {listing(gains)}. " if gains else "")
                + (f"Most dimming: {listing(losses)}." if losses else "No square dimmed overall."))
        frames.append({
            "date": f"{int(end):04d}-07-01",
            "when": when,
            "image": f["image"],
            "alt": f.get("alt", ""),
            **st,
            "grid": r3(grid),
            "text": text.strip(),
        })
    return frames


def still(public: Path, video: str, seconds: float, out: str) -> str:
    """One frame of a NASA video as a JPEG, made once with ffmpeg (the only non-stdlib step)."""
    dest = public / out
    if not dest.is_file():
        if not shutil.which("ffmpeg"):
            raise ConfigError(f"{out} is missing and ffmpeg is not installed to make it")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{seconds:.2f}", "-i", str(public / video),
                        "-frames:v", "1", "-vf", "scale=1024:-2", "-q:v", "4", str(dest)], check=True)
    return out


def build_weeks(data: dict, chapter: dict, t: dict) -> list[dict]:
    """Spin sweep (carbon dioxide): a fixed line crosses a turning globe. Each step reads one
    meridian, so a week fills only the 10-degree cells the line crossed; the rest stay None."""
    rows, lat_top, lat_step = data["rows"], data["latTop"], data["latStep"]
    line = data["line"]
    frames = []
    for n, f in enumerate(chapter["frames"], 1):
        mid = (f["startStep"] + f["steps"] / 2) * data["framesPerStep"] / data["media"]["fps"]
        image = f.get("image") or still(t["_public"], data["media"]["src"], mid,
                                         (Path(data["media"]["src"]).parent / f"week-{n}.jpg").as_posix())  # a web path: / even on Windows
        total = [[0.0] * GRID_COLS for _ in range(GRID_ROWS)]
        count = [[0] * GRID_COLS for _ in range(GRID_ROWS)]
        for s_ in range(f["startStep"], f["startStep"] + f["steps"]):
            lon = (data["lonAtStep0"] + data["lonPerStep"] * s_ + 180) % 360 - 180
            C = min(GRID_COLS - 1, int((lon + 180) // 10))
            for r in range(rows):
                lat = lat_top - lat_step * (r + 0.5)
                R = min(GRID_ROWS - 1, int((90 - lat) // 10))
                total[R][C] += line[s_ * rows + r] / 100
                count[R][C] += 1
        grid = [[total[R][C] / count[R][C] if count[R][C] else None for C in range(GRID_COLS)] for R in range(GRID_ROWS)]
        st = stats(grid, t["hotLine"])
        year = data.get("year", 2020)
        when = f"Week from {f['from']} {year}"
        rel = f.get("relative")
        busiest = "the busiest week" if rel == 1 else f"{round(rel * 100)} percent of the busiest week"
        dense = ranked(grid, 1, 3, 0.05)
        text = (f"{when}. The scan line crosses {f['region']}. Carbon dioxide on the line: {busiest}. "
                + (f"Densest: {listing(dense)}." if dense else ""))
        frames.append({
            "date": f"{year}-{MONTHS.index(f['from'].split()[1]) + 1:02d}-{int(f['from'].split()[0]):02d}",
            "when": when,
            "image": image,
            "alt": f.get("alt", ""),
            **st,
            "relativeTotal": rel,
            "grid": r3(grid),
            "text": text.strip(),
        })
    return frames


def build_parts(data: dict, chapter: dict, t: dict) -> list[dict]:
    """Lightning in equal parts of NASA's movie, in order: where the storms are in each part."""
    g = data["grid"]
    pooled = [pool([v / 100 for v in f["glow"]], g, tuple(t.get("latRange", (LAT_MIN, LAT_MAX)))) for f in chapter["frames"]]
    scale = percentile([v for grid in pooled for row in grid for v in row if v], 0.99) or 1.0
    totals = [f.get("total") or 0 for f in chapter["frames"]]
    top = max(totals) or 1
    frames = []
    for f, grid in zip(chapter["frames"], pooled):
        grid = [[None if v is None else min(1.0, v / scale) for v in row] for row in grid]
        st = stats(grid, t["hotLine"])
        busy = ranked(grid, 1, 3, 0.05)
        rel = (f.get("total") or 0) / top
        when = f["label"]
        share = f.get("north", 0.5)
        side = ("mostly north of the equator" if share > 0.6 else "mostly south of the equator" if share < 0.4
                else "on both sides of the equator")
        text = (f"{when}. Lightning in this part of NASA's record: "
                + ("the busiest part" if rel == 1 else f"{round(rel * 100)} percent of the busiest part")
                + f", {side}. " + (f"Most lightning: {listing(busy)}." if busy else ""))
        frames.append({
            "date": None,
            "when": when,
            "image": f["image"],
            "alt": f.get("alt", ""),
            **st,
            "relativeTotal": round(rel, 3),
            "grid": r3(grid),
            "text": text.strip(),
        })
    return frames


def build_scenes(data: dict, chapter: dict, t: dict) -> list[dict]:
    """Ocean tour: a moving camera, so there is no map of places: every grid cell is None, and the
    spoken text names where the camera is, the dates, and the scene's story."""
    frames = []
    for f in chapter["frames"]:
        rel = f.get("relative") or 0
        grid = [[None] * GRID_COLS for _ in range(GRID_ROWS)]
        busiest = "the busiest scene" if rel == 1 else f"{round(rel * 100)} percent of the busiest scene"
        text = (f"{f['label']}, {f['from']} to {f['to']}. The camera is over {f['place']}. "
                f"Bright moving water in the picture: {busiest}. {f.get('story', '')}")
        frames.append({
            "date": None, "when": f["label"], "image": f["image"], "alt": f.get("alt", ""),
            **stats(grid, t["hotLine"]), "relativeTotal": rel,
            "grid": grid, "text": text.strip(),
        })
    return frames


def build_pollutants(data: dict, chapter: dict, t: dict) -> list[dict]:
    """Air quality: one map per pollutant, each on its own colour scale (0 clean .. 1 dirty)."""
    g = data["grid"]
    frames = []
    for f in chapter["frames"]:
        gone = set(f.get("missing", []))
        grid = pool([None if j in gone else v / 100 for j, v in enumerate(f["glow"])], g,
                    tuple(t.get("latRange", (LAT_MIN, LAT_MAX))))
        st = stats(grid, t["hotLine"])
        worst = ranked(grid, 1, 4, t["hotLine"] * 0.8)
        cleanest = ranked([[None if v is None else 1 - v for v in row] for row in grid], 1, 2, 0.0)
        when = f["label"]
        text = (f"{when}, {f.get('span', '')}. "
                + (f"Thickest: {listing(worst)}. " if worst else "Nowhere very thick on this map. ")
                + f"{round(st['hot'] * 100)} percent of the map with a reading is in the dirty half of the scale. "
                + (f"Cleanest: {listing(cleanest)}." if cleanest else ""))
        frames.append({
            "date": None, "when": when, "image": f["image"], "alt": f.get("alt", ""), **st,
            "relativeTotal": round((f.get("total") or 0) / max(x.get("total") or 0 for x in chapter["frames"]), 3),
            "grid": r3(grid), "text": text.strip(),
        })
    return frames


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
BUILDERS = {"years": build_years, "change": build_change, "weeks": build_weeks, "parts": build_parts, "pollutants": build_pollutants, "scenes": build_scenes}

LEGEND_KEEP = {"years": ("Ringing notes", "Deep hum"), "change": ("Deep hum", "Rising pair", "Low falling cello")}


def build_track(t: dict, public: Path) -> tuple[dict, dict]:
    for k in ("id", "code", "title", "data", "chapter", "units", "range", "hotLine", "words"):
        if k not in t:
            raise ConfigError(f"Track {t.get('id', '?')}: missing '{k}'")
    src = public / t["data"]
    if not src.is_file():
        raise ConfigError(f"Track {t['id']}: {src} not found. Run the EIC pipeline first (backend/eic).")
    data = json.loads(src.read_text(encoding="utf-8"))
    chapter = next((c for c in data["chapters"] if c["id"] == t["chapter"]), None)
    if chapter is None:
        raise ConfigError(f"Track {t['id']}: no chapter '{t['chapter']}' in {src}")
    frames = BUILDERS[t["chapter"]](data, chapter, {**t, "_public": public})
    s = data["source"]
    legend = dict(data["legend"])
    if t.get("summary"):
        legend["summary"] = t["summary"]
    if t["chapter"] in LEGEND_KEEP:
        legend["items"] = [i for i in legend["items"] if i["sound"].startswith(LEGEND_KEEP[t["chapter"]])]
    score = {
        "api": API_VERSION,
        "id": t["id"],
        "engine": "sweep",
        "units": t["units"],
        "range": t["range"],
        "hotLine": t["hotLine"],
        "leftLon": data.get("grid", {}).get("lonWest", -180),
        "words": t["words"],
        "sweep": {"src": t["data"], "chapter": t["chapter"], "mapping": t.get("mapping", "night-lights"),
                  "instrument": t.get("instrument", "vibraphone")},
        "legend": legend,
        # Names for 10-degree cells that hold a listed city, "row,col": name. Only for speech.
        "places": {f"{r},{c}": n for r in range(GRID_ROWS) for c in range(GRID_COLS) if (n := place_in(r, c))},
        "frames": frames,
    }
    entry = {
        "id": t["id"],
        "code": t["code"],
        "title": t["title"],
        "subtitle": t.get("subtitle", ""),
        "description": t.get("description", ""),
        "score": f"api/scores/{t['id']}.json",
        "frames": len(frames),
        "firstDate": frames[0]["date"],
        "lastDate": frames[-1]["date"],
        "when": f"{frames[0]['when']} to {frames[-1]['when']}" if len(frames) > 1 else frames[0]["when"],
        "units": t["units"],
        "engine": "sweep",
        "source": {
            "title": s["svs_title"],
            "url": s["url"],
            "credit": f"{s['credit']}" + (f", visualizer {s['visualizer']}" if s.get("visualizer") else "") + f". Data: {s['dataset']}",
        },
    }
    return entry, score


def main(config_path: Path) -> None:
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    public = (config_path.parent / cfg.get("out", "../public")).resolve()
    index_path = public / "api" / "tracks.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {
        "api": API_VERSION, "generated": date.today().isoformat(), "sample": False, "tracks": []}
    ours = {t["id"] for t in cfg["tracks"]}
    index["tracks"] = [t for t in index["tracks"] if t["id"] not in ours]
    (public / "api" / "scores").mkdir(parents=True, exist_ok=True)
    for t in cfg["tracks"]:
        entry, score = build_track(t, public)
        out = public / entry["score"]
        out.write_text(json.dumps(score, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index["tracks"].append(entry)
        print(f"{entry['code']} {entry['title']}: {entry['frames']} maps -> {out.relative_to(public)} "
              f"({out.stat().st_size / 1024:.0f} KB)")
    # newline="\n": the same bytes on Windows as on Mac and Linux, so a rebuild makes no diff
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        main(Path(sys.argv[1] if len(sys.argv) > 1 else "backend/sweep.config.json"))
    except ConfigError as e:
        sys.exit(f"Config problem: {e}")
