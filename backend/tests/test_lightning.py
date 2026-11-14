"""Known answers for the lightning track's correction for where the space station looks most.

    python3 -m unittest backend/tests/test_lightning.py -v   (needs backend/eic/pipeline/requirements.txt)
"""
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eic"))
from pipeline.tracks.lightning import iss_view_weight  # noqa: E402

EDGES = np.linspace(90, -90, 61)          # the track's 3-degree rows, north to south
MID = (EDGES[:-1] + EDGES[1:]) / 2


def row(lat):
    return int(np.argmin(np.abs(MID - lat)))


class IssViewWeight(unittest.TestCase):
    w = iss_view_weight(EDGES)

    def test_equator_is_one_and_north_matches_south(self):
        self.assertAlmostEqual(self.w[row(1.5)], 1.0, places=6)
        np.testing.assert_allclose(self.w, self.w[::-1], rtol=1e-9)

    def test_matches_the_orbit_formula_away_from_the_turning_point(self):
        # Time over a latitude per unit area goes as 1 / sqrt(sin^2 i - sin^2 lat) for a circular orbit.
        s = math.sin(math.radians(51.6))
        want = s / math.sqrt(s * s - math.sin(math.radians(28.5)) ** 2)
        self.assertAlmostEqual(self.w[row(28.5)], want, delta=0.03 * want)

    def test_storms_near_50_degrees_are_seen_several_times_as_often(self):
        self.assertGreater(self.w[row(49.5)], 3.0)
        self.assertGreater(self.w[row(49.5)], self.w[row(40.5)])
        self.assertTrue(all(np.diff(self.w[row(1.5):row(46.5):-1]) >= 0))   # rises from the equator

    def test_never_boosts_latitudes_it_rarely_sees(self):
        self.assertTrue((self.w >= 1).all())
        self.assertEqual(self.w[row(70.5)], 1.0)
        self.assertEqual(self.w[row(-79.5)], 1.0)


if __name__ == "__main__":
    unittest.main()
