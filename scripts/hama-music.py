#!/usr/bin/env python3
"""موسيقى أصلية لحزمة حماة — بلا حقوق خارجية.

بيب أدّ ambient هادئ: باد دافئ، ساب، وجرس خفيف. ١٥ ثانية، ستيريو، 44.1kHz.
الناتج: assets/audio/hama-theme.wav ثم m4a عبر ffmpeg.

التشغيل: python3 scripts/hama-music.py
"""
from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/audio"
SR = 44100
DUR = 15.0
N = int(SR * DUR)
T = np.arange(N) / SR
RNG = np.random.default_rng(7)


def midi(note: int) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def smooth(x: np.ndarray, width: int) -> np.ndarray:
    return np.convolve(x, np.ones(width) / width, mode="same")


def build() -> np.ndarray:
    # Am — F — C — G
    chords = [(45, 60, 64, 69), (41, 57, 60, 65), (48, 60, 64, 67), (43, 59, 62, 67)]
    seg = DUR / len(chords)
    pad = np.zeros(N)

    for i, chord in enumerate(chords):
        start = int(i * seg * SR)
        end = min(N, int((i + 1.15) * seg * SR))
        span = T[start:end]
        for j, note in enumerate(chord):
            freq = midi(note)
            amp = 0.16 if j == 0 else 0.10
            for detune in (-0.4, 0.0, 0.4):
                phase = RNG.uniform(0, 2 * np.pi)
                vibrato = 1 + 0.0015 * np.sin(2 * np.pi * 0.13 * span + phase)
                pad[start:end] += np.sin(2 * np.pi * (freq + detune) * vibrato * span + phase) * amp
        env = np.ones(end - start)
        attack = min(int(0.28 * seg * SR), len(env))
        env[:attack] = np.linspace(0, 1, attack) ** 1.5
        release = min(int(0.55 * seg * SR), len(env))
        env[-release:] *= np.linspace(1, 0, release) ** 1.2
        pad[start:end] *= env

    pad = smooth(pad, 24) * 0.9

    sub = np.zeros(N)
    for i, chord in enumerate(chords):
        s = int(i * seg * SR)
        e = min(N, int((i + 1) * seg * SR))
        sub[s:e] += np.sin(2 * np.pi * midi(chord[0] - 12) * T[s:e]) * 0.13
    sub = smooth(sub, 48)

    bells = np.zeros(N)
    melody = [(81, 0.55), (76, 2.1), (72, 3.45), (76, 4.9), (81, 6.2),
              (79, 7.6), (76, 9.0), (72, 10.4), (74, 11.9), (79, 13.1)]
    for note, at in melody:
        s = int(at * SR)
        e = min(N, int((at + 2.8) * SR))
        tt = T[s:e] - at
        env = np.exp(-tt * 3.0) * (1 - np.exp(-tt * 80))
        wave_ = (np.sin(2 * np.pi * midi(note) * tt)
                 + 0.40 * np.sin(2 * np.pi * midi(note) * 2 * tt)
                 + 0.15 * np.sin(2 * np.pi * midi(note) * 3 * tt))
        bells[s:e] += wave_ * env * 0.10

    mix = pad + sub + bells

    # صدى بسيط (comb) بدل مكتبة خارجية
    wet = np.zeros_like(mix)
    for delay in (0.037, 0.049, 0.061, 0.073):
        d = int(delay * SR)
        y = np.zeros_like(mix)
        y[d:] += mix[:-d] * 0.55
        y[2 * d:] += mix[:-2 * d] * 0.28
        y[3 * d:] += mix[:-3 * d] * 0.15
        wet += y
    mix = 0.68 * mix + 0.32 * wet / 4

    left = mix.copy()
    right = np.concatenate([np.zeros(int(0.012 * SR)), mix])[:N]

    env = np.ones(N)
    fade_in = int(0.6 * SR)
    fade_out = int(1.2 * SR)
    env[:fade_in] = np.linspace(0, 1, fade_in) ** 1.2
    env[-fade_out:] = np.linspace(1, 0, fade_out) ** 1.1
    left *= env
    right *= env

    peak = max(np.abs(left).max(), np.abs(right).max())
    gain = 0.89 / peak
    return np.stack([left * gain, right * gain], axis=1)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = build()
    pcm = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    wav = OUT / "hama-theme.wav"
    with wave.open(str(wav), "wb") as fh:
        fh.setnchannels(2)
        fh.setsampwidth(2)
        fh.setframerate(SR)
        fh.writeframes(pcm.tobytes())

    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    m4a = OUT / "hama-theme.m4a"
    subprocess.run(
        [ffmpeg, "-y", "-i", str(wav), "-c:a", "aac", "-b:a", "128k", str(m4a)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    wav.unlink()
    print("✓", m4a.relative_to(ROOT), m4a.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
