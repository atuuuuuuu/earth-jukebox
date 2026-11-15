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


class NewBuilders(unittest.TestCase):
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

    def test_pollutants_skip_unread_cells_and_name_the_thickest(self):
        v = fine(10)
        for j in [at(lat, lon) for lat in (32, 35, 38) for lon in (111, 114, 117)]:
            v[j] = 100                               # Beijing's 10-degree square
        east = [at(lat, lon) for lat in range(-88, 90, 3) for lon in range(142, 180, 3)]
        for j in east:
            v[j] = 100                               # would be thickest, but NASA's map has no reading there
        out = bs.build_pollutants({"grid": G}, {"frames": [
            {"label": "Ozone", "span": "July and August 2024", "image": "o3.webp", "glow": v, "core": v,
             "total": 1.0, "missing": east}]}, {"hotLine": 0.5})
        self.assertTrue(out[0]["text"].startswith("Ozone, July and August 2024. Thickest: around Beijing"), out[0]["text"])
        self.assertIsNone(out[0]["grid"][5][33])     # 40-50 N, 150-160 E: not read
        self.assertIsNone(out[0]["date"])

    def test_globe_map_names_the_strongest_places_and_keeps_unread_cells_empty(self):
        g = fine(0.0)
        g[at(35, -65)] = 100                          # the Gulf Stream
        g[at(85, 0)] = None                           # never shown face-on: no reading
        out = bs.build_map({"grid": G}, {"frames": [{"label": "January to September 2021", "about": "One map.",
                                                    "image": "m.webp", "alt": "", "glow": g}]},
                           {"hotLine": 0.5, "words": {"busiest": "Strongest currents"}})
        f = out[0]
        self.assertTrue(f["text"].startswith("January to September 2021. One map. Strongest currents: around "), f["text"])
        self.assertEqual(f["grid"][5][11], 1.0)       # 30-40 N, 70-60 W
        self.assertEqual(f["when"], "January to September 2021")
        self.assertIsNone(f["date"])

    def test_scenes_have_no_map_and_tell_the_story(self):
        out = bs.build_scenes({}, {"frames": [
            {"label": "Gulf Stream", "from": "1 May 2023", "to": "2 June 2023", "place": "the Gulf Stream",
             "image": "s.webp", "alt": "", "relative": 1, "story": "It carries warmth to Europe."}]}, {"hotLine": 0.5})
        f = out[0]
        self.assertEqual(f["text"], "Gulf Stream, 1 May 2023 to 2 June 2023. The camera is over the Gulf Stream. "
                                    "Bright moving water in the picture: the busiest scene. It carries warmth to Europe.")
        self.assertTrue(all(c is None for row in f["grid"] for c in row))
        self.assertEqual((len(f["grid"]), len(f["grid"][0])), (18, 36))

    def test_river_scenes_use_nasas_clock_and_their_own_words(self):
        out = bs.build_scenes({}, {"frames": [
            {"label": "Along the river, in 3D", "span": "11 December 2010 at 18:43 UTC, NASA's clock standing still",
             "place": "the river itself, flying low along it", "image": "s.webp", "alt": "", "relative": 0.62, "story": "The pulses stop."}]},
            {"hotLine": 0.5, "words": {"busy": "Water vapour in the picture"}})
        self.assertEqual(out[0]["text"], "Along the river, in 3D, 11 December 2010 at 18:43 UTC, NASA's clock standing still. "
                                         "The camera is over the river itself, flying low along it. Water vapour in the picture: "
                                         "62 percent of the busiest scene. The pulses stop.")


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
