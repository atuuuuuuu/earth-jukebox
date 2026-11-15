"""Download the few instrument samples the player needs into web/samples/.

    python -m pipeline.fetch_samples                           # every instrument below
    python -m pipeline.fetch_samples contrabass strings harp   # only the ones named

Source: FluidR3_GM soundfont rendered to MP3 by gleitz/midi-js-soundfonts,
licensed CC BY 3.0 (credit shown in the app). Tone.Sampler repitches between notes,
so ~3 notes per octave is plenty.
"""
from __future__ import annotations

import sys
import urllib.request

from .config import WEB_DIR

BASE = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM"

NOTE_SET = ["C3", "E3", "Ab3", "C4", "E4", "Ab4", "C5", "E5", "Ab5", "C6", "E6"]
# Lightning plays in E flat: the notes of the E flat chord, so most notes need no repitching.
EB_SET = ["Eb3", "G3", "Bb3", "Eb4", "G4", "Bb4", "Eb5", "G5", "Bb5", "Eb6", "G6"]

INSTRUMENTS = {
    # local name: (GM instrument, notes). Keep the note lists the same as in public/sweep/audio.js.
    "harp": ("orchestral_harp", EB_SET),
    "celesta": ("celesta", NOTE_SET),
    "vibraphone": ("vibraphone", NOTE_SET),
    "music_box": ("music_box", NOTE_SET),
    "kalimba": ("kalimba", NOTE_SET),
    "cello": ("cello", ["C2", "E2", "Ab2", "C3", "E3", "Ab3", "C4"]),
    # Lightning's orchestra: an E flat pedal (with the D below it) and bowed E flat chords.
    "contrabass": ("contrabass", ["D1", "Eb1", "Bb1", "D2", "Eb2"]),
    # A flat and C too, so no chord note is pitched up: a pitched-up sample ends sooner than its bow stroke.
    "strings": ("string_ensemble_1", EB_SET[:8] + ["Ab3", "C4", "Ab4", "C5", "Ab5"]),
}


def main() -> None:
    wanted = sys.argv[1:]
    unknown = [n for n in wanted if n not in INSTRUMENTS]
    if unknown:
        raise SystemExit(f"Unknown instrument: {', '.join(unknown)}. Choose from: {', '.join(INSTRUMENTS)}")
    for local, (gm, notes) in INSTRUMENTS.items():
        if wanted and local not in wanted:
            continue
        out_dir = WEB_DIR / "samples" / local
        out_dir.mkdir(parents=True, exist_ok=True)
        for note in notes:
            dest = out_dir / f"{note}.mp3"
            if dest.exists():
                continue
            url = f"{BASE}/{gm}-mp3/{note}.mp3"
            with urllib.request.urlopen(url, timeout=30) as r:
                dest.write_bytes(r.read())
            print(f"  {local}/{note}.mp3  ({dest.stat().st_size // 1024} KB)")
    print("Samples ready in", WEB_DIR / "samples")


if __name__ == "__main__":
    main()
