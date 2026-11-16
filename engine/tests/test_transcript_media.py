# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Long audio preparation and YouTube boundary; no models, torch probe or real network."""

import json
import os
import subprocess
import sys
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault("IMAGEGEN_DATA_DIR", "/tmp/ai-medialab-tests")
from app import transcript_media as media  # noqa: E402


@pytest.mark.parametrize("url", ["https://youtu.be/abcdefghijk", "https://youtube.com/watch?v=abcdefghijk&list=ignored", "https://www.youtube.com/shorts/abcdefghijk", "https://m.youtube.com/embed/abcdefghijk"])
def test_youtube_canonicalizes_one_video(url):
    assert media.youtube_url(url) == "https://www.youtube.com/watch?v=abcdefghijk"


@pytest.mark.parametrize("url", ["https://youtube.com.evil.test/watch?v=abcdefghijk", "https://127.0.0.1/watch?v=abcdefghijk", "file:///etc/passwd", "https://youtube.com/playlist?list=x", "https://x@youtube.com/watch?v=abcdefghijk", "https://youtube.com:444/watch?v=abcdefghijk", "https://youtu.be/abc", "--exec=anything"])
def test_youtube_rejects_other_hosts_playlists_and_options(url):
    with pytest.raises(ValueError):
        media.youtube_url(url)


def test_duration_filter_refuses_live_and_overlong_media():
    assert media._duration_filter({"is_live": True})
    assert media._duration_filter({"duration": media.MAX_SECONDS + 1})
    assert media._duration_filter({"duration": 7200}) is None


def test_audio_longer_than_thirty_seconds_is_complete_and_chunked(tmp_path):
    payload = b"\x01\x00" * (media.SAMPLE_RATE * 20)
    frame = SimpleNamespace(to_ndarray=lambda: SimpleNamespace(tobytes=lambda: payload))
    resampler = SimpleNamespace(resample=lambda value: [] if value is None else [value])
    events = []
    count, duration = media._write_frames((frame for _ in range(5)), resampler, tmp_path, 100, events.append)
    assert (count, duration) == (2, 100)
    frames = []
    for file in sorted(tmp_path.glob("chunk-*.wav")):
        with wave.open(str(file)) as source:
            frames.append(source.getnframes())
            assert source.getnchannels() == 1
    assert frames == [60 * 16000, 40 * 16000]
    assert events[-1]["done"] == 60


def test_preparation_rejects_silent_container_without_an_audio_track(tmp_path, monkeypatch):
    from app import media as existing

    class Container:
        streams = SimpleNamespace(audio=[])
        def __enter__(self): return self
        def __exit__(self, *args): pass

    monkeypatch.setattr(existing, "load_av", lambda: SimpleNamespace(open=lambda _, **kwargs: Container()))
    path = tmp_path / "video.mp4"
    path.write_bytes(b"fake")
    with pytest.raises(ValueError, match="piste audio"):
        media.prepare_chunks(path, tmp_path, lambda _: None)


def test_node_runtime_uses_the_embedded_binary_without_a_system_node(tmp_path, monkeypatch):
    executable = tmp_path / "runtime/node" / ("node.exe" if os.name == "nt" else "node")
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"fake")
    monkeypatch.setattr(media, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(media.shutil, "which", lambda _: None)
    monkeypatch.delenv("TRANSCRIPT_NODE", raising=False)
    assert media.node_runtime() == str(executable)


def test_downloader_gets_only_the_canonical_video_and_bounded_options(tmp_path, monkeypatch):
    recorded = {}
    source = tmp_path / "source.webm"
    source.write_bytes(b"fake")

    class Downloader:
        def __init__(self, options): recorded.update(options)
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, url, download):
            recorded["url"] = url
            return {"title": "Example"}
        def prepare_filename(self, info): return str(source)

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=Downloader))
    monkeypatch.setattr(media, "node_runtime", lambda: "node")
    assert media.download_audio("https://youtu.be/abcdefghijk?list=ignored", tmp_path, lambda _: None) == (source, "Example")
    assert recorded["noplaylist"] and not recorded["enable_file_urls"]
    assert recorded["url"] == "https://www.youtube.com/watch?v=abcdefghijk"
    with pytest.raises(ValueError):
        recorded["progress_hooks"][0]({"downloaded_bytes": media.MAX_SOURCE_BYTES + 1})


