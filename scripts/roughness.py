"""Check that the chord ladder gets rougher at every rung (Plomp-Levelt / Sethares model)."""
import itertools
import math

NOTE = {"C": 0, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "Gb": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}

LADDER = [
    ["C3", "G3", "C4", "G4"],
    ["C3", "G3", "E4", "B4"],
    ["C3", "G3", "D4", "A4"],
    ["C3", "Bb3", "E4", "A4"],
    ["C3", "Db4", "Gb4", "G4"],
    ["C3", "Gb3", "Bb3", "E4"],
]

TIMBRES = {
    "default": {"partials": 6, "decay": 0.88},
    "sawtooth-like": {"partials": 8, "decay": 0.7},
    "soft": {"partials": 4, "decay": 0.5},
    "bright": {"partials": 10, "decay": 0.95},
}


def hz(name):
    pitch, octave = name[:-1], int(name[-1])
    return 440 * 2 ** ((NOTE[pitch] + 12 * (octave + 1) - 69) / 12)


def pair(f1, f2, a1, a2):
    s = 0.24 / (0.0207 * min(f1, f2) + 18.96)
    d = abs(f2 - f1)
    return min(a1, a2) * (math.exp(-3.51 * s * d) - math.exp(-5.75 * s * d))


def roughness(chord, partials, decay):
    tones = [(hz(n) * k, decay ** (k - 1)) for n in chord for k in range(1, partials + 1)]
    return sum(pair(f1, f2, a1, a2) for (f1, a1), (f2, a2) in itertools.combinations(tones, 2))


if __name__ == "__main__":
    for name, settings in TIMBRES.items():
        values = [roughness(chord, **settings) for chord in LADDER]
        verdict = "rises at every rung" if all(a < b for a, b in zip(values, values[1:])) else "ORDER FAILS"
        print(f"{name:14} {[round(v, 2) for v in values]}  {verdict}")
