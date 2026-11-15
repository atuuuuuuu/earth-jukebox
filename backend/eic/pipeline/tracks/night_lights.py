"""Track 01 — Night Lights 2012–2023: yearly maps + change map -> grids for a moving sweep."""
from __future__ import annotations

import cv2
import numpy as np

from ..config import MEDIA_DIR, source_path
from ..lib import colorkey, geo, grid, light, video

OCEAN_FILL = (2, 2, 3)  # BGR of the video's near-black ocean


def _light_map(world: np.ndarray, ex: dict, warm_only: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """Return (excess BGR, excess luminance with noise floor applied).

    warm_only: keep only yellowish excess (city lights) and drop neutral grey texture
    (snow/ice relief in the base map). Very bright pixels are kept regardless, because
    saturated city cores render white.
    """
    excess = light.tophat_excess(world, ex["tophat_px"])
    lum = light.luminance(excess)
    keep = lum >= ex["noise_floor"]
    if warm_only:
        warmth = (excess[..., 2] - excess[..., 0]) / (lum + 1.0)
        keep &= (warmth >= ex["warm_min"]) | (lum >= ex["bright_keep"])
    lum[~keep] = 0
    return excess, lum


def _save_display(world: np.ndarray, cfg: dict, name: str) -> str:
    m = cfg["media"]
    out_dir = MEDIA_DIR / cfg["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    img = geo.to_display(world, m["width"], m["height"])
    path = out_dir / f"{name}.webp"
    if not cv2.imwrite(str(path), img, [cv2.IMWRITE_WEBP_QUALITY, m["webp_quality"]]):
        raise RuntimeError(f"Failed to write {path}")
    return f"media/{cfg['id']}/{name}.webp"


def _regions(cfg: dict) -> tuple[list[dict], float]:
    """NASA's zoom regions from the yaml (`views`), and their cell size in degrees."""
    v = cfg.get("views") or {}
    return v.get("items", []), v.get("cell_deg", 0.5)


def _decade_light(world: np.ndarray, items: list[dict]) -> dict:
    """A place's light for "the decade": its brightness above the dark base map, with no "lit"
    threshold (a threshold lets dim lights cross it as they brighten and exaggerates growth).
    Per pixel: luma above the 7 x 7 median around it, summed over the place, at 512 x 288 per world,
    the scale of NASA's EIC print (1024 x 288 for its 1.8 worlds). {"whole": sum, region id: sum}."""
    small = cv2.resize(world, (512, 288), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    y = 0.2126 * small[..., 2] + 0.7152 * small[..., 1] + 0.0722 * small[..., 0]
    base = cv2.medianBlur(np.rint(y * 255).astype(np.uint8), 7).astype(np.float32) / 255
    ex = y - base
    ex[(y < 0.06) | (ex < 0.01)] = 0          # the dark base map, and compression noise
    out = {"whole": float(ex.sum())}
    for R in items:
        w, s_, e, n = R["box"]
        x0, x1 = round((w + 180) / 360 * 512), round((e + 180) / 360 * 512)
        y0, y1 = round((90 - n) / 180 * 288), round((90 - s_) / 180 * 288)
        out[R["id"]] = float(ex[y0:y1, x0:x1].sum())
    return out


def _build_years(cfg: dict, path, regions: dict, decade: dict) -> list[dict]:
    """The yearly maps. Fills `regions` ({id: [{core, glow} per year]}) on each region's fine grid,
    and `decade` ({place: [light per year]}, see _decade_light)."""
    geom, ex = cfg["geometry"], cfg["extraction"]
    rows, cols = ex["grid"]["rows"], ex["grid"]["cols"]
    items, deg = _regions(cfg)
    ch = cfg["chapters"]["years"]
    bounds = ch["boundaries"]
    year_of: dict[int, int] = {}
    for k in range(len(bounds) - 1):
        for i in video.window_indices(bounds[k], bounds[k + 1], ex["median_frames"]):
            year_of[i] = ch["first_year"] + k

    width = geom["map_x0"] + geom["map_width"]
    crop = lambda f: geo.apply_masks(f[:, :width], geom.get("masks"), OCEAN_FILL)

    results, pending, current = [], [], None

    def finish(year, frames):
        world = geo.extract_world(video.median_stack(frames), geom)
        _, lum = _light_map(world, ex, warm_only=True)
        blur = cv2.GaussianBlur(lum, (0, 0), 2)
        core = grid.pool(blur, rows, cols, "max") / 255.0
        glow = grid.pool(lum, rows, cols, "mean")
        for R in items:
            regions.setdefault(R["id"], []).append({
                "core": grid.pool_box(blur, R["box"], deg, "max") / 255.0,
                "glow": grid.pool_box(lum, R["box"], deg, "mean"),
            })
        for place, v in _decade_light(world, items).items():
            decade.setdefault(place, []).append(round(v, 3))
        image = _save_display(world, cfg, str(year))
        results.append({"label": str(year), "image": image, "core": core,
                        "glow": glow, "total": float(lum.sum())})
        print(f"  {year}: lit px {np.count_nonzero(lum):>8}  total {lum.sum():.3e}")

    for i, frame in video.iter_frames(path, year_of.keys(), crop):
        y = year_of[i]
        if current is not None and y != current:
            finish(current, pending)
            pending = []
        current = y
        pending.append(frame)
    if pending:
        finish(current, pending)

    # One shared scale for all years, so year-to-year changes stay audible.
    all_glow = np.concatenate([r["glow"].ravel() for r in results])
    glow_scale = float(np.percentile(all_glow[all_glow > 0], 99.5))
    base_total = results[0]["total"]
    frames = []
    for r in results:
        frames.append({
            "label": r["label"],
            "image": r["image"],
            "alt": f"Night-time map of the world in {r['label']}: city lights shine yellow on a dark Earth.",
            "relativeTotal": round(r["total"] / base_total, 4),
            "core": grid.to_ints(r["core"]),
            "glow": grid.to_ints(np.clip(r["glow"] / glow_scale, 0, 1)),
        })
    # The regions share one scale of their own (all regions, all years): a finer cell holds a
    # brighter share of its city than a 3-degree cell, so the whole map's scale would not fit.
    if regions:
        fine = np.concatenate([y["glow"].ravel() for ys in regions.values() for y in ys])
        fine_scale = float(np.percentile(fine[fine > 0], 99.5))
        for ys in regions.values():
            for y in ys:
                y["core"] = grid.to_ints(np.clip(y["core"], 0, 1))
                y["glow"] = grid.to_ints(np.clip(y["glow"] / fine_scale, 0, 1))
    return frames


def _build_change(cfg: dict, path, regions: dict) -> dict:
    """The change map. Fills `regions` ({id: {gain, loss}}) on each region's fine grid."""
    geom, ex = cfg["geometry"], cfg["extraction"]
    rows, cols = ex["grid"]["rows"], ex["grid"]["cols"]
    items, deg = _regions(cfg)
    ch = cfg["chapters"]["change"]
    sx0, sy0, sx1, sy1 = ch["key_search_rect"]
    width = max(geom["map_x0"] + geom["map_width"], sx1)
    idx = video.window_indices(ch["frames"][0], ch["frames"][1], ex["median_frames"])
    frames = [f for _, f in video.iter_frames(path, idx, lambda f: f[:, :width])]
    img = video.median_stack(frames)

    bbox = colorkey.find_bar(img, ch["key_search_rect"])
    key_bgr, key_vals = colorkey.sample_key(img, bbox, *ch["key_values"])
    key_lab = colorkey.bgr_to_lab(colorkey.normalise_brightness(key_bgr))
    print(f"  colour bar at {bbox}; ends BGR {key_bgr[0].round()} -> {key_bgr[-1].round()}")

    world = geo.extract_world(geo.apply_masks(img, geom.get("masks"), OCEAN_FILL), geom)
    excess, lum = _light_map(world, ex)
    lit = lum > 0
    lab = colorkey.bgr_to_lab(colorkey.normalise_brightness(excess[lit]))
    t, dist = colorkey.match(lab, key_lab, key_vals, ex["max_key_distance"])
    matched = ~np.isnan(t)
    print(f"  lit px {lit.sum()}, matched to key {matched.mean():.1%}, "
          f"median Lab distance {np.median(dist):.1f}")

    tmap = np.zeros(lum.shape, np.float32)
    tmap[lit] = np.nan_to_num(t, nan=0.0)
    w = lum / 255.0
    up, down = w * np.clip(tmap, 0, None), w * np.clip(-tmap, 0, None)
    gain = grid.pool(up, rows, cols, "mean")
    loss = grid.pool(down, rows, cols, "mean")
    both = np.concatenate([gain.ravel(), loss.ravel()])
    scale = float(np.percentile(both[both > 0], 99.5))

    # The regions, on their fine grids, with one scale of their own (as for the years).
    fine = {R["id"]: (grid.pool_box(up, R["box"], deg), grid.pool_box(down, R["box"], deg)) for R in items}
    if fine:
        allf = np.concatenate([a.ravel() for pair in fine.values() for a in pair])
        fine_scale = float(np.percentile(allf[allf > 0], 99.5))
        for rid, (g_, l_) in fine.items():
            regions[rid] = {"gain": grid.to_ints(np.clip(g_ / fine_scale, 0, 1)),
                            "loss": grid.to_ints(np.clip(l_ / fine_scale, 0, 1))}

    return {
        "label": "Change 2012 to 2023",
        "image": _save_display(world, cfg, "change"),
        "alt": "Map of change in night lights from 2012 to 2023: purple where lights grew, "
               "orange where they dimmed, white where they stayed the same.",
        "key": {"bgr": key_bgr.round().astype(int).tolist(), "values": [ch["key_values"][0], ch["key_values"][1]]},
        "gain": grid.to_ints(np.clip(gain / scale, 0, 1)),
        "loss": grid.to_ints(np.clip(loss / scale, 0, 1)),
    }


def build(cfg: dict) -> dict:
    path = source_path(cfg)
    info = video.video_info(path)
    print(f"Video {path.name}: {info}")
    ex, pb = cfg["extraction"], cfg["playback"]

    print("Years chapter:")
    region_years: dict = {}
    decade: dict = {}
    years = _build_years(cfg, path, region_years, decade)
    print("Change chapter:")
    region_change: dict = {}
    change = _build_change(cfg, path, region_change)

    # The change map is heard as "the decade": each place's light year by year (decade), then
    # NASA's change map for it (figure: more, less or steady light), shown on NASA's own EIC print.
    def figure(gain: list, loss: list) -> str:
        g, l = sum(gain), sum(loss)
        net = (g - l) / (g + l) if g + l else 0
        return "more" if net > 0.1 else "less" if net < -0.1 else "steady"
    change.update(decade=decade["whole"], figure=figure(change["gain"], change["loss"]))
    for rid, ch in region_change.items():
        ch.update(decade=decade[rid], figure=figure(ch["gain"], ch["loss"]))
    print_src = source_path(cfg, "print")
    change["image"] = f"media/{cfg['id']}/change-eic.webp"
    cv2.imwrite(str(MEDIA_DIR / cfg["id"] / "change-eic.webp"), cv2.imread(str(print_src)), [cv2.IMWRITE_WEBP_QUALITY, 92])
    change["alt"] = ("NASA's map of how night lights changed from 2012 to 2023: purple where lights grew, orange where "
                     "they dimmed, with zoomed views of Western Europe, the Eastern Mediterranean, Ukraine and India.")
    for place, v in decade.items():
        print(f"  decade {place:<22} 2023 / 2012 = {v[-1] / v[0]:.2f}" if v[0] else f"  decade {place}: no light in 2012")

    # NASA's zoom regions: each on its own fine grid, with both chapters, for the page's Region choice.
    items, deg = _regions(cfg)
    views = None
    if items:
        v = cfg["views"]
        views = {
            "legend": v["legend"], "key": v.get("key"), "mode": "choose",
            "items": [{
                "id": R["id"], "name": R["name"], "box": R["box"],
                **({"note": R["note"]} if R.get("note") else {}),
                "grid": grid.box_grid(R["box"], deg),
                "secondsPerSweep": v["seconds_per_sweep"],
                "chapters": {"years": region_years[R["id"]], "change": [region_change[R["id"]]]},
            } for R in items],
        }
        for R in views["items"]:
            print(f"  region {R['name']}: {R['grid']['cols']} x {R['grid']['rows']} cells of {deg} degrees")

    return {
        "id": cfg["id"],
        "title": cfg["title"],
        "short": cfg["short"],
        "method": "moving-sweep",
        "source": cfg["source"],
        "grid": {"cols": ex["grid"]["cols"], "rows": ex["grid"]["rows"],
                 "lonWest": -180, "latNorth": 90,
                 "cellDeg": 360 / ex["grid"]["cols"]},
        "chapters": [
            {"id": "years", "title": "Night lights, year by year",
             "secondsPerSweep": pb["seconds_per_sweep"], "frames": years},
            {"id": "change", "title": cfg["chapters"]["change"]["title"],
             "secondsPerSweep": pb["change_seconds_per_sweep"], "frames": [change]},
        ],
        **({"views": views} if views else {}),
        "crossfade": pb["crossfade"],
        "legend": cfg["legend"],
    }
