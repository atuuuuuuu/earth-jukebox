"""Build public/data/climate.json: one row per year for the Year by year sound.

Downloads three public records and joins them by year:
  temperature  NASA GISTEMP v4, global land-ocean annual mean (J-D)
  co2          NOAA GML, Mauna Loa annual mean, from 1959
  ice          NSIDC Sea Ice Index v4, Arctic extent in September (the yearly low), from 1979

GISTEMP is published against 1951-1980. The +1.5 degree line is about pre-industrial
temperature, so the anomalies are moved onto 1880-1900, NASA's earliest years and the
usual stand-in for pre-industrial. Only complete years are kept.

Usage: python3 scripts/climate_data.py            (downloads)
       python3 scripts/climate_data.py DIR        (reads the three CSV files from DIR)
"""
import csv
import io
import json
import pathlib
import sys
import urllib.request
from datetime import date

SOURCES = {
    "temp": ("GLB.Ts+dSST.csv", "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"),
    "co2": ("co2_annmean_mlo.csv", "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.csv"),
    "ice": ("N_09_extent_v4.0.csv", "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv"),
}
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "data" / "climate.json"
BASE = (1880, 1900)


def text(key, folder):
    name, url = SOURCES[key]
    if folder:
        return (pathlib.Path(folder) / name).read_text()
    req = urllib.request.Request(url, headers={"User-Agent": "earth-jukebox-data-script"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode()


def rows(raw, header_starts):
    """CSV rows after the header line that starts with header_starts (skips notes and # comments)."""
    lines = [l for l in raw.splitlines() if l.strip() and not l.startswith("#")]
    start = next(i for i, l in enumerate(lines) if l.replace(" ", "").lower().startswith(header_starts))
    return list(csv.DictReader(io.StringIO("\n".join(l.replace(" ", "") for l in lines[start:]))))


def build(folder=None):
    temp = {int(r["Year"]): float(r["J-D"]) for r in rows(text("temp", folder), "year,jan") if r["J-D"] != "***"}
    co2 = {int(r["year"]): float(r["mean"]) for r in rows(text("co2", folder), "year,mean")}
    ice = {int(r["year"]): float(r["extent"]) for r in rows(text("ice", folder), "year,mo") if float(r["extent"]) > 0}

    base = sum(temp[y] for y in range(BASE[0], BASE[1] + 1)) / (BASE[1] - BASE[0] + 1)
    years = [{"year": y, "temp": round(temp[y] - base, 2), "co2": co2.get(y), "ice": ice.get(y)} for y in sorted(temp)]

    # Sanity: a broken download or a changed file format must fail here, not reach the page.
    assert years[0]["year"] == 1880 and len(years) >= 140, "GISTEMP years missing"
    assert all(-1 < r["temp"] < 3 for r in years), "temperature out of range"
    assert all(r["co2"] is None or 300 < r["co2"] < 500 for r in years), "CO2 out of range"
    assert all(r["ice"] is None or 2 < r["ice"] < 9 for r in years), "sea ice out of range"
    assert any(r["co2"] for r in years) and any(r["ice"] for r in years), "CO2 or ice did not join"

    return {
        "generated": date.today().isoformat(),
        "baseline": f"{BASE[0]}-{BASE[1]}",
        "units": {"temp": "degrees C", "co2": "ppm", "ice": "million km2"},
        "sources": [
            {"field": "temp", "title": "NASA GISTEMP v4, global land and ocean", "url": "https://data.giss.nasa.gov/gistemp/"},
            {"field": "co2", "title": "NOAA GML, Mauna Loa CO2 annual mean", "url": "https://gml.noaa.gov/ccgg/trends/data.html"},
            {"field": "ice", "title": "NSIDC Sea Ice Index v4, Arctic extent in September", "url": "https://nsidc.org/data/g02135"},
        ],
        "years": years,
    }


if __name__ == "__main__":
    data = build(sys.argv[1] if len(sys.argv) > 1 else None)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    y = data["years"]
    print(f"Wrote {OUT}: {y[0]['year']}-{y[-1]['year']}, {len(y)} years, "
          f"temperature {y[0]['temp']:+.2f} to {y[-1]['temp']:+.2f} C vs {data['baseline']}")
