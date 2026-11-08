"""Build the Earth Jukebox API: NASA frames in, JSON files the frontend can fetch out.

    python3 backend/build_api.py backend/tracks.config.json

Reads a config (see tracks.config.json), and writes into the config's "out" folder:

  api/tracks.json              the track list the jukebox shows
  api/scores/<track id>.json   one score per track: every number the music plays
  frames/<track id>/0001.jpg   the map images, sized for the web

There is no server and no database: these are plain files, hosted with the site,
so nothing can go down during the demo. API.md describes every field.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze  # noqa: E402

API_VERSION = 1
WEB_SIZE = (1024, 512)


class ConfigError(Exception):
    pass


# ---------------------------------------------------------------- sources

class Source:
    """One NASA visualization: its frames on disk, their dates and its colour bar."""

    def __init__(self, name: str, cfg: dict, base: Path):
        self.name, self.cfg, self.base = name, cfg, base
        frames_dir = base / cfg["framesDir"]
        self.paths = sorted(p for p in frames_dir.glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if not self.paths:
            raise ConfigError(f"Source '{name}': no .jpg or .png frames in {frames_dir}")
        self.dates = self._dates()
        lo, hi = cfg["range"]
        self.bar = analyze.read_colourbar(base / cfg["colorbar"], lo, hi, cfg.get("colorbarCrop"),
                                          cfg.get("colorbarOrientation", "auto"))
        self.left_lon = float(cfg.get("leftLon", -180))
        self.weights = analyze.area_weights()
        self._cache: dict[int, np.ndarray] = {}

    def _dates(self) -> list[date]:
        """Spread the dates evenly from the first frame's date to the last frame's.

        Read firstDate and lastDate off the first and last frames of the dated
        version of the video. If the video has exactly one frame per day, the
        frame count equals the number of days, and build_api reports that.
        """
        first, last = self.cfg.get("firstDate", ""), self.cfg.get("lastDate", "")
        try:
            first, last = date.fromisoformat(first), date.fromisoformat(last)
        except ValueError:
            raise ConfigError(
                f"Source '{self.name}': set firstDate and lastDate (YYYY-MM-DD). Read them off the "
                "first and last frames of the dated video.") from None
        n = len(self.paths)
        span = (last - first).days
        if n == 1:
            return [first]
        return [first + timedelta(days=round(i * span / (n - 1))) for i in range(n)]

    @property
    def days_per_frame(self) -> float:
        return (self.dates[-1] - self.dates[0]).days / max(len(self.paths) - 1, 1)

    def values(self, i: int) -> np.ndarray:
        if i not in self._cache:
            img = analyze.load_frame(self.paths[i], self.cfg.get("frameCrop"))
            v = analyze.to_values(img, self.bar, self.cfg.get("maxDist", 14.0), self.cfg.get("landColors", []))
            self._cache[i] = analyze.ignore_boxes(v, self.cfg.get("ignoreBoxes", []), img.shape)
        return self._cache[i]

    def nearest(self, day: date) -> int | None:
        """Index of the frame closest to a date, or None if none is within half a frame step."""
        gaps = [abs((d - day).days) for d in self.dates]
        i = int(np.argmin(gaps))
        return i if gaps[i] <= max(1, self.days_per_frame / 2) else None


# ---------------------------------------------------------------- choosing frames

def select(source: Source, rule: dict) -> list[tuple[int, str | None]]:
    """Which frames a track plays, in order, each with an optional label."""
    n = len(source.paths)
    if "every" in rule:
        step = int(rule["every"])
        picks = list(range(0, n, step))
        if n - 1 - picks[-1] >= step / 2:            # always end on the latest data
            picks.append(n - 1)
        return [(i, None) for i in picks]
    if "count" in rule:
        return [(int(i), None) for i in np.unique(np.linspace(0, n - 1, int(rule["count"])).round())]
    if "pairs" in rule:
        p = rule["pairs"]
        then, now = p["years"]
        out = []
        for month in p.get("months", range(1, 13)):
            day = p.get("day", 1)
            a = source.nearest(date(then, month, day))
            b = source.nearest(date(now, month, day))
            if a is not None and b is not None:
                out += [(a, str(then)), (b, str(now))]
        if not out:
            raise ConfigError(f"No {then} and {now} dates both fall inside the frames' date range.")
        return out
    raise ConfigError(f"Unknown frame rule {rule}: use 'every', 'count' or 'pairs'.")


# ---------------------------------------------------------------- one track

def build_track(track: dict, source: Source, out: Path) -> dict:
    tid = track["id"]
    hot = float(track.get("hotLine", source.cfg.get("hotLine", 2)))
    units = source.cfg.get("units", "")
    frames_out = out / "frames" / tid
    if frames_out.exists():
        shutil.rmtree(frames_out)
    frames_out.mkdir(parents=True)

    frames, prev = [], None
    for k, (i, label) in enumerate(select(source, track["select"])):
        f = analyze.summarize(source.values(i), source.weights, hot=hot,
                              date=source.dates[i].isoformat(), units=units,
                              left_lon=source.left_lon, nino34=track.get("nino34", True))
        name = f"{k + 1:04d}.jpg"
        img = analyze.load_frame(source.paths[i], source.cfg.get("frameCrop"))
        analyze.imwrite(frames_out / name, cv2.resize(img, WEB_SIZE, interpolation=cv2.INTER_AREA),
                    [cv2.IMWRITE_JPEG_QUALITY, 85])
        f["image"] = f"frames/{tid}/{name}"
        if label:
            f["label"] = label
            if k % 2 == 1 and prev and prev["mean"] is not None and f["mean"] is not None:
                f["text"] += compare_text(prev, f)
        frames.append(f)
        prev = f

    score = {
        "api": API_VERSION,
        "id": tid,
        "units": units,
        "range": source.cfg["range"],
        "hotLine": hot,
        "ninoLine": analyze.NINO_LINE,
        "leftLon": source.left_lon,
        "tuning": track.get("tuning", {}),
        "frames": frames,
    }
    path = out / "api" / "scores" / f"{tid}.json"
    path.write_text(json.dumps(score, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return score


def compare_text(then: dict, now: dict) -> str:
    """For then-vs-now pairs: say what changed, in the same numbers the music uses."""
    parts = [f" Compared with {then['date']}: map average {now['mean'] - then['mean']:+.1f}"]
    if then.get("nino34") is not None and now.get("nino34") is not None:
        parts.append(f", Niño 3.4 {now['nino34'] - then['nino34']:+.1f}")
    return "".join(parts) + "."


# ---------------------------------------------------------------- everything

def build(config_path: Path) -> dict:
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    base = config_path.parent
    out = base / cfg.get("out", "../public")
    (out / "api" / "scores").mkdir(parents=True, exist_ok=True)

    sources = {name: Source(name, s, base) for name, s in cfg["sources"].items()}
    index = {"api": API_VERSION, "generated": date.today().isoformat(),
             "sample": bool(cfg.get("sample", False)), "tracks": []}
    report = []
    for track in cfg["tracks"]:
        src = sources[track["source"]]
        score = build_track(track, src, out)
        frames = score["frames"]
        index["tracks"].append({
            "id": track["id"],
            "code": track["code"],
            "title": track["title"],
            "subtitle": track.get("subtitle", ""),
            "description": track.get("description", ""),
            "score": f"api/scores/{track['id']}.json",
            "frames": len(frames),
            "firstDate": min(f["date"] for f in frames),
            "lastDate": max(f["date"] for f in frames),
            "units": score["units"],
            "source": {k: src.cfg[k] for k in ("title", "url", "credit") if k in src.cfg},
        })
        size = (out / index["tracks"][-1]["score"]).stat().st_size / 1024
        valid = [f["valid"] for f in frames]
        nino = [f["nino34"] for f in frames if f.get("nino34") is not None]
        rel = [f["nino34Relative"] for f in frames if f.get("nino34Relative") is not None]
        report.append(
            f"{track['code']} {track['title']}: {len(frames)} frames, "
            f"{index['tracks'][-1]['firstDate']} to {index['tracks'][-1]['lastDate']}, {size:.0f} KB, "
            f"mapped area {min(valid):.0%}-{max(valid):.0%}"
            + (f", Niño 3.4 {min(nino):+.1f} to {max(nino):+.1f}" if nino else "")
            + (f" (relative {min(rel):+.1f} to {max(rel):+.1f})" if rel else ""))

    (out / "api" / "tracks.json").write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"API written to {out / 'api'}")
    for name, s in sources.items():
        per_day = "yes" if len(s.paths) == (s.dates[-1] - s.dates[0]).days + 1 else "no"
        print(f"  source {name}: {len(s.paths)} frames, {s.dates[0]} to {s.dates[-1]}, "
              f"{s.days_per_frame:.2f} days per frame (exactly one per day: {per_day}), "
              f"colour bar {len(s.bar.values)} colours")
    for line in report:
        print("  " + line)
    return index


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 backend/build_api.py backend/tracks.config.json")
    try:
        build(Path(sys.argv[1]))
    except (ConfigError, FileNotFoundError, ValueError) as e:
        sys.exit(f"Error: {e}")
