"""Known-answer tests for backend/build_aerosols.py, ported from TerraJuke's tests/air.test.ts.

    python3 -m unittest backend/tests/test_aerosols.py -v
"""
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import build_aerosols as ba  # noqa: E402
import build_sweep as bs  # noqa: E402

DATA = json.loads((HERE.parent.parent / "public" / "data" / "05_aerosols.json").read_text(encoding="utf-8"))
FRAMES = DATA["chapters"][0]["frames"]
K = {a: i for i, a in enumerate(ba.AEROSOLS)}


class Legend(unittest.TestCase):
    def test_nasa_swatches(self):
        legend = ba.read_legend()
        want = {"blackCarbon": (210, 94, 69), "dust": (193, 154, 220), "seaSalt": (133, 170, 169), "sulfate": (83, 220, 52)}
        for s in legend:
            for got, exp in zip(s["rgb"], want[s["aerosol"]]):
                self.assertLessEqual(abs(got - exp), 1, s["aerosol"])
        for k, s in enumerate(legend):
            t, strength = ba.classify(tuple(round(v) for v in s["rgb"]), legend)
            self.assertEqual(t, k)
            self.assertGreater(strength, 0.97)
        for grey in [(60, 70, 60), (0, 0, 0), (255, 255, 255), (128, 128, 128)]:
            self.assertEqual(ba.classify(grey, legend)[0], -1)


class Still(unittest.TestCase):
    def test_shares_match_terrajuke(self):
        for v, want in zip(DATA["voices"], [1.10, 3.08, 6.65, 16.4]):
            self.assertAlmostEqual(v["share"] * 100, want, delta=0.1, msg=v["id"])

    def test_each_story_is_led_by_the_aerosol_nasa_names(self):
        for f in FRAMES[1:]:
            amounts = [a for a, _ in f["mix"]]
            top = max(range(4), key=lambda i: amounts[i])
            self.assertEqual(top, K[f["aerosol"]], f["id"])
            self.assertGreaterEqual(amounts[top], 2 * sorted(amounts)[-2], f["id"])
            self.assertGreater(amounts[top], 0.07, f["id"])

    def test_slices_cover_the_world_and_every_one_sounds(self):
        steps = FRAMES[0]["steps"]
        self.assertEqual(len(steps), 64)
        self.assertEqual((steps[0]["lon0"], steps[-1]["lon1"]), (-180, 180))
        self.assertTrue(all(any(a >= 0.004 for a, _ in s["mix"]) for s in steps))
        for f in FRAMES[1:]:
            self.assertEqual(len(f["steps"]), 8)

    def test_antarctica_is_near_silent(self):
        self.assertLess(sum(a for a, _ in ba.mix_in(ba.analyse(ba.read_legend()), ba.box_for(-180, -90, 180, -75))), 0.02)


class Score(unittest.TestCase):
    def test_words_on_the_fixed_scale(self):
        self.assertEqual([bs.strength_word(a) for a in (0.001, 0.01, 0.03, 0.1, 0.3)], ["none", "faint", "light", "moderate", "strong"])
        self.assertEqual(bs.mix_words([[0, None]] * 4, DATA["voices"]), "clear air, silence")

    def test_score_frames_follow_the_contract(self):
        frames = bs.build_sides(DATA, DATA["chapters"][0], {"hotLine": 0.5})
        self.assertEqual(len(frames), 7)
        for f in frames:
            self.assertTrue(f["text"].startswith(f["when"]))
            self.assertEqual((len(f["grid"]), len(f["grid"][0])), (18, 36))
            self.assertTrue(all(0 <= v <= 1 for row in f["grid"] for v in row))


if __name__ == "__main__":
    unittest.main()
