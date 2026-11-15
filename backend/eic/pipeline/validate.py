"""Sanity-check a built track against places we know:  python -m pipeline.validate --track 01

Prints PASS/FAIL per check and writes heatmaps to debug/<track>/ for eyeballing.
"""
from __future__ import annotations

import argparse
import json

import cv2
import numpy as np

from .config import DATA_DIR, DEBUG_DIR, load_track
from .lib.geo import lonlat_to_cell

# name: (lon, lat)
BRIGHT = {"Cairo": (31.2, 30.0), "Moscow": (37.6, 55.8), "Tokyo": (139.7, 35.7),
          "New York": (-74.0, 40.7), "São Paulo": (-46.6, -23.5), "Delhi": (77.2, 28.6),
          "Los Angeles": (-118.2, 34.1)}
DARK = {"Central Sahara": (12.0, 23.0), "South Pacific": (-130.0, -30.0),
        "Greenland ice": (-40.0, 72.0), "Antarctica": (60.0, -80.0), "Amazon interior": (-65.0, -5.0)}


def _grid(frame: dict, key: str, g: dict) -> np.ndarray:
    return np.array(frame[key], dtype=np.float32).reshape(g["rows"], g["cols"]) / 100.0


def _cell_max(arr, lon, lat, g, radius=1):
    r, c = lonlat_to_cell(lon, lat, g["cols"], g["rows"])
    return float(arr[max(r - radius, 0) : r + radius + 1,
                     [(c + d) % g["cols"] for d in range(-radius, radius + 1)]].max())


def _heatmap(arr: np.ndarray, path, colormap=cv2.COLORMAP_INFERNO):
    img = cv2.applyColorMap((np.clip(arr, 0, 1) * 255).astype(np.uint8), colormap)
    cv2.imwrite(str(path), cv2.resize(img, (arr.shape[1] * 8, arr.shape[0] * 8), interpolation=cv2.INTER_NEAREST))


def validate_night_lights(data: dict) -> bool:
    g = data["grid"]
    ok = True
    out_dir = DEBUG_DIR / data["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    years = data["chapters"][0]["frames"]
    for fr in (years[0], years[-1]):
        core = _grid(fr, "core", g)
        glow = _grid(fr, "glow", g)
        for name, (lon, lat) in BRIGHT.items():
            v = _cell_max(core, lon, lat, g)
            passed = v >= 0.3
            ok &= passed
            print(f"  [{'PASS' if passed else 'FAIL'}] {fr['label']} bright {name:<12} core={v:.2f}")
        for name, (lon, lat) in DARK.items():
            v = _cell_max(glow, lon, lat, g, radius=0)
            passed = v <= 0.05
            ok &= passed
            print(f"  [{'PASS' if passed else 'FAIL'}] {fr['label']} dark   {name:<15} glow={v:.2f}")
        _heatmap(core, out_dir / f"core_{fr['label']}.png")
        _heatmap(glow, out_dir / f"glow_{fr['label']}.png")
    print("  relative total brightness by year:",
          ", ".join(f"{f['label']}={f['relativeTotal']:.3f}" for f in years))

    ch = data["chapters"][1]["frames"][0]
    gain, loss = _grid(ch, "gain", g), _grid(ch, "loss", g)
    rgb = np.dstack([gain, np.zeros_like(gain), loss])  # BGR order: blue=gain, red=loss
    cv2.imwrite(str(out_dir / "change_gain_blue_loss_red.png"),
                cv2.resize((np.clip(rgb * 2, 0, 1) * 255).astype(np.uint8),
                           (g["cols"] * 8, g["rows"] * 8), interpolation=cv2.INTER_NEAREST))
    # Visible in the NASA frame: India and China mostly purple (gain).
    for name, (lon, lat) in {"India": (78, 22), "Eastern China": (114, 30)}.items():
        r, c = lonlat_to_cell(lon, lat, g["cols"], g["rows"])
        gs = float(gain[r - 2 : r + 3, c - 2 : c + 3].sum())
        ls = float(loss[r - 2 : r + 3, c - 2 : c + 3].sum())
        passed = gs > ls
        ok &= passed
        print(f"  [{'PASS' if passed else 'FAIL'}] change {name:<14} gain={gs:.2f} > loss={ls:.2f}")
    print(f"  debug images: {out_dir}")
    return ok


VALIDATORS = {"night_lights": validate_night_lights}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--track", required=True)
    args = ap.parse_args()
    cfg = load_track(args.track)
    data = json.loads((DATA_DIR / f"{cfg['id']}.json").read_text(encoding="utf-8"))
    print(f"Validating {cfg['id']}")
    ok = VALIDATORS[cfg["builder"]](data)
    print("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
