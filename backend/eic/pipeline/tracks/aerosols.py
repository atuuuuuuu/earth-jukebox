"""Track 03 — GEOS aerosols: one still world map -> a grid for each of four aerosols.

NASA's still (SVS 5669) draws black carbon, dust, sea salt and sulfate as glowing, half-see-through
layers of four colours over a dark Earth. They overlap, so each pixel is unmixed, in linear RGB:

    pixel = bare map + sum over the types k of  a_k * colour_k,   a_k >= 0

The bare map is near-black ocean, grey land or lighter grey ice. Where they are comes from the Blue
Marble (same projection), so grey land is never read as the grey-teal sea salt; the land's grey
follows the Blue Marble's brightness (forest darker, desert lighter), measured from the map itself.
The colours are the swatches of NASA's own key. Four colours in three channels can explain one pixel
in more than one way, so the fewest types that explain the colour win: a type is added only when it
explains a clear share more of it. Sea salt is sea spray, so it is read only over the sea and near
coasts: deep inland, dust over sulfate mixes to the same grey-teal.

City lights and fire dots are drawn on the map but are not aerosol: small white or yellow-white
spots much brighter than their surroundings, on or near land, are painted over first.

Each type's a_k (clipped to 0..1) is averaged over 3-degree cells, and every type is scaled to its
own thickest cells: the key has no numbers, so the values are relative, within each type.
"""
from __future__ import annotations

import re
from datetime import date
from itertools import combinations

import cv2
import numpy as np

