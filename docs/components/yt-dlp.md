# yt-dlp: public YouTube audio

Last verified against source: 2026-11-16.

## Why and ownership

YouTube URLs need an extractor and JavaScript challenge solver; ordinary HTTP does not expose a stable audio URL.
The transcription worker embeds the maintained Python package, without shell commands, browser cookies or account
credentials. Pin: `engine/pyproject.toml`; resolved dependencies: `engine/uv.lock`. The core runtime build reads this
manifest, so desktop ships the same dependency. No separate FFmpeg executable is added: PyAV decodes the source.

## Integration and restrictions

`engine/app/transcript_media.py` validates/canonicalizes a single public YouTube video, then requests one audio
stream (or a combined stream if audio-only is unavailable). No playlist, ongoing live stream or private-account
support. Download size/duration bounds live in that file; retries/timeouts are bounded and progress is rate limited.
Sources/chunks are temporary under the Nest job folder and cleaned after stop; uploaded originals are retained for retry.

The core `yt-dlp` wheel and its matching `yt-dlp-ejs` are declared explicitly; unused metadata postprocessors are omitted. Node resolution is the embedded `runtime/node/node[.exe]` on desktop or system
Node in development (`TRANSCRIPT_NODE` can override the executable). In the pinned implementation,
`extractor/youtube/jsc/_builtin/node.py` passes Node's `--permission` (or its older experimental spelling). The worker
environment allows runtime/cache locations only, excluding engine/Hugging Face secrets; model loading is offline.
The worker request travels over stdin. PyAV permits only self-contained formats and the `file` protocol, preventing
uploaded playlists from opening network resources.

## Licence

The PyPI yt-dlp wheel is Unlicense. EJS is Unlicense with bundled MIT/ISC components. The licence inventory is in `THIRD_PARTY_LICENSES.md`. Do not replace it with a PyInstaller executable: upstream says
those bundles contain GPL code. Primary sources:
[yt-dlp licensing/dependencies](https://github.com/yt-dlp/yt-dlp#licensing),
[EJS](https://github.com/yt-dlp/ejs),
[Node provider](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/jsc/_builtin/node.py).

## Review

`scripts-local/review_components.py` compares the manifest pin with PyPI. YouTube changes can invalidate extraction
independently of application releases. At review, check extractor fixes, EJS compatibility, Node permission flags,
Python support and dependency licences; then run the targeted transcription tests under the memory guard.
Automated verification uses fake downloads and real small synthetic audio only. Real YouTube and model runs were
not exercised in implementation tests.
