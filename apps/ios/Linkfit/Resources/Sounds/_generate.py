#!/usr/bin/env python3
"""
Audio/Haptic agent — programmatic WAV generator.

Synthesizes the short (~0.1–0.4s) royalty-free tones that
`SoundPlayer.swift` loads on boot. Run once:

    python3 _generate.py

Outputs mono 16-bit PCM WAV files at 44.1 kHz into the same directory.
Each tone uses a simple ADSR envelope to avoid harsh click artifacts on
attack/release. Tones intentionally stay in the 200–440 Hz range so they
read as soft UI confirmations rather than alerts.

The intent is "barely-there positive feedback" — never longer than half a
second, never louder than the system click. If you want a different
character (chord, glide, partials), edit the `recipes` table below.
"""

from __future__ import annotations

import math
import os
import struct
import wave
from dataclasses import dataclass
from typing import List, Tuple

SAMPLE_RATE = 44_100
BIT_DEPTH = 16
NUM_CHANNELS = 1
PEAK_AMP = 0.55  # headroom, never clip


@dataclass(frozen=True)
class Tone:
    """A single sine partial: (frequency Hz, weight 0..1)."""
    freq: float
    weight: float = 1.0


@dataclass(frozen=True)
class Recipe:
    """Synthesis recipe for one .wav file."""
    name: str
    duration: float       # seconds
    tones: Tuple[Tone, ...]
    # ADSR fractions of total duration
    attack: float = 0.06
    decay: float = 0.18
    sustain: float = 0.55
    release: float = 0.30
    # Optional pitch glide end frequency multiplier (1.0 = no glide).
    glide: float = 1.0


def adsr_envelope(n_samples: int, a: float, d: float, s: float, r: float) -> List[float]:
    """Generates a per-sample amplitude envelope in [0, 1].

    `a`, `d`, `r` are fractions of total length used for the attack,
    decay, and release segments. `s` is the sustain level (0..1)."""
    a_n = max(1, int(n_samples * a))
    d_n = max(1, int(n_samples * d))
    r_n = max(1, int(n_samples * r))
    s_n = max(0, n_samples - a_n - d_n - r_n)

    env: List[float] = []
    # Attack: 0 -> 1
    for i in range(a_n):
        env.append(i / a_n)
    # Decay: 1 -> sustain
    for i in range(d_n):
        env.append(1.0 - (1.0 - s) * (i / d_n))
    # Sustain
    env.extend([s] * s_n)
    # Release: sustain -> 0
    for i in range(r_n):
        env.append(s * (1.0 - i / r_n))
    # Trim/pad to exact length
    return env[:n_samples] + [0.0] * max(0, n_samples - len(env))


def synthesize(recipe: Recipe) -> bytes:
    """Renders one recipe to little-endian 16-bit PCM bytes."""
    n = int(SAMPLE_RATE * recipe.duration)
    env = adsr_envelope(n, recipe.attack, recipe.decay, recipe.sustain, recipe.release)
    total_weight = sum(t.weight for t in recipe.tones) or 1.0

    frames = bytearray()
    for i in range(n):
        t = i / SAMPLE_RATE
        # Smooth log-glide to `glide * freq` over the full duration.
        progress = i / max(1, n - 1)
        glide_mult = math.exp(math.log(recipe.glide) * progress) if recipe.glide != 1.0 else 1.0

        sample = 0.0
        for tone in recipe.tones:
            f = tone.freq * glide_mult
            sample += math.sin(2 * math.pi * f * t) * (tone.weight / total_weight)
        sample *= env[i] * PEAK_AMP
        # Clamp & quantize
        s = max(-1.0, min(1.0, sample))
        frames += struct.pack("<h", int(s * 32_767))
    return bytes(frames)


def write_wav(path: str, pcm: bytes) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(NUM_CHANNELS)
        w.setsampwidth(BIT_DEPTH // 8)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)


# ---------- Recipes ---------------------------------------------------------
# Tuned to feel: confirmation = mid C5 area, error = minor 2nd, win = perfect
# fifth glide-up, light selection = clipped tick. All stay ≤ 0.4 s.

C4 = 261.63
E4 = 329.63
G4 = 392.00
A4 = 440.00
C5 = 523.25  # well above our 200-440 cap; we'll de-rate weight if used.
# Stick to 200–440 Hz per the brief — use partials inside that band.

recipes: List[Recipe] = [
    Recipe(
        name="game_joined",
        duration=0.30,
        tones=(Tone(E4, 1.0), Tone(G4, 0.4)),
        glide=1.0,
    ),
    Recipe(
        name="game_left",
        duration=0.28,
        tones=(Tone(G4, 1.0), Tone(E4, 0.4)),
        glide=0.78,  # descending
    ),
    Recipe(
        name="booking_confirmed",
        duration=0.36,
        tones=(Tone(E4, 1.0), Tone(A4, 0.6)),
        glide=1.12,  # slight rise = success
    ),
    Recipe(
        name="message_received",
        duration=0.18,
        tones=(Tone(G4, 1.0),),
        attack=0.04, decay=0.18, sustain=0.45, release=0.55,
    ),
    Recipe(
        name="message_sent",
        duration=0.14,
        tones=(Tone(A4, 1.0),),
        attack=0.03, decay=0.20, sustain=0.30, release=0.60,
    ),
    Recipe(
        name="achievement_unlocked",
        duration=0.40,
        tones=(Tone(E4, 0.9), Tone(G4, 0.7), Tone(A4, 0.5)),
        glide=1.15,
    ),
    Recipe(
        name="point_scored",
        duration=0.16,
        tones=(Tone(A4, 1.0),),
        attack=0.02, decay=0.15, sustain=0.40, release=0.55,
    ),
    Recipe(
        name="set_won",
        duration=0.32,
        tones=(Tone(E4, 1.0), Tone(A4, 0.6)),
        glide=1.18,
    ),
    Recipe(
        name="match_won",
        duration=0.40,
        tones=(Tone(C4, 0.7), Tone(E4, 0.8), Tone(G4, 0.6), Tone(A4, 0.4)),
        glide=1.22,
    ),
    Recipe(
        name="match_lost",
        duration=0.38,
        tones=(Tone(A4, 0.7), Tone(G4, 0.7), Tone(E4, 0.8)),
        glide=0.72,
    ),
    Recipe(
        name="error",
        duration=0.22,
        tones=(Tone(E4, 1.0), Tone(280.0, 0.5)),  # E4 + clashing partial
        glide=0.85,
    ),
    Recipe(
        name="light_selection",
        duration=0.07,
        tones=(Tone(A4, 1.0),),
        attack=0.10, decay=0.30, sustain=0.10, release=0.60,
    ),
]


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    for r in recipes:
        path = os.path.join(here, f"{r.name}.wav")
        write_wav(path, synthesize(r))
        print(f"wrote {os.path.basename(path)} ({r.duration:.2f}s)")
    print(f"\nDone. {len(recipes)} files in {here}")


if __name__ == "__main__":
    main()
