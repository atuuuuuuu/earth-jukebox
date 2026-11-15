"""The guided lesson for Ocean currents: the flow reading (east is east, north is north), the
compass words, the georeference, and the built lesson against known geography.

    python3 -m unittest backend/tests/test_ocean_lesson.py -v   (needs backend/eic/pipeline/requirements.txt)
"""
import json
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eic"))
from pipeline.tracks.ocean_lesson import bearing_of, compass, fit_georef, measure, to_px  # noqa: E402

LESSON = Path(__file__).resolve().parents[2] / "public" / "data" / "07_ocean_lesson.json"


def moving(dx: float, dy: float, n: int = 4) -> list:
    """A soft random texture moving dx, dy pixels a frame (y down, as in a picture)."""
    tex = cv2.GaussianBlur((np.random.default_rng(2).random((120, 160)) * 255).astype(np.uint8), (5, 5), 0)
    shift = lambda i: cv2.warpAffine(tex, np.float32([[1, 0, dx * i], [0, 1, dy * i]]), (160, 120), borderMode=cv2.BORDER_REFLECT)
    return [cv2.cvtColor(shift(i), cv2.COLOR_GRAY2BGR) for i in range(n)]


def turn(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


class Flow(unittest.TestCase):
    NORTH_UP = np.array([[10.0, 0], [0, -10.0], [0, 0]])     # 10 px a degree, north at the top

    def bearing(self, frames, coef=NORTH_UP):
        f = measure(frames, 1)[0]
        return bearing_of(coef, 0, f[40:80, 50:110, 0].mean(), f[40:80, 50:110, 1].mean())

    def test_motion_to_the_right_is_east_and_up_is_north(self):
        self.assertLess(turn(self.bearing(moving(1, 0)), 90), 5)
        self.assertLess(turn(self.bearing(moving(0, -1)), 0), 5)
        self.assertLess(turn(self.bearing(moving(-1, 1)), 225), 5)

    def test_a_rotated_picture_is_corrected_by_the_georeference(self):
        # North points to the picture's right: motion to the right is north.
        coef = np.array([[0, 10.0], [10.0, 0], [0, 0]])
        self.assertLess(turn(self.bearing(moving(1, 0), coef), 0), 5)

    def test_parts_split_the_frames_in_order(self):
        f = measure(moving(1, 0, 5) + moving(-1, 0, 4)[1:], 2)
        self.assertGreater(f[0, 40:80, 50:110, 0].mean(), 0.5)
        self.assertLess(f[1, 40:80, 50:110, 0].mean(), 0.5)


class Words(unittest.TestCase):
    def test_compass(self):
        self.assertEqual([compass(b) for b in (0, 22, 23, 90, 180, 257, 315, 359)],
                         ["north", "north", "northeast", "east", "south", "west", "northwest", "north"])


class Georeference(unittest.TestCase):
    def test_fit_recovers_an_exact_mapping(self):
        pts = [[f"p{i}", lat, lon, 100 + 20 * lon, 300 - 25 * lat] for i, (lat, lon) in enumerate([(1, 2), (5, 1), (3, 7), (8, 8)])]
        coef, err = fit_georef(pts)
        self.assertLess(err.max(), 1e-6)
        np.testing.assert_allclose(to_px(coef, 4, 5), [200, 200], atol=1e-6)


@unittest.skipUnless(LESSON.exists(), "build the lesson first: cd backend/eic && py -m pipeline.run --track 07_ocean_lesson")
class BuiltLesson(unittest.TestCase):
    """What every ocean atlas says about the Gulf Stream, checked against the numbers we measured."""

    @classmethod
    def setUpClass(cls):
        cls.steps = json.loads(LESSON.read_text(encoding="utf-8"))["steps"]

    def step(self, place):
        return next(s for s in self.steps if s.get("place", "").startswith(place))

    def test_one_idea_at_a_time(self):
        kinds = [s["kind"] for s in self.steps]
        self.assertLess(kinds.index("cue"), kinds.index("point"))     # direction is explained before it is used
        self.assertLess(kinds.index("point"), kinds.index("line"))    # then speed
        self.assertLess(kinds.index("line"), kinds.index("series"))   # then change

    def test_florida_current_flows_north_and_turns_east(self):
        self.assertEqual(self.step("off Miami")["compass"], "north")
        self.assertIn(self.step("off Georgia")["compass"], ("north", "northeast"))
        self.assertIn(self.step("off the Carolinas")["compass"], ("northeast", "east"))
        self.assertIn(self.step("far out in the Atlantic")["compass"], ("southwest", "west"))

    def test_fastest_in_the_middle_of_the_stream(self):
        speeds = [q["speed"] for q in self.step("a line from the coast")["samples"]]
        top = speeds.index(max(speeds))
        self.assertTrue(0 < top < len(speeds) - 1, speeds)
        self.assertGreater(max(speeds), 2 * min(speeds[0], speeds[-1]))

    def test_steady_near_florida_restless_further_out(self):
        steady = {q["compass"] for q in self.step("the middle of the Gulf Stream")["parts"]}
        restless = {q["compass"] for q in self.step("out at sea")["parts"]}
        self.assertEqual(steady, {"north"})
        self.assertGreaterEqual(len(restless), 3)


if __name__ == "__main__":
    unittest.main()
