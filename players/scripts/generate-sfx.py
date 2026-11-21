#!/usr/bin/env python3
"""Generate NITI's original interface sounds (no sampled recordings).

Deterministic, standard-library-only synthesis. The generated PCM16 mono WAV
files belong to this project and require no third-party sound library.
"""
from __future__ import annotations

import math
from pathlib import Path
import random
import struct
import wave

RATE = 22050
TAU = 2 * math.pi
OUTPUT = Path(__file__).resolve().parent.parent / 'web' / 'assets' / 'audio'


def blank(seconds: float) -> list[float]:
    return [0.0] * round(seconds * RATE)


def impact(dst: list[float], at: float, gain: float, seed: int,
           frequency: float = 340, decay: float = .028) -> None:
    """A small wooden/electromechanical resonance with a softened attack."""
    rng = random.Random(seed)
    start = round(at * RATE)
    low = 0.0
    for j in range(min(round(.15 * RATE), len(dst) - start)):
        t = j / RATE
        attack = min(1.0, t / .0018)
        low += .38 * (rng.uniform(-1, 1) - low)
        resonances = (math.sin(TAU * frequency * t) * .60
                      + math.sin(TAU * frequency * 1.83 * t) * .24
                      + math.sin(TAU * frequency * 3.07 * t) * .10)
        noise = low * math.exp(-t / .005) * .55
        dst[start + j] += gain * attack * (resonances * math.exp(-t / decay) + noise)


def tone(dst: list[float], at: float, duration: float, frequency: float,
         gain: float, *, warm: bool = True) -> None:
    start = round(at * RATE)
    for j in range(min(round(duration * RATE), len(dst) - start)):
        t = j / RATE
        # Smooth attack/release prevents clicks even when voices overlap.
        attack = min(1.0, t / .009)
        release = min(1.0, max(0.0, (duration - t) / .055))
        envelope = attack * release * math.exp(-t / (duration * .72))
        base = math.sin(TAU * frequency * t)
        if warm:
            base = (base * .79 + math.sin(TAU * frequency * 2 * t) * .12
                    + math.sin(TAU * frequency * 3 * t) * .05
                    + math.sin(TAU * frequency * 1.003 * t) * .04)
        dst[start + j] += gain * envelope * base


def ui_click() -> list[float]:
    dst = blank(.085)
    impact(dst, 0, .25, 101, 570, .012)
    return dst


def toggle() -> list[float]:
    dst = blank(.16)
    impact(dst, 0, .24, 201, 270, .017)
    impact(dst, .055, .17, 202, 410, .014)
    return dst


def dice_roll() -> list[float]:
    dst = blank(.64)
    for i, (at, gain, freq) in enumerate([
        (0, .31, 360), (.075, .26, 285), (.176, .23, 430),
        (.305, .18, 320), (.47, .12, 395),
    ]):
        impact(dst, at, gain, 300 + i, freq, .025)
    return dst


def dice_count() -> list[float]:
    dst = blank(1.6)
    at = 0.015
    while at < 1.48:
        progress = at / 1.6
        # Fewer ticks and a lower pitch make the count feel like it is settling.
        frequency = 1050 - 360 * progress
        gain = .22 * (1 - progress * .40)
        tone(dst, at, .035, frequency, gain, warm=False)
        at += .055 + .11 * progress ** 1.6
    return dst


def result() -> list[float]:
    dst = blank(.34)
    tone(dst, 0, .24, 660, .18)
    tone(dst, .08, .25, 880, .15)
    return dst


def level_up() -> list[float]:
    dst = blank(.88)
    for at, duration, freq, gain in [
        (0, .20, 392, .18), (.12, .23, 523.25, .17),
        (.26, .25, 659.25, .17), (.43, .42, 783.99, .19),
    ]:
        tone(dst, at, duration, freq, gain)
    tone(dst, .46, .39, 1046.5, .055)
    return dst


def write(name: str, samples: list[float]) -> None:
    # Short boundary fades guarantee silence at both ends of each audio file.
    fade = round(.004 * RATE)
    for i in range(fade):
        factor = .5 - .5 * math.cos(math.pi * i / fade)
        samples[i] *= factor
        samples[-1 - i] *= factor
    peak = max(abs(x) for x in samples)
    if peak > .42:
        samples = [x * .42 / peak for x in samples]
    pcm = [round(max(-1.0, min(1.0, x)) * 32767) for x in samples]
    path = OUTPUT / name
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(struct.pack('<' + 'h' * len(pcm), *pcm))
    measured_peak = max(abs(x) for x in pcm) / 32767
    rms = math.sqrt(sum((x / 32767) ** 2 for x in pcm) / len(pcm))
    assert measured_peak <= .4201, f'Clipping risk in {name}'
    assert pcm[0] == pcm[-1] == 0, f'Nonzero boundary in {name}'
    with wave.open(str(path), 'rb') as wav:
        assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
        assert wav.getframerate() == RATE and wav.getnframes() == len(samples)
    print(f'{name:16} {len(pcm) / RATE:.3f}s  peak={measured_peak:.3f}  rms={rms:.3f}  {path.stat().st_size} bytes')


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, factory in [
        ('ui-click.wav', ui_click), ('toggle.wav', toggle),
        ('dice-roll.wav', dice_roll), ('dice-count.wav', dice_count),
        ('result.wav', result), ('level-up.wav', level_up),
    ]:
        write(filename, factory())
