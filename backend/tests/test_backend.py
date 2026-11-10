"""Backend tests: synthetic maps with known answers go in, and the API must give those answers back.

    python3 -m unittest discover backend/tests -v
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import analyze  # noqa: E402
import build_api  # noqa: E402
import make_fixture  # noqa: E402
import validate_api  # noqa: E402


class Backend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp()) / "Мөнчанар төсөл"   # non-English folder name
        cls.tmp.mkdir()
        cls.data = cls.tmp / "data"
        make_fixture.main(cls.data, n=40, step_days=20)          # 2024-06-01 to 2026-07-22
        cls.truth = json.loads((cls.data / "truth.json").read_text(encoding="utf-8"))
        cfg = json.loads((BACKEND / "sample.config.json").read_text(encoding="utf-8"))
        src = cfg["sources"]["sst"]
        src.update(framesDir="data/frames", colorbar="data/colorbar.jpg",
                   firstDate=cls.truth["first"], lastDate=cls.truth["last"])
        cfg["out"] = "public"
        cfg["tracks"][0]["select"] = {"every": 2}
        cls.config = cls.tmp / "config.json"
        cls.config.write_text(json.dumps(cfg), encoding="utf-8")
        build_api.build(cls.config)
        cls.public = cls.tmp / "public"
        cls.a1 = json.loads((cls.public / "api/scores/a1-ocean-fever.json").read_text(encoding="utf-8"))
        cls.a2 = json.loads((cls.public / "api/scores/a2-el-nino.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp.parent)

    def truth_for(self, day):
        return next(f for f in self.truth["frames"] if f["date"] == day)

    # -- colour bar

    def test_colour_bar_is_found_without_its_outline(self):
        bar = analyze.read_colourbar(self.data / "colorbar.jpg", -4, 4)
        x0, x1 = self.truth["barX"]
        self.assertLessEqual(abs(bar.start - x0), 4)
        self.assertLessEqual(abs(bar.end - (x1 - 1)), 4)
        self.assertTrue(np.all(np.diff(bar.values) >= -1e-9), "bar values must only go up")

    def test_vertical_colour_bar(self):
        page = analyze.imread(self.data / "colorbar.jpg")
        upright = np.rot90(page, k=1).copy()                    # low end at the bottom
        path = self.tmp / "vertical.png"
        analyze.imwrite(path, upright)
        bar = analyze.read_colourbar(path, -4, 4)
        self.assertTrue(bar.vertical)
        blue = np.array([[[110, 30, 10]]], np.uint8)            # the bar's low end
        _, i = bar.tree.query(analyze.to_lab(blue)[0, 0])
        self.assertLess(bar.values[i], -3.5)

    # -- decoding

    def test_map_average_matches_the_truth(self):
        errors = [abs(f["mean"] - self.truth_for(f["date"])["mean"]) for f in self.a1["frames"]]
        self.assertLess(max(errors), 0.03, f"worst map-average error {max(errors):.3f} degrees")

    def test_nino34_matches_the_truth(self):
        for f in self.a1["frames"]:
            true = self.truth_for(f["date"])["nino34"]
            # The bar's white middle stands for -0.24..+0.24, so values there can
            # only be read to within that band. Elsewhere the decoder must be close.
            limit = 0.3 if abs(true) < 0.3 else 0.1
            self.assertLess(abs(f["nino34"] - true), limit, f"{f['date']}: {f['nino34']} vs {true:.2f}")

    def test_relative_nino34_matches_the_truth(self):
        for f in self.a1["frames"]:
            t = self.truth_for(f["date"])
            self.assertLess(abs(f["tropics"] - t["tropics"]), 0.03, f["date"])
            self.assertAlmostEqual(f["nino34Relative"], f["nino34"] - f["tropics"], places=2)

    def test_bell_side_of_the_line_is_right(self):
        for f in self.a1["frames"]:
            t = self.truth_for(f["date"])
            true = t["nino34"] - t["tropics"]
            if abs(true - analyze.NINO_LINE) > 0.3:
                self.assertEqual(f["nino34Relative"] > analyze.NINO_LINE, true > analyze.NINO_LINE, f["date"])

    def test_land_is_silent(self):
        for f in self.a1["frames"]:
            self.assertAlmostEqual(f["valid"], self.truth["ocean"], delta=0.01)

    # -- summaries and descriptions

    def test_empty_frame_does_not_crash(self):
        v = np.full((analyze.H, analyze.W), np.nan)
        f = analyze.summarize(v, analyze.area_weights(), hot=2, date="2026-01-01", units="degrees C")
        self.assertEqual(f["text"], "2026-01-01. No mapped data in this frame.")

    def test_one_patch_is_singular(self):
        v = np.zeros((analyze.H, analyze.W))
        v[170:190, 100:130] = 3.0
        f = analyze.summarize(v, analyze.area_weights(), hot=2, date="2026-01-01", units="degrees C")
        self.assertEqual(f["clusters"], 1)
        self.assertIn("in 1 patch.", f["text"])

    def test_pacific_centred_map_gives_the_same_nino34(self):
        w = analyze.area_weights()
        _, lon = analyze.pixel_lat_lon(-180)
        v = np.where(np.abs(lon + 145) < 25, 2.0, 0.0)[None, :].repeat(analyze.H, 0)
        shifted = np.roll(v, -analyze.W // 2, axis=1)           # left edge now at 0 degrees
        a = analyze.box_mean(v, w, analyze.NINO34_LAT, analyze.NINO34_LON, -180)
        b = analyze.box_mean(shifted, w, analyze.NINO34_LAT, analyze.NINO34_LON, 0)
        self.assertAlmostEqual(a, b, places=6)

    def test_box_all_the_way_round(self):
        v = np.ones((analyze.H, analyze.W))
        w = analyze.area_weights()
        self.assertEqual(analyze.box_mean(v, w, (-20, 20), (-180, 180)), 1.0)
        self.assertEqual(analyze.box_mean(v, w, (-5, 5), (170, -170)), 1.0)   # across the date line

    # -- choosing frames

    def test_every_ends_on_the_latest_frame(self):
        self.assertEqual(self.a1["frames"][-1]["date"], self.truth["last"])

    def test_pairs_alternate_years_on_the_same_day(self):
        frames = self.a2["frames"]
        self.assertGreater(len(frames), 0)
        self.assertEqual(len(frames) % 2, 0)
        for then, now in zip(frames[::2], frames[1::2]):
            self.assertEqual((then["label"], now["label"]), ("2025", "2026"))
            self.assertLessEqual(abs(int(then["date"][5:7]) - int(now["date"][5:7])), 1)
            self.assertIn("Compared with " + then["date"], now["text"])

    # -- the contract

    def test_api_passes_the_validator(self):
        self.assertEqual(validate_api.check(self.public), [])

    def test_only_rebuilds_one_track_and_keeps_the_rest(self):
        """--only builds one track; the others keep their files and index entries untouched,
        and their sources need not be on this computer (here: a source with no frames)."""
        out = self.tmp / "only"
        shutil.copytree(self.public, out)
        cfg = json.loads(self.config.read_text(encoding="utf-8"))
        cfg["out"] = "only"
        cfg["sources"]["missing"] = dict(cfg["sources"]["sst"], framesDir="no-such-folder")
        cfg["sources"]["sst"]["words"] = {"subject": "planet", "map": "test map"}
        cfg["tracks"][1]["source"] = "missing"          # A2's source is not on this computer
        cfg["tracks"][0]["nino34"] = False
        path = self.tmp / "only.config.json"
        path.write_text(json.dumps(cfg), encoding="utf-8")
        a2_before = (out / "api/scores/a2-el-nino.json").read_bytes()
        index = build_api.build(path, only=["a1-ocean-fever"])
        self.assertEqual([t["id"] for t in index["tracks"]], ["a1-ocean-fever", "a2-el-nino"])
        self.assertEqual((out / "api/scores/a2-el-nino.json").read_bytes(), a2_before)
        a1 = json.loads((out / "api/scores/a1-ocean-fever.json").read_text(encoding="utf-8"))
        self.assertEqual(a1["words"], {"subject": "planet", "map": "test map"})
        self.assertFalse(any("nino34Relative" in f for f in a1["frames"]), "no Niño fields when nino34 is off")
        self.assertEqual(validate_api.check(out), [])
        with self.assertRaises(build_api.ConfigError):
            build_api.build(path, only=["no-such-track"])

    def test_validator_catches_a_broken_score(self):
        broken = self.tmp / "broken"
        shutil.copytree(self.public, broken)
        path = broken / "api/scores/a1-ocean-fever.json"
        s = json.loads(path.read_text(encoding="utf-8"))
        s["frames"][0]["columns"] = s["frames"][0]["columns"][:5]
        path.write_text(json.dumps(s), encoding="utf-8")
        self.assertTrue(any("columns" in p for p in validate_api.check(broken)))

    def test_missing_dates_give_a_clear_error(self):
        cfg = json.loads(self.config.read_text(encoding="utf-8"))
        cfg["sources"]["sst"]["firstDate"] = "SET-ME"
        bad = self.tmp / "bad.json"
        bad.write_text(json.dumps(cfg), encoding="utf-8")
        with self.assertRaises(build_api.ConfigError) as e:
            build_api.build(bad)
        self.assertIn("firstDate", str(e.exception))


if __name__ == "__main__":
    unittest.main()
