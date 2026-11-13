"""Paths and track-config loading."""
from __future__ import annotations

import os
from pathlib import Path

import yaml

EIC = Path(__file__).resolve().parent.parent      # backend/eic
REPO = EIC.parent.parent                           # the earth-jukebox repository
TRACKS_DIR = EIC / "tracks"
WEB_DIR = REPO / "public"                          # the website: samples/, data/, media/
DATA_DIR = WEB_DIR / "data"                        # 3-degree grids; backend/build_sweep.py turns them into api/
MEDIA_DIR = WEB_DIR / "media"
DEBUG_DIR = EIC / "debug"

# Raw NASA downloads (the EIC videos) stay out of git. Override with EJ_RESOURCES.
RESOURCES = Path(os.environ.get("EJ_RESOURCES", REPO / "data" / "eic"))


def load_track(track_id: str) -> dict:
    """Load tracks/<track_id>.yaml. Accepts '01' as shorthand for '01_*'."""
    path = TRACKS_DIR / f"{track_id}.yaml"
    if not path.exists():
        matches = sorted(TRACKS_DIR.glob(f"{track_id}*.yaml"))
        if len(matches) != 1:
            raise SystemExit(f"Track '{track_id}' not found (or ambiguous) in {TRACKS_DIR}")
        path = matches[0]
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def source_path(cfg: dict, key: str = "video") -> Path:
    p = RESOURCES / cfg["source"][key]
    if not p.exists():
        raise SystemExit(f"Source file missing: {p}\nSet EJ_RESOURCES to the resources folder.")
    return p