from ..config import DEBUG_DIR, MEDIA_DIR, WEB_DIR, RESOURCES, source_path
from ..lib import grid

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
OCEAN, LAND, ICE = 0, 1, 2
# sRGB 0..255 -> linear 0..1, as a lookup table
LINEAR = np.where(np.arange(256) / 255 <= 0.04045, np.arange(256) / 255 / 12.92,
                  ((np.arange(256) / 255 + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb(lin: np.ndarray) -> np.ndarray:
    lin = np.clip(lin, 0, 1)
    s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return np.clip(np.rint(s * 255), 0, 255).astype(np.uint8)


def key_colours(path, n: int) -> list[np.ndarray]:
    """The n swatches of NASA's colour key, left to right, as RGB 0..255.

    The swatches are the big solid (opaque) shapes; the labels' thin strokes vanish when eroded."""
    k = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    alpha = k[..., 3] if k.shape[2] == 4 else np.full(k.shape[:2], 255, np.uint8)
    solid = cv2.erode((alpha == 255).astype(np.uint8), np.ones((7, 7), np.uint8))
    count, labels, st, _ = cv2.connectedComponentsWithStats(solid)
    big = sorted((i for i in range(1, count) if st[i, cv2.CC_STAT_AREA] > 0.004 * solid.size),
                 key=lambda i: st[i, cv2.CC_STAT_LEFT])
    if len(big) != n:
        raise SystemExit(f"Found {len(big)} swatches in {path.name}, expected {n}")
    return [np.median(k[labels == i][:, :3], axis=0)[::-1].astype(np.float32) for i in big]


def surface(cfg: dict, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """(OCEAN, LAND or ICE for every pixel, Blue Marble brightness 0..255), from the Blue Marble
    (same projection as NASA's still, no shift)."""
    bm = cv2.imread(str(WEB_DIR / cfg["source"]["land"]))
    b, g, r = (bm[..., i].astype(np.int16) for i in range(3))
    water = (b > r + 8) & (b > g - 5) & (r < 90)
    ice = ~water & (bm.min(axis=2) > 150)
    cls = np.where(water, OCEAN, np.where(ice, ICE, LAND)).astype(np.uint8)
    lum = cv2.cvtColor(bm, cv2.COLOR_BGR2GRAY)
    return (cv2.resize(cls, (width, height), interpolation=cv2.INTER_NEAREST),
            cv2.resize(lum, (width, height), interpolation=cv2.INTER_LINEAR))


def remove_spots(img: np.ndarray, cls: np.ndarray, sp: dict) -> tuple[np.ndarray, np.ndarray]:
    """Paint over city lights and fire dots: small white or yellow-white spots, much brighter than
    their surroundings in their darkest channel, on or near land and never on ice.
    Returns (cleaned image, mask of what was painted)."""
    y = img.min(axis=2)
    disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * sp["radius"] + 1,) * 2)
    top = cv2.subtract(y, cv2.morphologyEx(y, cv2.MORPH_OPEN, disc))
    near_land = cv2.dilate((cls == LAND).astype(np.uint8), np.ones((2 * sp["coast"] + 1,) * 2, np.uint8))
    spots = ((top > sp["above"]) & (near_land > 0) & (cls != ICE)).astype(np.uint8)
    count, labels, st, _ = cv2.connectedComponentsWithStats(spots, connectivity=8)
    small = np.zeros(count, bool)
    small[1:] = st[1:, cv2.CC_STAT_AREA] <= sp["max_area"]
    mask = cv2.dilate(small[labels].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    fill = cv2.medianBlur(img, 2 * (2 * sp["radius"] + 1) + 1)
    out = img.copy()
    out[mask] = fill[mask]
    return out, mask


def subsets(m: int, most: int = 3):
    for s in range(1, most + 1):
        yield from combinations(range(m), s)


def unmix(r: np.ndarray, E: np.ndarray, per_type: float, floor: float,
          banned: np.ndarray | None = None) -> np.ndarray:
    """Non-negative amounts a (N x m) with r ~= a @ E.T, using the fewest colours that explain r.

    Every subset of up to 3 colours is solved by least squares; a subset with a negative amount is
    not allowed (its non-negative answer is a smaller subset, tried too). The cost of each answer is
    what it leaves unexplained, plus a price per colour used: `per_type` of the colour's own size,
    and `floor`, so faint noise on the bare map stays "no aerosol". banned (N x m, optional): colours
    a pixel may not use."""
    n, m = len(r), E.shape[1]
    size = np.einsum("ij,ij->i", r, r)
    best_cost = size.copy()                      # no aerosol at all
    best = np.zeros((n, m), np.float32)
    for S in subsets(m):
        ES = E[:, S]
        a = r @ np.linalg.pinv(ES).T                 # N x |S|
        ok = (a >= 0).all(axis=1)
        if banned is not None:
            ok &= ~banned[:, list(S)].any(axis=1)
        if not ok.any():
            continue
        res = r - a @ ES.T
        cost = np.einsum("ij,ij->i", res, res) + len(S) * (per_type * size + floor)
        better = ok & (cost < best_cost)
        best_cost[better] = cost[better]
        best[better] = 0
        best[np.ix_(better, list(S))] = a[better]
    return best


def when_of(path) -> tuple[str, str]:
    """('19 August 2025, 20:00 UTC', '2025-08-19') from NASA's file name."""
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})T(\d{2})_(\d{2})", path.name)
    if not m:
        raise SystemExit(f"No date and time in {path.name}")
    y, mo, d, h, mi = map(int, m.groups())
    return f"{d} {MONTHS[mo - 1]} {y}, {h:02d}:{mi:02d} UTC", date(y, mo, d).isoformat()


def heatmap(values: np.ndarray, coast: np.ndarray, label: str) -> np.ndarray:
    img = cv2.applyColorMap((np.clip(values, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_MAGMA)
    img[coast] = (200, 200, 200)
    cv2.putText(img, label, (12, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    return img


def build(cfg: dict) -> dict:
    path = source_path(cfg, "image")
    ex, md = cfg["extraction"], cfg["media"]
    layers = cfg["layers"]
    rows, cols = ex["grid"]["rows"], ex["grid"]["cols"]
    when, day = when_of(path)

    keys = key_colours(RESOURCES / cfg["source"]["key"], len(layers))
    for L, c in zip(layers, keys):
        print(f"  key colour {L['name']:<13} RGB {c.astype(int).tolist()}")

    img = cv2.imread(str(path), cv2.IMREAD_COLOR)[..., ::-1].copy()    # RGB uint8
    H, W = img.shape[:2]
    if H % rows or W % cols:
        raise SystemExit(f"{W}x{H} does not divide into {cols}x{rows} cells")
    print(f"Image {path.name}: {W}x{H}, {when}")
    cls, bm_lum = surface(cfg, W, H)
    img, spots = remove_spots(img, cls, ex["spots"])
    print(f"  city lights and fires painted over: {spots.mean() * 100:.2f} % of the map")

    # The bare map, in linear light. Ocean: its darkest tenth. Ice: its median (aerosol rarely
    # covers it). Land: NASA draws it brighter where the Blue Marble is brighter, so for each band
    # of Blue Marble brightness, the darkest 15 % of that land in the map.
    q = 4                                             # quarter resolution for estimates and images
    small = cv2.resize(img, (W // q, H // q), interpolation=cv2.INTER_AREA)
    cls_s, lum_s = cls[q // 2 :: q, q // 2 :: q], bm_lum[q // 2 :: q, q // 2 :: q]
    lin_s = LINEAR[small]
    ocean = lin_s[cls_s == OCEAN]
    dark = ocean.sum(axis=1)
    base_ocean = ocean[dark <= np.percentile(dark, 10)].mean(axis=0)
    base_ice = np.median(lin_s[cls_s == ICE], axis=0)
    land, land_lum = lin_s[cls_s == LAND], lum_s[cls_s == LAND].astype(np.float32)
    edges = np.percentile(land_lum, np.linspace(0, 100, 25))
    centres, levels = [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        px = land[(land_lum >= lo) & (land_lum <= hi)]
        s = px.sum(axis=1)
        centres.append((lo + hi) / 2)
        levels.append(px[s <= np.percentile(s, 15)].mean(axis=0))
    centres, levels = np.array(centres), np.array(levels)
    land_base = np.stack([np.interp(np.arange(256), centres, levels[:, c]) for c in range(3)], axis=1).astype(np.float32)
    print(f"  bare ocean sRGB {to_srgb(base_ocean).tolist()}; ice {to_srgb(base_ice).tolist()}; "
          f"land from {to_srgb(levels[0]).tolist()} (darkest Blue Marble) to {to_srgb(levels[-1]).tolist()}")

    def bare(c: np.ndarray, lum: np.ndarray) -> np.ndarray:
        out = land_base[lum]
        out[c == OCEAN] = base_ocean
        out[c == ICE] = base_ice
        return out

    # How far inland each pixel is, in degrees, for the types read only near the sea.
    inland = cv2.distanceTransform((cls_s != OCEAN).astype(np.uint8), cv2.DIST_L2, 5) / (W // q / 360)

    # Colours to unmix with: the key's, plus a lit colour for the types that need one (see yaml).
    E, owner = [LINEAR[c.astype(np.uint8)] for c in keys], list(range(len(layers)))
    ids = [L["id"] for L in layers]
    for lid, box in (ex.get("lit") or {}).items():
        k = ids.index(lid)
        (la0, la1), (lo0, lo1) = box["lat"], box["lon"]
        ys = slice(int((90 - la1) / 180 * small.shape[0]), int((90 - la0) / 180 * small.shape[0]))
        xs = slice(int((lo0 + 180) / 360 * small.shape[1]), int((lo1 + 180) / 360 * small.shape[1]))
        px = (lin_s[ys, xs] - base_ocean).reshape(-1, 3)
        lum = px.sum(axis=1)
        pick = px[(lum >= np.percentile(lum, 50)) & (lum <= np.percentile(lum, 95))]
        lit = np.median(pick / pick.sum(axis=1, keepdims=True), axis=0) * E[k].sum()
        E.append(lit.astype(np.float32))
        owner.append(k)
        print(f"  lit colour   {layers[k]['name']:<13} sRGB {to_srgb(lit).tolist()} (key {keys[k].astype(int).tolist()})")
    E = np.stack(E, axis=1)                           # 3 x m
    owner = np.array(owner)
    sea_only = {ids.index(lid): float(deg) for lid, deg in (ex.get("sea_only") or {}).items()}

    # Unmix strip by strip (the 8K map in float would not fit in memory at once).
    n_types, m = len(layers), E.shape[1]
    cell_h, cell_w = H // rows, W // cols
    strip = cell_h * 5
    cells = np.zeros((rows, cols, n_types), np.float64)
    amounts_s = np.zeros((H // q, W // q, m), np.float32)    # per colour, quarter resolution
    resid_s = np.zeros((H // q, W // q), np.float32)
    for y0 in range(0, H, strip):
        lin = LINEAR[img[y0 : y0 + strip]]
        r = (lin - bare(cls[y0 : y0 + strip], bm_lum[y0 : y0 + strip])).reshape(-1, 3)
        far = np.repeat(np.repeat(inland[y0 // q : (y0 + strip) // q], q, axis=0), q, axis=1).ravel()
        banned = np.zeros((len(r), m), bool)
        for j, k in enumerate(owner):
            if k in sea_only:
                banned[:, j] = far > sea_only[k]
        a = unmix(r, E, ex["per_type"], ex["floor"], banned)
        res = np.sqrt(np.einsum("ij,ij->i", r - a @ E.T, r - a @ E.T))
        h = lin.shape[0]
        per_type = np.zeros((len(a), n_types), np.float32)
        for j, k in enumerate(owner):
            per_type[:, k] += a[:, j]
        per_type = np.clip(per_type, 0, 1).reshape(h, W, n_types)
        cells[y0 // cell_h : (y0 + h) // cell_h] = per_type.reshape(h // cell_h, cell_h, cols, cell_w, n_types).mean(axis=(1, 3))
        amounts_s[y0 // q : (y0 + h) // q] = a.reshape(h // q, q, W // q, q, m).mean(axis=(1, 3))
        resid_s[y0 // q : (y0 + h) // q] = res.reshape(h // q, q, W // q, q).mean(axis=(1, 3))
        print(f"  unmixed rows {y0}-{y0 + h} of {H}")

    # Each type on its own scale: 1 = its thickest few cells.
    scales = [float(np.percentile(cells[..., k][cells[..., k] > 0], ex["top_percentile"])) for k in range(n_types)]
    norm = np.clip(cells / np.array(scales), 0, 1)
    combined = norm.max(axis=2)
    for L, s, k in zip(layers, scales, range(n_types)):
        print(f"  {L['name']:<13} scale {s:.4f}; cells above half: {(norm[..., k] >= 0.5).mean() * 100:.1f} %")

    # Pictures: NASA's map without the lights and fires, and each type alone on the bare map.
    out_dir = MEDIA_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.webp"):
        old.unlink()
    size, quality = (md["width"], md["height"]), [cv2.IMWRITE_WEBP_QUALITY, md["webp_quality"]]
    cv2.imwrite(str(out_dir / "aerosols.webp"),
                cv2.resize(small, size, interpolation=cv2.INTER_AREA)[..., ::-1], quality)
    bare_s = bare(cls_s, lum_s)
    for k, L in enumerate(layers):
        mine = owner == k
        alone = bare_s + amounts_s[..., mine] @ E[:, mine].T
        cv2.imwrite(str(out_dir / f"{L['id']}.webp"),
                    cv2.resize(to_srgb(alone), size, interpolation=cv2.INTER_AREA)[..., ::-1], quality)

    # Debug: one heat map per type (each on its own scale, coastlines in grey), the spots painted
    # over, and what the unmixing could not explain.
    dbg = DEBUG_DIR / cfg["id"]
    dbg.mkdir(parents=True, exist_ok=True)
    land = (cls_s != OCEAN).astype(np.uint8)
    coast = (cv2.dilate(land, np.ones((3, 3), np.uint8)) - land) > 0
    pix_types = np.zeros(amounts_s.shape[:2] + (n_types,), np.float32)
    for j, k in enumerate(owner):
        pix_types[..., k] += amounts_s[..., j]
    tiles, grids = [], []
    for k, L in enumerate(layers):
        v = pix_types[..., k] / max(1e-6, np.percentile(pix_types[..., k], 99.5))
        h = heatmap(v, coast, f"{L['name']} (pixels)")
        cv2.imwrite(str(dbg / f"heat_{L['id']}.png"), h)
        tiles.append(cv2.resize(h, (960, 540), interpolation=cv2.INTER_AREA))
        g = cv2.resize(heatmap(norm[..., k], np.zeros_like(norm[..., k], bool), ""), (cols * 8, rows * 8),
                       interpolation=cv2.INTER_NEAREST)
        cv2.putText(g, f"{L['name']} (3-degree grid)", (12, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.imwrite(str(dbg / f"grid_{L['id']}.png"), g)
        grids.append(g)
    cv2.imwrite(str(dbg / "heat_all.png"), np.vstack([np.hstack(tiles[:2]), np.hstack(tiles[2:4])]))
    cv2.imwrite(str(dbg / "grid_all.png"), np.vstack([np.hstack(grids[:2]), np.hstack(grids[2:4])]))
    shown = small.copy()
    shown[cv2.resize(spots.astype(np.uint8), (W // q, H // q), interpolation=cv2.INTER_AREA) > 0] = (255, 0, 255)
    cv2.imwrite(str(dbg / "spots_painted_over.png"), shown[..., ::-1])
    cv2.imwrite(str(dbg / "unexplained.png"), heatmap(resid_s / max(1e-6, np.percentile(resid_s, 99.5)), coast, "unexplained colour"))
    print(f"  debug images: {dbg}")

    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "still-sweep",
        "source": cfg["source"],
        "grid": {"cols": cols, "rows": rows, "lonWest": -180, "latNorth": 90, "cellDeg": 360 / cols},
        # The types on this map: the key's colour, and the picture of the type alone.
        "layers": [{**L, "rgb": c.astype(int).tolist(), "image": f"media/{cfg['id']}/{L['id']}.webp"}
                   for L, c in zip(layers, keys)],
        "chapters": [{"id": "still", "title": "Aerosols, one moment",
                      "secondsPerSweep": cfg["playback"]["seconds_per_sweep"],
                      "frames": [{
                          "label": when,
                          "date": day,
                          "image": f"media/{cfg['id']}/aerosols.webp",
                          "alt": f"NASA's world map of aerosols on {when}, with city lights and fire dots removed: "
                                 "lavender dust, orange-red smoke, blue-grey sea salt and green sulfate over a dark Earth.",
                          "core": grid.to_ints(combined),
                          "glow": grid.to_ints(combined),
                          "layers": {L["id"]: grid.to_ints(norm[..., k]) for k, L in enumerate(layers)},
                      }]}],
        "crossfade": 0.6,
        "legend": cfg["legend"],
    }
