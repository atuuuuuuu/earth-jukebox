"""Known-answer tests for backend/build_sweep.py (standard library only).

    python3 -m unittest backend/tests/test_sweep.py -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import build_sweep as bs  # noqa: E402
import validate_api  # noqa: E402

WORDS = {"subject": "planet", "map": "map", "what": "light", "top": "brightest", "missing": "not read."}
G = {"cols": 120, "rows": 60, "lonWest": -180, "latNorth": 90, "cellDeg": 3.0}


def fine(value=0.0):
    return [value] * (G["cols"] * G["rows"])


def at(lat, lon):
    """Index of the 3-degree cell holding (lat, lon)."""
    return int((90 - lat) // 3) * G["cols"] + int((lon + 180) // 3)


class Pool(unittest.TestCase):
    def test_uniform_grid_stays_uniform_and_skips_the_poles(self):
        g = bs.pool(fine(0.7), G)
        self.assertEqual((len(g), len(g[0])), (18, 36))
        self.assertIsNone(g[0][0])          # 80-90 N: not read
        self.assertIsNone(g[15][0])         # 60-70 S: not read
        self.assertIsNone(g[17][0])
        self.assertAlmostEqual(g[5][10], 0.7)
        self.assertAlmostEqual(g[14][10], 0.7)   # 50-60 S is read

    def test_one_bright_cell_lands_in_its_10_degree_square(self):
        v = fine()
        v[at(35.7, 139.7)] = 1.0            # Tokyo
        g = bs.pool(v, G)
        r, c = int((90 - 35.7) // 10), int((139.7 + 180) // 10)
        self.assertGreater(g[r][c], 0)
        self.assertEqual(sum(1 for row in g for x in row if x), 1)
        self.assertEqual(bs.place_in(r, c), "Tokyo")


class Stats(unittest.TestCase):
    def test_clusters_join_across_the_date_line(self):
        g = [[0.0] * 36 for _ in range(18)]
        g[8][0] = g[8][35] = 1.0
        self.assertEqual(bs.clusters(g, 0.5), 1)
        g[2][10] = 1.0
        self.assertEqual(bs.clusters(g, 0.5), 2)

    def test_hot_share_and_valid_area(self):
        g = [[0.0] * 36 for _ in range(18)]
        for c in range(36):
            g[9][c] = 1.0                   # one band just south of the equator
        s = bs.stats(g, 0.5)
        self.assertEqual(s["valid"], 1.0)
        self.assertGreater(s["hot"], 1 / 18)     # equator rows carry more area than the average row
        self.assertEqual(s["clusters"], 1)
        none = [[None] * 36 for _ in range(18)]
        self.assertIsNone(bs.stats(none, 0.5)["mean"])

    def test_strips_cover_the_world_west_to_east(self):
        g = [[float(c) for c in range(36)] for _ in range(18)]
        s = bs.strips(g)
        self.assertEqual(len(s), 16)
        self.assertLess(s[0], s[-1])


class NewBuilders(unittest.TestCase):
    def test_weeks_fill_only_the_cells_the_line_crossed(self):
        rows, steps = 50, 4
        line = [0] * (steps * rows)
        line[2 * rows + 18] = 100                    # step 2, row 18: lat 75 - 3 * 18.5 = 19.5 N
        data = {"rows": rows, "latTop": 75, "latStep": 3, "line": line,
                "lonAtStep0": 126, "lonPerStep": 0, "framesPerStep": 3, "media": {"fps": 30, "src": "v.mp4"}}
        chapter = {"frames": [{"startStep": 0, "steps": steps, "from": "14 January", "region": "Asia",
                               "relative": 1.0, "image": "w.jpg"}]}
        f = bs.build_weeks(data, chapter, {"hotLine": 0.5})[0]
        crossed = [(r, c) for r, row in enumerate(f["grid"]) for c, v in enumerate(row) if v is not None]
        self.assertTrue(crossed and all(c == int((126 + 180) // 10) for _, c in crossed))
        self.assertGreater(f["grid"][int((90 - 19.5) // 10)][30], 0)
        self.assertEqual(f["date"], "2020-01-14")
        self.assertTrue(f["text"].startswith("Week from 14 January 2020. The scan line crosses Asia."))

    def test_parts_name_the_busiest_part_and_the_hemisphere(self):
        north, south = fine(), fine()
        north[at(10, 20)] = 100
        south[at(-10, 20)] = 100
        frames = [{"label": "Part 1 of 2", "image": "1.webp", "glow": north, "core": north, "total": 2.0, "north": 0.9},
                  {"label": "Part 2 of 2", "image": "2.webp", "glow": south, "core": south, "total": 1.0, "north": 0.2}]
        out = bs.build_parts({"grid": G}, {"frames": frames}, {"hotLine": 0.5, "latRange": [-55, 55]})
        self.assertIn("the busiest part, mostly north of the equator", out[0]["text"])
        self.assertIn("50 percent of the busiest part, mostly south of the equator", out[1]["text"])
        self.assertIsNone(out[0]["grid"][2][0])      # 60-70 N: beyond what the station sees
        self.assertIsNone(out[0]["date"])
        self.assertEqual(out[0]["when"], "Part 1 of 2")
        self.assertNotIn("marks", out[0]["text"])    # no count from the pipeline: nothing said

    def test_parts_say_about_how_many_marks(self):
        g = fine()
        g[at(0, 20)] = 100
        frames = [{"label": "Part 1 of 2", "image": "1.webp", "glow": g, "core": g, "total": 1.0, "markCount": 58153},
                  {"label": "Part 2 of 2", "image": "2.webp", "glow": g, "core": g, "total": 1.0, "markCount": 87}]
        out = bs.build_parts({"grid": G}, {"frames": frames}, {"hotLine": 0.5, "latRange": [-55, 55]})
        self.assertIn("About 58,000 separate lightning marks appear in NASA's movie during this part.", out[0]["text"])
        self.assertIn("About 87 separate lightning marks", out[1]["text"])


class Build(unittest.TestCase):
    def make_public(self, tmp):
        public = Path(tmp)
        (public / "data").mkdir()
        (public / "media").mkdir()
        years = []
        for k, year in enumerate(("2012", "2013")):
            glow = fine()
            glow[at(48.9, 2.4)] = 100           # Paris, both years
            if k:
                glow[at(28.6, 77.2)] = 100      # Delhi lights up in the second year
            img = f"media/{year}.webp"
            (public / img).write_bytes(b"x")
            years.append({"label": year, "image": img, "alt": "", "relativeTotal": 1 + k * 0.5,
                          "core": glow, "glow": glow})
        gain, loss = fine(), fine()
        gain[at(28.6, 77.2)] = 100
        loss[at(51.5, -0.1)] = 60
        (public / "media/change.webp").write_bytes(b"x")
        data = {
            "grid": G,
            "source": {"svs_title": "T", "url": "https://svs.gsfc.nasa.gov/5313/", "credit": "NASA SVS",
                       "visualizer": "V", "dataset": "D"},
            "legend": {"summary": "S.", "method": "M.", "caveat": "C.", "items": [
                {"sound": "Ringing notes", "meaning": "cities"}, {"sound": "Deep hum", "meaning": "light"},
                {"sound": "Rising pair of notes", "meaning": "new"}, {"sound": "Low falling cello", "meaning": "dim"}]},
            "chapters": [
                {"id": "years", "secondsPerSweep": 15.5, "frames": years},
                {"id": "change", "secondsPerSweep": 18, "frames": [
                    {"label": "Change", "image": "media/change.webp", "gain": gain, "loss": loss}]},
            ],
        }
        (public / "data/nl.json").write_text(json.dumps(data))
        cfg = {"out": str(public), "tracks": [
            {"id": "b1", "code": "B1", "title": "Night", "data": "data/nl.json", "chapter": "years",
             "units": "light", "range": [0, 1], "hotLine": 0.5, "words": WORDS},
            {"id": "b2", "code": "B2", "title": "Change", "data": "data/nl.json", "chapter": "change",
             "units": "change", "range": [-1, 1], "hotLine": 0.3, "words": WORDS}]}
        cfg_path = public / "sweep.config.json"
        cfg_path.write_text(json.dumps(cfg))
        return public, cfg_path

    def test_scores_follow_the_contract_and_name_real_places(self):
        with tempfile.TemporaryDirectory() as tmp:
            public, cfg = self.make_public(tmp)
            bs.main(cfg)
            self.assertEqual(validate_api.check(public), [])
            b1 = json.loads((public / "api/scores/b1.json").read_text())
            b2 = json.loads((public / "api/scores/b2.json").read_text())
            self.assertEqual(b1["engine"], "sweep")
            self.assertTrue(b1["frames"][0]["text"].startswith("2012. Baseline year"))
            self.assertIn("50 percent more than 2012", b1["frames"][1]["text"])
            self.assertIn("Delhi", b1["frames"][1]["text"])
            self.assertTrue(b2["frames"][0]["text"].startswith("Change from 2012 to 2013"))
            self.assertIn("Most new light: around Delhi", b2["frames"][0]["text"])
            self.assertIn("Most dimming: around London", b2["frames"][0]["text"])
            self.assertEqual([i["sound"] for i in b2["legend"]["items"]], ["Deep hum", "Rising pair of notes", "Low falling cello"])
            # Running again replaces the sweep tracks instead of adding copies.
            bs.main(cfg)
            index = json.loads((public / "api/tracks.json").read_text())
            self.assertEqual([t["id"] for t in index["tracks"]], ["b1", "b2"])

    def test_validator_catches_a_broken_sweep_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            public, cfg = self.make_public(tmp)
            bs.main(cfg)
            p = public / "api/scores/b1.json"
            s = json.loads(p.read_text())
            s["sweep"]["chapter"] = "nope"
            p.write_text(json.dumps(s))
            self.assertTrue(any("sweep chapter" in m for m in validate_api.check(public)))


if __name__ == "__main__":
    unittest.main()
