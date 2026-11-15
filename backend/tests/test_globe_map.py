"""NASA's turning globes flattened to world maps (tracks 4 and 5): the camera geometry, and the
built maps against known geography.

    python3 -m unittest backend/tests/test_globe_map.py -v   (needs backend/eic/pipeline/requirements.txt)
"""
import json
import math
import sys
import unittest
from pathlib import Path

try:                               # the pipeline's packages; without them these tests are skipped
    import cv2  # noqa: F401
    import numpy as np
    import yaml  # noqa: F401
except ImportError:
    raise unittest.SkipTest("needs the pipeline's packages: pip install -r backend/eic/pipeline/requirements.txt")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eic"))
from pipeline.tracks.globe_map import project, unproject  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "public" / "data"
G = {"cx": 320.0, "cy": 180.0, "limb": 176.0, "camera_distance": 4.5, "tilt": 9.0}


def cell(f, lat, lon):
    """Value 0..100 (or None) of the 3 degree cell holding (lat, lon)."""
    return f["core"][int((90 - lat) // 3) * 120 + int((lon + 180) // 3)]


def strongest(f, south, north, west, east):
    """The highest reading in a box of 3 degree cells (None if nothing there was read)."""
    vals = [f["core"][r * 120 + c] for r in range(60) for c in range(120)
            if south <= 90 - (r + 0.5) * 3 <= north and west <= -180 + (c + 0.5) * 3 <= east]
    vals = [v for v in vals if v is not None]
    return max(vals) if vals else None


class Camera(unittest.TestCase):
    def test_the_facing_point_is_the_centre_and_east_is_right_north_is_up(self):
        x, y, z = project(np.array([9.0, 9.0, 30.0]), np.array([0.0, 20.0, 0.0]), G)
        self.assertAlmostEqual(x[0], 320, places=6)
        self.assertAlmostEqual(y[0], 180, places=6)
        self.assertGreater(x[1], 320)                 # east of the facing point: to the right
        self.assertLess(y[2], 180)                    # north of it: higher in the picture

    def test_pixels_and_places_round_trip(self):
        lat, dl = np.array([40.0, -25.0, 60.0, 0.0]), np.array([30.0, -50.0, 10.0, -60.0])
        lat2, dl2 = unproject(*project(lat, dl, G)[:2], G)
        np.testing.assert_allclose(lat2, lat, atol=1e-6)
        np.testing.assert_allclose(dl2, dl, atol=1e-6)

    def test_the_horizon_is_the_edge_of_the_disc(self):
        edge = math.degrees(math.acos(1 / G["camera_distance"]))     # about 77 degrees, not 90: a close camera
        x, y, _ = project(np.array([9.0]), np.array([edge]), G)
        self.assertAlmostEqual(math.hypot(x[0] - 320, y[0] - 180), 176, delta=0.5)


class BuiltMaps(unittest.TestCase):
    """The maps in public/data, against places everyone knows."""

    def load(self, name):
        p = DATA / name
        if not p.is_file():
            self.skipTest(f"{name} not built")
        d = json.loads(p.read_text(encoding="utf-8"))
        return d, d["chapters"][0]["frames"][0]

    def test_ocean_currents_are_strong_where_the_great_currents_run(self):
        d, f = self.load("07_ocean_map.json")
        self.assertEqual(d["fit"]["projection"], "flat")
        self.assertGreater(d["fit"]["match"], 0.9)                      # NASA's land lines up with the Blue Marble
        for name, box in [("Gulf Stream", (32, 42, -75, -50)), ("Kuroshio", (30, 40, 135, 155)), ("Agulhas", (-42, -33, 15, 35))]:
            self.assertGreaterEqual(strongest(f, *box), 70, name)
        for name, lat, lon in [("Sahara", 22, 10), ("Mongolia", 46, 105)]:
            self.assertIsNone(cell(f, lat, lon), name)                # land: no current reading
        self.assertLess(strongest(f, -35, -20, -130, -100), 10)        # the quiet middle of the South Pacific gyre
        self.assertLess(strongest(f, 25, 35, -150, -135), 10)          # and of the North Pacific gyre

    def test_carbon_dioxide_is_dense_over_east_asia_and_fires_not_the_open_ocean(self):
        d, f = self.load("06_co2_map.json")
        self.assertGreater(d["fit"]["match"], 0.7)
        for name, box in [("eastern China", (25, 40, 105, 125)), ("African fires", (0, 12, 0, 40)), ("Amazon", (-15, 0, -70, -40))]:
            self.assertGreaterEqual(strongest(f, *box), 70, name)
        self.assertLess(strongest(f, -35, -20, -130, -100), 10)        # clean air over the South Pacific
        self.assertIsNone(cell(f, 80, 0))                               # never shown face-on


if __name__ == "__main__":
    unittest.main()
