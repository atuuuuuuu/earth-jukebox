"""Download the few instrument samples the player needs into web/samples/.

    python -m pipeline.fetch_samples

Source: FluidR3_GM soundfont rendered to MP3 by gleitz/midi-js-soundfonts,
licensed CC BY 3.0 (credit shown in the app). Tone.Sampler repitches between notes,
so ~3 notes per octave is plenty.
"""
from __future__ import annotations

import urllib.request

from .config import WEB_DIR

BASE = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM"

NOTE_SET = ["C3", "E3", "Ab3", "C4", "E4", "Ab4", "C5", "E5", "Ab5", "C6", "E6"]

INSTRUMENTS = {
    # local name: (GM instrument, notes). The note voices are auditioned in the dev panel.
    "harp": ("orchestral_harp", NOTE_SET),
    "celesta": ("celesta", NOTE_SET),
    "vibraphone": ("vibraphone", NOTE_SET),
    "music_box": ("music_box", NOTE_SET),
    "kalimba": ("kalimba", NOTE_SET),
    "cello": ("cello", ["C2", "E2", "Ab2", "C3", "E3", "Ab3", "C4"]),
}


def main() -> None:
    for local, (gm, notes) in INSTRUMENTS.items():
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
