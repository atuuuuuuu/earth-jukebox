"""Build one track:  python -m pipeline.run --track 01_night_lights"""
from __future__ import annotations

import argparse
import importlib
import json
import time

from .config import DATA_DIR, load_track


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--track", required=True, help="track id, e.g. 01_night_lights (or just 01)")
    args = ap.parse_args()

    cfg = load_track(args.track)
    builder = importlib.import_module(f"pipeline.tracks.{cfg['builder']}")
    t0 = time.time()
    data = builder.build(cfg)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / f"{cfg['id']}.json"
    out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB) in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
