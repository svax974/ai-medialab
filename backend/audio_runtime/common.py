# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Helpers for the audio worker: text splitting, assembly, WAV output, waveform peaks.

Runs inside a pack's environment (numpy + soundfile only), so it must not import anything from the
app itself.
"""

from __future__ import annotations

import re

import numpy as np

# Sentence end: strong punctuation followed by whitespace (so decimals like "3.5" and one-letter
# abbreviations don't split).
_SENTENCE_END = re.compile(r"(?<=[.!?…。！？])[\"'»”)\]]*\s+(?=[^\s])")
_CLAUSE_END = re.compile(r"(?<=[,;:，、])\s+")


def split_text(text: str, max_chars: int) -> list[tuple[str, str]]:
    """Split text into chunks (<= max_chars) on natural boundaries.

    Returns (chunk, separator_after) pairs where the separator is "sentence" or "paragraph".
    Paragraphs (blank lines) always split; sentences are grouped while they fit, which keeps the
    prosody continuous without exceeding what the model handles in one go.
    """
    out: list[tuple[str, str]] = []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    for pi, para in enumerate(paragraphs):
        para = re.sub(r"\s*\n\s*", " ", para)
        sentences = [s.strip() for s in _SENTENCE_END.split(para) if s.strip()]
        pieces: list[str] = []
        for s in sentences:
            if len(s) <= max_chars:
                pieces.append(s)
                continue
            # Sentence too long: split at commas, then at words as a last resort.
            buf = ""
            for clause in _CLAUSE_END.split(s):
                if buf and len(buf) + 1 + len(clause) > max_chars:
                    pieces.append(buf)
                    buf = ""
                buf = f"{buf} {clause}".strip()
                while len(buf) > max_chars:
                    cut = buf.rfind(" ", 0, max_chars)
                    cut = cut if cut > max_chars // 2 else max_chars
                    pieces.append(buf[:cut].strip())
                    buf = buf[cut:].strip()
            if buf:
                pieces.append(buf)
        # Merge consecutive short sentences.
        chunk = ""
        grouped: list[str] = []
        for p in pieces:
            if chunk and len(chunk) + 1 + len(p) > max_chars:
                grouped.append(chunk)
                chunk = p
            else:
                chunk = f"{chunk} {p}".strip()
        if chunk:
            grouped.append(chunk)
        for gi, g in enumerate(grouped):
            last = gi == len(grouped) - 1
            out.append((g, "paragraph" if last and pi < len(paragraphs) - 1 else "sentence"))
    return out


def silence(seconds: float, sample_rate: int) -> np.ndarray:
    return np.zeros(int(seconds * sample_rate), dtype=np.float32)


def to_mono_float32(wav) -> np.ndarray:
    """Torch tensor, list or ndarray -> mono float32 vector."""
    if hasattr(wav, "detach"):
        wav = wav.detach().cpu().float().numpy()
    arr = np.asarray(wav, dtype=np.float32)
    if arr.ndim > 1:
        # (channels, samples) or (samples, channels): average over the shorter axis
        axis = 0 if arr.shape[0] <= arr.shape[-1] else -1
        arr = arr.mean(axis=axis)
    return np.ascontiguousarray(arr.reshape(-1))


def resample(audio: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or audio.size == 0:
        return audio
    n = int(round(audio.size * dst / src))
    x_old = np.linspace(0.0, 1.0, audio.size, endpoint=False)
    x_new = np.linspace(0.0, 1.0, n, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def trim_silence(audio: np.ndarray, sample_rate: int, threshold: float = 0.004, keep: float = 0.06) -> np.ndarray:
    """Trim leading and trailing silence (models sometimes leave a lot)."""
    if audio.size == 0:
        return audio
    loud = np.flatnonzero(np.abs(audio) > threshold)
    if loud.size == 0:
        return audio
    pad = int(keep * sample_rate)
    return audio[max(0, loud[0] - pad): min(audio.size, loud[-1] + pad)]


def peaks(audio: np.ndarray, bins: int = 240) -> list[float]:
    """Waveform peaks normalized to 0..1, for display."""
    if audio.size == 0:
        return [0.0] * bins
    edges = np.linspace(0, audio.size, bins + 1, dtype=int)
    vals = np.array([np.abs(audio[a:b]).max() if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])])
    top = vals.max() or 1.0
    return [round(float(v / top), 3) for v in vals]


def write_wav(path, audio: np.ndarray, sample_rate: int) -> None:
    import soundfile as sf

    audio = np.clip(audio, -1.0, 1.0)
    sf.write(str(path), audio, sample_rate, subtype="PCM_16")


def read_audio(path: str, sample_rate: int | None = None) -> tuple[np.ndarray, int]:
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32", always_2d=False)
    mono = to_mono_float32(data)
    if sample_rate and sr != sample_rate:
        mono = resample(mono, sr, sample_rate)
        sr = sample_rate
    return mono, sr
