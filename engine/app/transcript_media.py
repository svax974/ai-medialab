# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Bounded media preparation for long transcription. No application records or model imports."""

from __future__ import annotations

import os
import re
import shutil
import struct
import time
import wave
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlsplit

from .config import ROOT_DIR

SAMPLE_RATE = 16000
CHUNK_SECONDS = 60
MAX_SOURCE_BYTES = 500 * 1024 * 1024
MAX_SECONDS = 12 * 3600
ALLOWED_FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mp3,wav,flac,ogg,aac,mpegts"


def youtube_url(value: str) -> str:
    """Canonical single-video URL; never pass an arbitrary URL or playlist to the downloader."""
    parsed = urlsplit(value.strip())
    if len(value) > 2048 or parsed.scheme not in ("https", "http") or parsed.username or parsed.password:
        raise ValueError("Lien YouTube invalide.")
    if parsed.port not in (None, 80, 443):
        raise ValueError("Lien YouTube invalide.")
    host = (parsed.hostname or "").lower()
    parts = parsed.path.strip("/").split("/")
    video_id = ""
    if host == "youtu.be" and len(parts) == 1:
        video_id = parts[0]
    elif host in ("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"):
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif len(parts) == 2 and parts[0] in ("shorts", "embed", "live"):
            video_id = parts[1]
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError("Lien YouTube invalide.")
    return f"https://www.youtube.com/watch?v={video_id}"


def node_runtime() -> str:
    """System Node in dev, embedded Node in desktop (no system installation required)."""
    candidates = [os.environ.get("TRANSCRIPT_NODE"), str(ROOT_DIR / "runtime/node" / ("node.exe" if os.name == "nt" else "node")), shutil.which("node")]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise ValueError("Le moteur JavaScript nécessaire à YouTube est introuvable.")


def model_snapshot(cache: Path) -> Path:
    """Use the downloaded main revision; legacy caches fall back to the latest directory by time."""
    reference = cache / "refs/main"
    if reference.is_file():
        revision = reference.read_text().strip()
        candidate = cache / "snapshots" / revision
        if re.fullmatch(r"[a-fA-F0-9]{40,64}", revision) and candidate.is_dir():
            return candidate
    snapshots = [path for path in (cache / "snapshots").glob("*") if path.is_dir()]
    if not snapshots:
        raise ValueError("Modèle de transcription introuvable sur le disque.")
    return max(snapshots, key=lambda path: path.stat().st_mtime)


def download_audio(url: str, folder: Path, emit: Callable[[dict], None]) -> tuple[Path, str]:
    """Download one public video's audio, with bounded retries and a hard size limit."""
    from yt_dlp import YoutubeDL

    canonical = youtube_url(url)
    last_emit = 0.0

    def progress(data: dict) -> None:
        nonlocal last_emit
        done = data.get("downloaded_bytes", 0)
        if done > MAX_SOURCE_BYTES:
            raise ValueError("Le média dépasse la taille maximale de 500 Mo.")
        now = time.monotonic()
        if now - last_emit >= 0.5 or data.get("status") == "finished":
            last_emit = now
            emit({"type": "progress", "stage": "downloading", "done": done, "total": data.get("total_bytes") or data.get("total_bytes_estimate") or 0})

    options = {"format": "bestaudio/best", "outtmpl": str(folder / "source.%(ext)s"), "noplaylist": True,
               "quiet": True, "no_warnings": True, "cachedir": False, "socket_timeout": 15, "retries": 2,
               "fragment_retries": 2, "sleep_interval_requests": 1, "max_filesize": MAX_SOURCE_BYTES,
               "progress_hooks": [progress], "js_runtimes": {"node": {"path": node_runtime()}},
               "match_filter": _checked_duration, "enable_file_urls": False}
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(canonical, download=True)
        if not info or info.get("_type") in ("playlist", "multi_video"):
            raise ValueError("Choisissez une vidéo YouTube, pas une liste de lecture.")
        source = Path(downloader.prepare_filename(info))
    if not source.is_file() or source.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("Le média est absent ou dépasse la taille maximale de 500 Mo.")
    return source, str(info.get("title") or "YouTube")[:240]


def _duration_filter(info: dict, *, incomplete: bool = False) -> str | None:
    if info.get("is_live") or info.get("live_status") == "is_live":
        return "Les directs en cours ne peuvent pas être transcrits."
    if (info.get("duration") or 0) > MAX_SECONDS:
        return "Le média dépasse la durée maximale de 12 heures."
    return None


def _checked_duration(info: dict, *, incomplete: bool = False) -> None:
    reason = _duration_filter(info, incomplete=incomplete)
    if reason:
        raise ValueError(reason)


def write_chunk(folder: Path, index: int, pcm: bytes) -> None:
    """Write one mono PCM chunk; the caller never retains the full decoded media."""
    with wave.open(str(folder / f"chunk-{index:06d}.wav"), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm)


def prepare_chunks(source: Path, folder: Path, emit: Callable[[dict], None]) -> tuple[int, float]:
    """Decode an audio track incrementally through the existing PyAV component."""
    from .media import load_av

    av = load_av()
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("Le média dépasse la taille maximale de 500 Mo.")
    # Probe only self-contained media: never follow an uploaded HLS/concat playlist.
    with av.open(str(source), options={"protocol_whitelist": "file", "format_whitelist": ALLOWED_FORMATS}) as container:
        audio = next(iter(container.streams.audio), None)
        if audio is None:
            raise ValueError("Ce fichier ne contient aucune piste audio.")
        duration = (container.duration or 0) / 1_000_000
        if duration > MAX_SECONDS:
            raise ValueError("Le média dépasse la durée maximale de 12 heures.")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        return _write_frames(container.decode(audio), resampler, folder, duration, emit)


def _write_frames(frames, resampler, folder: Path, duration: float, emit: Callable[[dict], None]) -> tuple[int, float]:
    buffer, count, total = bytearray(), 0, 0
    size = SAMPLE_RATE * CHUNK_SECONDS * 2
    for frame in _resampled(frames, resampler):
        buffer.extend(frame.to_ndarray().tobytes())
        while len(buffer) >= size:
            cut = _quiet_cut(buffer, size)
            write_chunk(folder, count, bytes(buffer[:cut]))
            del buffer[:cut]
            count, total = count + 1, total + cut
            if total / (SAMPLE_RATE * 2) > MAX_SECONDS:
                raise ValueError("Le média dépasse la durée maximale de 12 heures.")
            emit({"type": "progress", "stage": "preparing", "done": total / (SAMPLE_RATE * 2), "total": duration})
    if buffer:
        if (total + len(buffer)) / (SAMPLE_RATE * 2) > MAX_SECONDS:
            raise ValueError("Le média dépasse la durée maximale de 12 heures.")
        write_chunk(folder, count, bytes(buffer))
        count, total = count + 1, total + len(buffer)
    if not count:
        raise ValueError("La piste audio est vide.")
    return count, total / (SAMPLE_RATE * 2)


def _quiet_cut(pcm: bytearray, size: int) -> int:
    """Prefer a quiet 20 ms boundary in the last two seconds, avoiding most word cuts."""
    window = SAMPLE_RATE // 50 * 2
    candidates = range(max(0, size - SAMPLE_RATE * 4), size - window + 1, window)
    def energy(start: int):
        samples = struct.unpack(f"<{window // 2}h", pcm[start:start + window])
        return sum(abs(sample) for sample in samples), -start
    return min(candidates, key=energy) + window


def _resampled(frames, resampler):
    for frame in frames:
        yield from resampler.resample(frame)
    yield from resampler.resample(None)
