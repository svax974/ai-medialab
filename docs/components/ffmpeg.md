# FFmpeg (via PyAV): which build, which license?

*Last verified against source: 2026-10-17 (PyAV 19.0.1 macOS arm64 wheel installed in `engine/.venv`, upstream pages
cited below; the `ffmpeg` pack was not installed for real: only its unit tests ran).* Registry and review procedure: [README.md](README.md).

## What the application does with FFmpeg

No `ffmpeg` executable is called: everything goes through **PyAV** (`av`, `ffmpeg` extra of `engine/pyproject.toml`, installed by the
`ffmpeg` pack: see the decision), whose wheels embed the FFmpeg libraries (`libavcodec`, `libavformat`…) as shared libraries.

| Use | Where | Codecs |
|---|---|---|
| Write the generated clips as MP4 readable by the browser | `encode_mp4` (`engine/app/media.py`), `write_mp4` (`engine/video_runtime/common.py`) | **H.264** encoder (`yuv420p`, `+faststart`); **AAC** track (FFmpeg's native encoder) |
| Read an uploaded video, thumbnail, probing | `read_frames`, `read_video_with_audio`, `probe_video`, `video_thumb` (`media.py`), `read_frames_at`, `probe` (`common.py`) | native decoders (H.264, HEVC, VP8/9, AAC, Opus, MP3, PCM…), AV1 via dav1d |
| Demux the `.webm` of `sd-cli` (LTX with sound: VP8 + PCM) and re-encode it | `engine/app/engines/sdcpp_video_engine.py` | VP8 decoding, then `encode_mp4` |

Outside FFmpeg: voices and audio go through libsndfile (`soundfile`); `sd-cli` (stable-diffusion.cpp) is linked to no
FFmpeg library (`otool -L`). The Kiwi-Edit and Bernini video packs install their own `av` (and `imageio-ffmpeg` for
Bernini) from PyPI, **on the user's machine** and on their request (`engine/app/audio_packs.py`): the application does not
redistribute them; the license of the FFmpeg of `imageio-ffmpeg` has not been checked.

The only encoder whose license raises a question is therefore the **H.264** encoder; the native AAC and all the useful decoders are
LGPL.

## Finding: the PyPI wheel of PyAV is in practice a GPL build

Read in `engine/.venv/.../av/.dylibs/` (PyAV 19.0.1, macOS arm64):

- the `configure` line of `libavcodec` carries `--enable-version3` without `--enable-gpl`, and the library announces itself as "LGPL
  version 3 or later";
- but it is linked (`otool -L`) to **`libx264`** (1.5 MB) and **`libx265`** (6.6 MB), both GPL-2.0-or-later, shipped in
  the wheel. The repository that produces these builds, [pyav-ffmpeg](https://github.com/PyAV-Org/pyav-ffmpeg), lists x264 and x265 for all
  platforms and does not publish an LGPL variant;
- the rest is permissive or LGPL (lame, opus, vpx, dav1d, webp, vmaf, SVT-AV1).

According to [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html), as soon as GPL parts are used "the GPL applies to all of
FFmpeg", and the LGPL compliance list requires compiling without `--enable-gpl` / `--enable-nonfree` and checking that no
GPL library such as libx264 is used. A desktop application that embeds this wheel as is therefore distributes
GPL code (corresponding source of FFmpeg, x264 and x265 to be supplied). The application's MIT license remains compatible, but the
obligations are heavier than necessary, for two libraries we can do without.

## Decision

1. **PyAV is not in the installer.** The `ffmpeg` pack (`PACKS['ffmpeg']`, `engine/app/audio_packs.py`, `runtime` family, ≈ 50 MB) installs
   `av` on the user's machine, from PyPI, with the first video model (`engine/app/components.py`: any model with `kind == "video"`
   requires it). The application therefore does not redistribute the wheel (nor x264/x265): same position as for the Kiwi-Edit and Bernini packs. Its
   `site-packages` is added to `sys.path` by `media.load_av` (server) and by `activate_overlays` (worker). Without it, sending a video
   answers 409 with a message that points to the installation. This is not legal advice; the H.264 / AAC patents are not addressed.
2. **H.264 encoder chosen at run time, without depending on libx264.** `H264_ENCODERS` (`engine/app/media.py`, copy in
   `engine/video_runtime/common.py`) tries, in order, `h264_videotoolbox` (Apple's hardware encoder, system library: LGPL-compatible),
   `libopenh264` (Cisco's OpenH264, BSD-2-Clause), then `libx264` as a last resort; the first one that opens at the requested
   size wins. Bitrate: setting in `_h264_settings` (x264 keeps its CRF). Checked on a Mac Apple Silicon with the development wheel: VideoToolbox is retained, the MP4 produced is H.264. On Windows and Linux, `pyav-ffmpeg` lists x264 for all platforms; the presence of a hardware encoder or of OpenH264 in these wheels is not verified, so `libx264` is then used.
3. **Development**: `uv sync --extra ffmpeg` (`scripts-local/dev-services.sh` does it). Nothing is distributed.
4. **Option not retained for now, an offline installer or a strict LGPL license**: embed an **LGPL FFmpeg as shared libraries** (without `--enable-gpl`, without `--enable-nonfree`, without x264 or x265) and a PyAV compiled against it
   (`pip install av --no-binary av` with `pkg-config`, see the [PyAV installation doc](https://pyav.basswood.io/docs/stable/overview/installation.html);
   FFmpeg at the major version expected by the pinned PyAV).
   - **macOS**: `--enable-videotoolbox --enable-audiotoolbox`, plus libopus, libvpx, libdav1d (BSD). There is no
     ready-made LGPL macOS build at [BtbN](https://github.com/BtbN/FFmpeg-Builds) (Windows and Linux only): to compile
     (PyAV's `scripts/build-deps` script adapted, or configure by hand).
   - **Linux, Windows**: start from BtbN's `lgpl-shared` variants (without x264/x265). An H.264 encoder from the list is needed:
     `libopenh264` if it is compiled in (to check), otherwise add it. Patents: Cisco's patent license only covers the
     OpenH264 binaries **downloaded from Cisco**, not a copy compiled and embedded by us. On Windows, `h264_mf`
     (Media Foundation) would be an alternative to add to the list, untested.
   - `scripts-local/build_runtime.py` (`report_ffmpeg_license`) **warns** when the assembled runtime contains libx264 / libx265 (a profile that would re-embed `av`): such an installer is not published without the corresponding source.

## Obligations if the LGPL build (option 4) is embedded

According to the list at [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html):

- dynamic linking (already the case: separate `.dylib` / `.so` / `.dll`), library names not disguised;
- provide the **exact source** of the FFmpeg used (archive hosted next to the installer), the `configure` line and any
  diff; likewise for each LGPL library added (e.g. lame);
- mention of FFmpeg and of the LGPL in the "About" window and on the download page; any end-user license must neither forbid
  reverse engineering nor claim FFmpeg;
- keep the BSD notices of the permissive libraries (opus, vpx, dav1d, OpenH264).

This document is not legal advice (H.264 / AAC patents included).

## Next steps

1. Install the `ffmpeg` pack for real on Mac, Windows and Linux (not done): check that `av` loads from the overlay (libraries
   `av/.dylibs`, `av.libs` or DLL next to the module) in the server and in the worker, and that `h264_encoder` retains the expected encoder.
2. Mention FFmpeg and its download in the "About" window and in the release notes.
3. If an offline installer or a strict LGPL license becomes necessary: option 4 above (compile LGPL FFmpeg and PyAV, source attached).

## To check at review

- The contents of `av/.dylibs` (or `av.libs`) after a PyAV version bump, and the `configure` line of `libavcodec`.
- If PyAV or pyav-ffmpeg one day publish an LGPL variant of their wheels, the `ffmpeg` pack would install it instead (change `requirements`).
