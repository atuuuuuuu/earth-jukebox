"""Known answers for the atmospheric river track: NASA's clock lined up with the film, the date
spans spoken per scene, and the reading of NASA's blue vapour shading.

    python3 -m unittest backend/tests/test_atmospheric_river.py -v   (needs backend/eic/pipeline/requirements.txt)
"""
import sys
import unittest
from datetime import datetime
from pathlib import Path

try:                               # the pipeline's packages; without them these tests are skipped
    import cv2  # noqa: F401
    import numpy as np
    import yaml  # noqa: F401
except ImportError:
    raise unittest.SkipTest("needs the pipeline's packages: pip install -r backend/eic/pipeline/requirements.txt")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eic"))
from pipeline.tracks.atmospheric_river import align, span_text, vapour_value  # noqa: E402

T0 = datetime(2010, 10, 1)
EX = {"vapour_hue": [80, 92, 122, 132], "vapour_sat": [0.35, 0.85], "min_value": 0.2}


class Clock(unittest.TestCase):
    def test_film_and_clock_meet_where_the_clock_jumps_back(self):
        # The clock runs 0..30 minutes, jumps back to 5 at clock frame 6; the film lost one frame
        # before that, so its picture jumps at film frame 5.
        clock = np.array([0, 5, 10, 15, 20, 30, 5, 10, 15], float) * 60
        seen = np.ones(8, np.float32)
        seen[5] = 40
        film, clk = align(clock, seen, 3)
        self.assertEqual(list(film), [0, 5, 7])
        self.assertEqual(list(clk), [0, 6, 8])

    def test_a_weak_picture_change_is_not_an_anchor(self):
        clock = np.array([0, 10, 20, 5, 15], float) * 60
        film, clk = align(clock, np.ones(5, np.float32), 2)    # no visible jump anywhere
        self.assertEqual(list(film), [0, 4])
        self.assertEqual(list(clk), [0, 4])

    def test_spans_say_range_jumps_back_and_still_clock(self):
        self.assertEqual(span_text(np.array([0.0, 98000.0]), T0), "1 October to 8 December 2010")
        dec = (datetime(2010, 12, 10, 12) - T0).total_seconds() / 60
        # Three passes over 10-14 December; the second jump is drawn over two frames (a blend between).
        loop = np.array([dec, dec + 5040, dec, dec + 5040, dec + 2500, dec, dec + 3000])
        self.assertEqual(span_text(loop, T0), "10 to 14 December 2010, as NASA's clock jumps back 2 times")
        still = (datetime(2010, 12, 11, 18, 43) - T0).total_seconds() / 60
        self.assertEqual(span_text(np.array([still, still]), T0),
                         "11 December 2010 at 18:43 UTC, NASA's clock standing still")


class Vapour(unittest.TestCase):
    def test_deep_blue_counts_most_and_grey_white_land_not_at_all(self):
        img = np.zeros((10, 50, 3), np.uint8)
        img[:, 0:10] = (225, 120, 30)       # BGR deep blue: the river's core
        img[:, 10:20] = (150, 150, 90)      # teal: a little vapour
        img[:, 20:30] = (95, 80, 90)        # grey-violet sea
        img[:, 30:40] = (245, 245, 245)     # white wind streak or cloud
        img[:, 40:50] = (60, 140, 120)      # olive land
        v = vapour_value(img, EX)[5]
        self.assertGreater(v[5], 0.8)
        self.assertTrue(0 < v[15] < 0.3, v[15])
        self.assertEqual((v[25], v[35], v[45]), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()
