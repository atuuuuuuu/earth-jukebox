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


def validate_co2(data: dict) -> bool:
    """Known features of the DYAMOND CO2 globe, checked where each crosses the centre line."""
    steps, rows = data["steps"], data["rows"]
    line = np.array(data["line"], dtype=np.float32).reshape(steps, rows) / 100.0
    out_dir = DEBUG_DIR / data["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    img = cv2.applyColorMap((np.clip(line.T, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    cv2.imwrite(str(out_dir / "line_time_by_latitude.png"),
                cv2.resize(img, (steps * 3, rows * 8), interpolation=cv2.INTER_NEAREST))

    def row(lat):
        return int(np.clip((data["latTop"] - lat) / data["latStep"], 0, rows - 1))

    def step(lon):  # when the line is over this longitude
        return int(np.clip((lon - data["lonAtStep0"]) / data["lonPerStep"], 0, steps - 1))

    def box(lon0, lon1, lat_n, lat_s):
        a, b = sorted((step(lon0), step(lon1)))
        return float(line[a : b + 1, row(lat_n) : row(lat_s) + 1].mean())

    # Levels are relative (the colour key has no numbers), so the checks are too: known source
    # regions must sit clearly above the whole track's average, clean ocean air far below it.
    avg = float(line.mean())
    ok = True
    checks = [
        ("Eastern China (industry)", box(122, 108, 40, 24), ">=", 1.3 * avg),
        ("Central Africa (fires)", box(30, 12, 10, -12), ">=", 1.3 * avg),
        ("Amazon basin (fires, forest)", box(-50, -70, 5, -15), ">=", 1.3 * avg),
        ("Southern Indian Ocean (clean air)", box(95, 55, -30, -60), "<=", 0.3 * avg),
        ("South Atlantic (clean air)", box(-5, -25, -30, -60), "<=", 0.3 * avg),
    ]
    print(f"  track-wide average level {avg:.2f}")
    for name, v, op, limit in checks:
        passed = v >= limit if op == ">=" else v <= limit
        ok &= passed
        print(f"  [{'PASS' if passed else 'FAIL'}] {name:<34} mean={v:.2f} (want {op} {limit:.2f})")

    # Daily pulse: over central Africa the 8-steps-per-day rhythm should stand out.
    a, b = sorted((step(30), step(12)))
    series = line[a : b + 1, row(5) : row(-10) + 1].mean(axis=1)
    series = series - np.convolve(series, np.ones(8) / 8, mode="same")
    spectrum = np.abs(np.fft.rfft(series))
    k = int(round(len(series) / 8))  # frequency bin of one cycle per day
    strength = float(spectrum[k - 1 : k + 2].max() / (np.median(spectrum[1:]) + 1e-9))
    passed = strength >= 3
    ok &= passed
    print(f"  [{'PASS' if passed else 'FAIL'}] daily pulse over central Africa        {strength:.1f}x the median (want >= 3)")
    print(f"  debug image: {out_dir}")
    return ok


VALIDATORS = {"night_lights": validate_night_lights, "co2_dyamond": validate_co2}


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
