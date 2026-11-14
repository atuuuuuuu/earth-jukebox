"""Read NASA SVS 5669 (GEOS Aerosols, 19 Aug 2025 20:00 UTC) into public/data/05_aerosols.json.

    python3 backend/build_aerosols.py          (npm run aerosols; standard library only)

Ported from team BoboMimi's TerraJuke "The Air We Share" (src/lib/air/analyze.ts, stories.ts):
every other pixel of NASA's still is placed on NASA's own colour bar. The nearest OKLab hue decides the
aerosol, and how far the pixel reaches toward that swatch's colour is its strength (0..1). Rendered
colour, never optical depth. Then:

  * "Around the world": 64 slices of longitude (5.625 degrees), west to east;
  * NASA's six stories: each a longitude/latitude window played as 8 slices;
  * cells: 18 x 36 squares of 10 degrees, for "Explore one place".

For every slice and aerosol: amount = mean strength (clear air counts as 0), lat = strength-weighted
latitude inside the aerosol's strongest 15-degree band (so salt over two oceans is not averaged into
the tropics). build_sweep.py turns this into the score; public/sweep/tracks/aerosols.js plays it.
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "aerosols"
STILL = SRC / "svs5669_aerosols_2025-08-19T20Z_1920x1080.png"
CBAR = SRC / "svs5669_aerosols_cbar.png"
GLOBE = SRC / "svs5669_globe_2048x1024.jpg"
OUT = HERE.parent / "public"
MEDIA = "media/05_aerosols"

W, H = 1920, 1080
SAMPLE = 2            # every other pixel each way: 960 x 540 samples
STEPS = 64
STORY_STEPS = 8
LAT_BAND = 15
HUE_WINDOW = math.radians(40)
MIN_CHROMA, MIN_CHROMA_SALT, MIN_STRENGTH = 0.03, 0.018, 0.06

AEROSOLS = ["blackCarbon", "dust", "seaSalt", "sulfate"]
SWATCH_BOXES = {   # inclusive pixel boxes inside NASA's four colour-bar tiles
    "blackCarbon": (233, 170, 371, 205), "dust": (528, 170, 666, 205),
    "seaSalt": (829, 170, 968, 205), "sulfate": (1123, 170, 1262, 205),
}
VOICES = [   # id, name, instrument, colour (NASA's swatch)
    ("blackCarbon", "Black carbon (smoke)", "Smoky brass", "#d25e45"),
    ("dust", "Dust", "Desert strings", "#c19adc"),
    ("seaSalt", "Sea salt", "Ocean bed", "#85a9a9"),
    ("sulfate", "Sulfate", "Glass bells", "#53dc34"),
]
# NASA's six events on the SVS 5669 page: (id, title, place, aerosol, [lon0, lat0, lon1, lat1], caption)
STORIES = [
    ("sahara", "The Saharan dust journey", "Sahara to the Atlantic and the Caribbean", "dust", (-60, 8, 30, 30),
     "Desert dust from the Sahara crosses the whole Atlantic, hazing Caribbean skies and reaching the United States."),
    ("erin", "Hurricane Erin", "the western Atlantic", "seaSalt", (-80, 20, -66, 33),
     "The first Atlantic hurricane of 2025. Its winds churn the ocean, lifting sea salt into blue spirals, while it draws in dust from Africa."),
    ("africa", "Southern African fire smoke", "southern Africa and the Atlantic", "blackCarbon", (8, -22, 32, -2),
     "Seasonal farm burning sends smoke drifting out over the Atlantic Ocean."),
    ("spain", "Wildfires in Spain", "the Iberian Peninsula", "blackCarbon", (-10, 38, 0, 45),
     "Wildfires raging across several regions of Spain add smoke to the European sky."),
    ("etna", "Mount Etna's plume", "Sicily and southern Europe", "sulfate", (12, 32, 25, 40),
     "Italy's Mount Etna releases streams of sulfate particles over southern Europe."),
    ("kilauea", "Kilauea's sulfate stream", "Hawaii and the central Pacific", "sulfate", (-180, 15, -155, 25),
     "Hawaii's Kilauea volcano sends a narrow stream of sulfate particles westward across the Pacific."),
]


# ---------------------------------------------------------------- PNG and colour

def decode_png(path: Path) -> tuple[int, int, int, bytes]:
    """8-bit RGB or RGBA, non-interlaced (what NASA ships here). Returns width, height, channels, pixels."""
    b = path.read_bytes()
    i, idat = 8, []
    while i < len(b):
        n, kind = struct.unpack(">I4s", b[i:i + 8])
        body = b[i + 8:i + 8 + n]
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, inter = struct.unpack(">IIBBBBB", body)
            if depth != 8 or inter != 0 or ctype not in (2, 6):
                raise ValueError(f"{path.name}: unsupported PNG (depth {depth}, colour type {ctype}, interlace {inter})")
            ch = 4 if ctype == 6 else 3
        elif kind == b"IDAT":
            idat.append(body)
        i += 12 + n
    raw, stride = zlib.decompress(b"".join(idat)), w * ch
    out, prev = bytearray(h * stride), bytearray(stride)
    for y in range(h):
        f, row = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for x in range(ch, stride): row[x] = (row[x] + row[x - ch]) & 255
        elif f == 2:
            for x in range(stride): row[x] = (row[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride): row[x] = (row[x] + (((row[x - ch] if x >= ch else 0) + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = row[x - ch] if x >= ch else 0
                c = prev[x - ch] if x >= ch else 0
                p = a + prev[x] - c
                pa, pb, pc = abs(p - a), abs(p - prev[x]), abs(p - c)
                row[x] = (row[x] + (a if pa <= pb and pa <= pc else prev[x] if pb <= pc else c)) & 255
        out[y * stride:(y + 1) * stride] = row
        prev = row
    return w, h, ch, bytes(out)


def lin(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def oklab_ab(rgb) -> tuple[float, float]:
    r, g, b = (lin(v) for v in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s


def read_legend() -> list[dict]:
    w, _, ch, px = decode_png(CBAR)
    legend = []
    for a in AEROSOLS:
        x0, y0, x1, y1 = SWATCH_BOXES[a]
        tot, n = [0, 0, 0], 0
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                i = (y * w + x) * ch
                for k in range(3): tot[k] += px[i + k]
                n += 1
        rgb = [t / n for t in tot]
        aa, bb = oklab_ab(rgb)
        legend.append({"aerosol": a, "rgb": rgb, "hue": math.atan2(bb, aa), "linear": [lin(v) for v in rgb]})
    return legend


def classify(rgb, legend) -> tuple[int, float]:
    """Aerosol index (0-3, or -1 for clear air) and strength (0-1) of one sRGB pixel."""
    a, b = oklab_ab(rgb)
    chroma, hue = math.hypot(a, b), math.atan2(b, a)
    best, k = min((abs((hue - s["hue"] + math.pi) % (2 * math.pi) - math.pi), i) for i, s in enumerate(legend))
    if best > HUE_WINDOW or chroma < (MIN_CHROMA_SALT if legend[k]["aerosol"] == "seaSalt" else MIN_CHROMA):
        return -1, 0.0
    s = legend[k]["linear"]
    strength = sum(lin(rgb[j]) * s[j] for j in range(3)) / sum(v * v for v in s)
    return (-1, 0.0) if strength < MIN_STRENGTH else (k, min(1.0, strength))


def analyse(legend) -> tuple[int, int, list[int], list[float]]:
    w, h, ch, px = decode_png(STILL)
    assert (w, h) == (W, H), f"expected {W} x {H}, got {w} x {h}"
    fw, fh = W // SAMPLE, H // SAMPLE
    types, strength, cache = [-1] * (fw * fh), [0.0] * (fw * fh), {}
    for y in range(fh):
        for x in range(fw):
            i = (y * SAMPLE * W + x * SAMPLE) * ch
            key = px[i:i + 3]
            c = cache.get(key)
            if c is None:
                c = cache[key] = classify(tuple(key), legend)
            types[y * fw + x], strength[y * fw + x] = c
    return fw, fh, types, strength


# ---------------------------------------------------------------- geography (an equirectangular map)

lon_at = lambda x: x / W * 360 - 180
lat_at = lambda y: 90 - y / H * 180
js_round = lambda v: math.floor(v + 0.5)   # the same rounding as TerraJuke's Math.round


def box_for(lon0, lat0, lon1, lat1) -> tuple[int, int, int, int]:
    x = lambda lon: js_round((lon + 180) / 360 * W)
    y = lambda lat: js_round((90 - lat) / 180 * H)
    return x(lon0), y(lat1), min(W - 1, x(lon1)), min(H - 1, y(lat0))


def mix_in(field, rect) -> list[list]:
    """Per aerosol [amount, lat]: mean strength over the box, and where most of it is (or None)."""
    fw, _, types, strength = field
    x0, y0, x1, y1 = rect
    sx0, sx1, sy0, sy1 = -(-x0 // SAMPLE), x1 // SAMPLE, -(-y0 // SAMPLE), y1 // SAMPLE
    bands = 180 // LAT_BAND
    tot = [0.0] * 4
    bsum = [[0.0] * bands for _ in range(4)]
    blat = [[0.0] * bands for _ in range(4)]
    n = 0
    for y in range(sy0, sy1 + 1):
        lat = lat_at(y * SAMPLE)
        band = min(bands - 1, int((90 - lat) // LAT_BAND))
        for x in range(sx0, sx1 + 1):
            n += 1
            k = types[y * fw + x]
            if k < 0:
                continue
            s = strength[y * fw + x]
            tot[k] += s; bsum[k][band] += s; blat[k][band] += s * lat
    out = []
    for k in range(4):
        best = max(range(bands), key=lambda b: (bsum[k][b], -b))
        out.append([round(tot[k] / n, 5) if n else 0.0, round(blat[k][best] / bsum[k][best], 2) if tot[k] > 0 else None])
    return out


def slices(field, rect, count) -> list[dict]:
    x0, y0, x1, y1 = rect
    width = x1 - x0 + 1
    out = []
    for i in range(count):
        a, b = x0 + (i * width) // count, x0 + ((i + 1) * width) // count - 1
        out.append({"lon0": round(lon_at(a), 3), "lon1": round(lon_at(b + 1), 3), "mix": mix_in(field, (a, y0, b, y1))})
    return out


def build() -> dict:
    legend = read_legend()
    field = analyse(legend)
    counts = [0] * 4
    for k in field[2]:
        if k >= 0: counts[k] += 1
    shares = [c / len(field[2]) for c in counts]
    image = f"{MEDIA}/globe_2048x1024.jpg"
    whole = (0, 0, W - 1, H - 1)
    frames = [{
        "label": "Around the world", "id": "world", "image": image, "box": None, "aerosol": None,
        "place": "the whole planet",
        "caption": "NASA's GEOS model of the air on 19 August 2025 at 20:00 UTC. Earth turns under the needle, west to east.",
        "alt": "NASA GEOS model map of aerosols on 19 August 2025: green sulfate streams across both hemispheres, a lilac river of Saharan dust over the Atlantic, orange-red fire smoke over southern Africa and Spain, and pale blue sea-salt swirls over the oceans, including Hurricane Erin.",
        "mix": mix_in(field, whole), "steps": slices(field, whole, STEPS),
    }]
    for sid, title, place, aerosol, box, caption in STORIES:
        rect = box_for(*box)
        frames.append({
            "label": title, "id": sid, "image": image, "box": list(box), "aerosol": aerosol, "place": place,
            "caption": caption, "alt": f"{title}: the NASA aerosol map, with a box around {place}.",
            "mix": mix_in(field, rect), "steps": slices(field, rect, STORY_STEPS),
        })
    cells = [[mix_in(field, box_for(-180 + c * 10, 80 - r * 10, -170 + c * 10, 90 - r * 10)) for c in range(36)] for r in range(18)]
    prov = json.loads((SRC / "svs5669.provenance.json").read_text(encoding="utf-8"))
    for f in prov["files"]:   # the bytes analysed must be the bytes NASA published
        p = SRC / f["file"]
        if p.exists() and "sha256" in f:
            assert hashlib.sha256(p.read_bytes()).hexdigest() == f["sha256"], f"{p.name}: SHA-256 differs from the provenance file"
    (OUT / MEDIA).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(GLOBE, OUT / image)
    shutil.copyfile(SRC / "svs5669.provenance.json", OUT / MEDIA / "provenance.json")
    return {
        "id": "05_aerosols", "title": "GEOS Aerosols, 19 August 2025", "short": "Aerosols", "method": "slices",
        "source": {
            "svs_title": "GEOS Aerosols (2025)", "url": "https://svs.gsfc.nasa.gov/5669/",
            "credit": "NASA's Global Modeling and Assimilation Office and Scientific Visualization Studio",
            "visualizer": "Joseph V. Ardizzone, Helen-Nicole Kostis; scientist Lesley Ott",
            "dataset": "GEOS-FP 2 km replay (model), 19 August 2025 20:00 UTC. Sound design adapted from team BoboMimi's TerraJuke",
        },
        "legend": {
            "summary": "Four kinds of particles in the air, from NASA's GEOS model at one moment, 19 August 2025: smoke, dust, sea salt and sulfate. Each has its own instrument, and all four play together as Earth turns under the needle, west to east.",
            "method": "The instrument tells you which particle: smoky brass is smoke from fires, desert strings are dust, a soft ocean bed is sea salt, glass bells are sulfate from pollution and volcanoes. Higher notes mean the particles sit further north, and sound more in your left ear; further south is lower, and more in your right. Louder means thicker. Clear air is silent.",
            "items": [{"sound": f"{instr}", "meaning": f"{name}. Louder where there is more of it."} for _, name, instr, _ in VOICES],
            "caveat": "GEOS is a model analysis, not a direct measurement, and NASA's colour bar has no numbers, so loudness follows how strongly a place shows each colour, not how many particles are there. One moment, not a live feed.",
        },
        "voices": [{"id": i, "name": n, "instrument": ins, "colour": col, "share": round(s, 5)} for (i, n, ins, col), s in zip(VOICES, shares)],
        "rules": {"fullAmount": 0.3, "restAmount": 0.004, "scale": [0, 3, 5, 7, 10], "tonic": 2,
                  "baseMidi": {"seaSalt": 38, "blackCarbon": 45, "dust": 50, "sulfate": 62}, "latLow": -60, "latHigh": 75, "notes": 7},
        "cells": cells,
        "chapters": [{"id": "sides", "title": "The Air We Share", "frames": frames}],
    }


if __name__ == "__main__":
    data = build()
    out = OUT / "data" / "05_aerosols.json"
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    sh = ", ".join(f"{v['name']} {v['share'] * 100:.2f}%" for v in data["voices"])
    print(f"{out.relative_to(OUT)}: {len(data['chapters'][0]['frames'])} maps, {out.stat().st_size / 1024:.0f} KB. Shares: {sh}")
    sys.exit(0)
