"""Sea heat (track 02): NASA's colour key read back to degrees C, and the built data at known places.

    python3 -m unittest backend/tests/test_sea_heat.py -v

Needs the pipeline's packages (numpy, OpenCV). The key image is rebuilt from the key colours kept in
public/data/02_sea_heat.json, so the test runs without NASA's files.
"""
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "eic"))
PUBLIC = HERE.parent.parent / "public"
DATA = PUBLIC / "data" / "02_sea_heat.json"

try:
    import cv2
    import numpy as np
    from pipeline.tracks import sea_heat
except ImportError:                       # pragma: no cover - the pipeline's packages are missing
    sea_heat = None

EX = {"min_bright": 70, "min_sat": 0.45, "max_key_distance": 18}


def key_image(path: Path, colours: list) -> None:
    """A key like NASA's: a 310 x 95 transparent image with an opaque bar, 0 C left to 32 C right."""
    img = np.zeros((95, 310, 4), np.uint8)
    xs = np.linspace(0, len(colours) - 1, 292 - 15)
    bar = np.stack([np.interp(xs, np.arange(len(colours)), [c[k] for c in colours]) for k in range(3)], axis=1)
    img[28:69, 15:292, :3] = bar[None, :, :].round().astype(np.uint8)
    img[28:69, 15:292, 3] = 255
    cv2.imwrite(str(path), img)


@unittest.skipUnless(sea_heat is not None and DATA.is_file(), "pipeline packages or built sea heat data missing")
class KeyColours(unittest.TestCase):
    def setUp(self):
        self.colours = json.loads(DATA.read_text(encoding="utf-8"))["key"]["bgr"]     # one per degree, 0..32
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "key.png"
        key_image(path, self.colours)
        self.bgr, self.vals = sea_heat.key_colours(path, 0, 32, 129)
        self.table = sea_heat.colour_table(self.bgr, self.vals, EX)

    def tearDown(self):
        self.tmp.cleanup()

    def cell(self, bgr, brightness=1.0):
        """The median temperature of a 17 x 17 cell painted in one colour."""
        patch = np.zeros((17, 17, 3), np.uint8)
        patch[:] = np.clip(np.array(bgr, np.float32) * brightness, 0, 255).round().astype(np.uint8)
        t = sea_heat.decode(patch, self.table)
        return float(np.nanmedian(t))

    def test_a_cell_coloured_like_the_key_at_20_degrees_reads_20(self):
        self.assertAlmostEqual(self.cell(self.colours[20]), 20, delta=1)

    def test_a_fading_flow_line_keeps_its_temperature(self):
        self.assertAlmostEqual(self.cell(self.colours[20], 0.6), 20, delta=1)

    def test_the_whole_key_reads_back(self):
        for deg in (0, 6, 12, 18, 24, 28, 32):
            self.assertAlmostEqual(self.cell(self.colours[deg]), deg, delta=1, msg=f"{deg} C")

    def test_grey_land_white_ice_and_black_sea_are_not_read(self):
        for bgr in ((60, 60, 60), (200, 205, 210), (6, 5, 4), (110, 120, 112)):
            self.assertTrue(np.isnan(sea_heat.decode(np.full((3, 3, 3), bgr, np.uint8), self.table)).all(), bgr)


def box_mean(frame: dict, g: dict, lat: tuple, lon: tuple) -> float:
    vals, wts = [], []
    for r in range(g["rows"]):
        la = g["latNorth"] - (r + 0.5) * g["cellDeg"]
        if not lat[0] <= la <= lat[1]:
            continue
        for c in range(g["cols"]):
            lo = g["lonWest"] + (c + 0.5) * g["cellDeg"]
            v = frame["temp"][r * g["cols"] + c]
            if lon[0] <= lo <= lon[1] and v is not None:
                vals.append(v)
                wts.append(math.cos(math.radians(la)))
    return sum(v * w for v, w in zip(vals, wts)) / sum(wts)


@unittest.skipUnless(DATA.is_file(), "built sea heat data missing")
class KnownPlaces(unittest.TestCase):
    """What every oceanographer expects to see on NASA's map, in every season."""

    @classmethod
    def setUpClass(cls):
        d = json.loads(DATA.read_text(encoding="utf-8"))
        cls.g, cls.frames = d["grid"], d["chapters"][0]["frames"]

    def mean(self, f, lat, lon):
        return box_mean(f, self.g, lat, lon)

    def test_four_seasons_with_nasas_dates(self):
        self.assertEqual(len(self.frames), 4)
        self.assertEqual(self.frames[0]["from"], "2007-03-25")
        self.assertEqual(self.frames[-1]["to"], "2008-03-03")

    def test_the_tropics_are_warm_and_the_southern_ocean_cold(self):
        for f in self.frames:
            self.assertGreaterEqual(self.mean(f, (-5, 10), (130, 165)), 28, f["label"])   # West Pacific warm pool
            self.assertGreaterEqual(self.mean(f, (-10, 5), (55, 90)), 27, f["label"])     # Indian Ocean
            self.assertLessEqual(self.mean(f, (-65, -55), (-180, 180)), 6, f["label"])    # Southern Ocean

    def test_the_gulf_stream_carries_warm_water_north_east(self):
        for f in self.frames:
            atlantic, pacific = self.mean(f, (45, 55), (-35, -15)), self.mean(f, (45, 55), (-175, -150))
            self.assertGreater(atlantic, pacific + 2, f["label"])

    def test_the_cold_tongue_along_the_equatorial_east_pacific(self):
        for f in self.frames:
            east, west = self.mean(f, (-3, 3), (-130, -95)), self.mean(f, (-3, 3), (140, 175))
            self.assertLess(east, west - 2.5, f["label"])


if __name__ == "__main__":
    unittest.main()
