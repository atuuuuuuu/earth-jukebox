"""Track 8, El Niño: the maps read from NASA's film agree with what is known.

Runs on the built data (public/data/09_el_nino.json), so it needs only the standard library.
"""
import calendar
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build_sweep as bs  # noqa: E402

DATA = json.loads((ROOT.parent / "public" / "data" / "09_el_nino.json").read_text(encoding="utf-8"))
CHAPTER = DATA["chapters"][0]
FRAMES = {f["label"]: f for f in CHAPTER["frames"]}
G = DATA["grid"]


def degrees(frame, lat, lon):
    """Degrees C from normal in the 3 degree cell at lat, lon (None on land)."""
    i = int((G["latNorth"] - lat) // G["cellDeg"]) * G["cols"] + int((lon - G["lonWest"]) // G["cellDeg"])
    a, b = frame["gain"][i], frame["loss"][i]
    return None if a is None else (a - b) / 100 * CHAPTER["degreesPerUnit"]


class ElNino(unittest.TestCase):
    def test_september_2026_agrees_with_noaa(self):
        # NOAA's ENSO discussion gave relative Niño 3.4 +2.1 for September 2026 (the earlier track read +2.03).
        self.assertAlmostEqual(FRAMES["September 2026"]["nino34Relative"], 2.1, delta=0.2)

    def test_el_nino_is_2026_not_2025(self):
        for month in calendar.month_name[1:12]:
            self.assertLess(FRAMES[f"{month} 2025"]["nino34Relative"], 0.5, month)
        for month in ("June", "July", "August", "September", "October", "November"):
            self.assertGreater(FRAMES[f"{month} 2026"]["nino34Relative"], 0.5, month)

    def test_the_warm_tongue_runs_along_the_equator_in_the_east_pacific(self):
        oct26 = [degrees(FRAMES["October 2026"], 0.5, lon) for lon in range(-148, -90, 3)]
        oct25 = [degrees(FRAMES["October 2025"], 0.5, lon) for lon in range(-148, -90, 3)]
        self.assertGreater(min(oct26), 1.2)              # every cell rings: warmer than the note line
        self.assertLess(sum(oct25) / len(oct25), 0)      # a year earlier the same water was cooler than normal

    def test_land_has_no_reading(self):
        for lat, lon in ((23, 12), (45, 90), (-25, 135)):   # Sahara, Central Asia, Australia
            self.assertIsNone(degrees(FRAMES["July 2026"], lat, lon))

    def test_the_score_says_el_nino_and_names_only_the_sea(self):
        out = bs.build_anomaly(DATA, CHAPTER, {"hotLine": 1.0})
        text = {f["when"]: f["text"] for f in out}
        self.assertIn("El Niño, above the line", text["September 2026"])
        self.assertIn("A year earlier it was 0.8 degrees C cooler than the tropics", text["September 2026"])
        self.assertIn("below the El Niño line", text["September 2025"])
        self.assertTrue(text["November 2026"].startswith("November 2026, 1 to 4 November 2026 only."))
        self.assertNotIn("Warsaw", " ".join(text.values()))    # a city square that is mostly land is never named
        self.assertTrue(all(f["date"] is None for f in out))   # pairs, not time order


if __name__ == "__main__":
    unittest.main()