def test_whisper_batch_loads_one_model_for_all_chunks(tmp_path):
    fake = tmp_path / "faster_whisper.py"
    marker = tmp_path / "loads"
    fake.write_text('''from types import SimpleNamespace
class WhisperModel:
    def __init__(self, *args, **kwargs):
        open(%r, 'a').write('load\\n')
    def transcribe(self, samples, **kwargs):
        return [SimpleNamespace(text='bonjour')], SimpleNamespace(language='fr')
''' % str(marker))
    model = tmp_path / "model"
    model.mkdir()
    (model / "model.bin").touch()
    chunks = tmp_path / "chunks"
    chunks.mkdir()
    for index in range(2):
        media.write_chunk(chunks, index, b"\x00\x00" * 1600)
    script = Path(__file__).resolve().parents[1] / "audio_runtime/transcribe_batch.py"
    result = subprocess.run([sys.executable, str(script), str(chunks), str(model), "fr"],
                            env={**os.environ, "PYTHONPATH": str(tmp_path)}, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert [event["text"] for event in events] == ["bonjour", "bonjour"]
    assert events[-1]["done"] == pytest.approx(0.2)
    assert marker.read_text() == "load\n"


def test_demuxer_disallows_uploaded_network_playlists(tmp_path, monkeypatch):
    from app import media as existing
    source = tmp_path / 'renamed.mp4'
    source.write_text('#EXTM3U\n#EXT-X-TARGETDURATION:1\nhttp://127.0.0.1/internal\n')
    captured = {}

    def open_media(path, *, options):
        captured.update(options)
        raise ValueError('format rejected')

    monkeypatch.setattr(existing, 'load_av', lambda: SimpleNamespace(open=open_media))
    with pytest.raises(ValueError, match='format rejected'):
        media.prepare_chunks(source, tmp_path, lambda _: None)
    assert captured['protocol_whitelist'] == 'file'
    assert 'hls' not in captured['format_whitelist'] and 'concat' not in captured['format_whitelist']


def test_unknown_duration_is_bounded_including_the_final_partial_chunk(tmp_path, monkeypatch):
    monkeypatch.setattr(media, 'MAX_SECONDS', 65)
    payload = b'\x00\x00' * (media.SAMPLE_RATE * 66)
    frame = SimpleNamespace(to_ndarray=lambda: SimpleNamespace(tobytes=lambda: payload))
    resampler = SimpleNamespace(resample=lambda value: [] if value is None else [value])
    with pytest.raises(ValueError, match='durée maximale'):
        media._write_frames([frame], resampler, tmp_path, 0, lambda _: None)


def test_chunk_boundary_prefers_a_quiet_window_without_losing_samples():
    pcm = bytearray(b'\x00\x10' * (media.SAMPLE_RATE * media.CHUNK_SECONDS))
    start = 59 * media.SAMPLE_RATE * 2
    pcm[start:start + 640] = b'\x00' * 640
    cut = media._quiet_cut(pcm, len(pcm))
    assert cut == start + 640
    assert bytes(pcm[:cut]) + bytes(pcm[cut:]) == bytes(pcm)


def test_downloader_duration_filter_raises_the_specific_refusal():
    with pytest.raises(ValueError, match='directs'):
        media._checked_duration({'is_live': True})
    assert media._checked_duration({'duration': 120}) is None


def test_real_pyav_reader_when_already_installed(tmp_path):
    from app.media import load_av, FfmpegMissing
    try:
        av = load_av()
    except FfmpegMissing:
        pytest.skip('optional reader is not installed; never install components from tests')
    source = tmp_path / 'synthetic.wav'
    with wave.open(str(source), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b'\x00\x00' * (16000 * 95))
    assert media.prepare_chunks(source, tmp_path, lambda _: None) == (2, 95)
    source = tmp_path / 'renamed.mp4'
    source.write_text('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/internal\n#EXT-X-ENDLIST\n')
    with pytest.raises(av.error.FFmpegError):
        media.prepare_chunks(source, tmp_path, lambda _: None)


def test_snapshot_follows_main_rather_than_hash_order(tmp_path):
    old = tmp_path / 'snapshots' / ('f' * 40)
    current = tmp_path / 'snapshots' / ('a' * 40)
    old.mkdir(parents=True)
    current.mkdir()
    (tmp_path / 'refs').mkdir()
    (tmp_path / 'refs/main').write_text('a' * 40)
    assert media.model_snapshot(tmp_path) == current
    (tmp_path / 'refs/main').unlink()
    os.utime(old, (1, 1))
    os.utime(current, (2, 2))
    assert media.model_snapshot(tmp_path) == current
    with pytest.raises(ValueError):
        media.model_snapshot(tmp_path / 'missing')
