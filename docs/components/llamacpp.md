# llama.cpp — engine for the chat models (GGUF)

*Last verified against the code and upstream: 2026-10-15.* Registry and review procedure: [README.md](README.md).

## Why

The "Chat" mode runs local language models. llama.cpp (<https://github.com/ggml-org/llama.cpp>, MIT)
is the reference for reading them in the GGUF format: prebuilt binaries for Metal, CUDA, ROCm, Vulkan and CPU, an OpenAI-compatible
HTTP server (`llama-server`) with streamed responses, function calls (`--jinja`), vision models
(`--mmproj`) and reasoning. It is the same principle as stable-diffusion.cpp and audio.cpp: a small
standalone program, installed on demand, without Python.

## What is integrated

| Element | Where | Role |
|---|---|---|
| Installation and build choice | `engine/app/llamacpp.py` | downloads the pinned version (`PINNED_TAG`), checks the SHA-256 published by GitHub, extracts without leaving the target folder, checks that the program runs (and sees a GPU for a GPU build), otherwise tries the next build down to CPU |
| Server and memory arbiter | `engine/app/llm.py` | one `llama-server` at a time, on `127.0.0.1`, random API key in the environment; normalized event stream; memory monitoring; unloading after inactivity |
| Routes | `engine/app/api/llm.py` | `/engine/v1/llm/*` (status, streamed chat, unloading, token counting) and `/engine/v1/engines/llamacpp/*` (installation); the stream detail is in the file header |
| Models | `engine/app/engines/llm_models.py` | predefined list, context cache estimate and memory need |
| Hugging Face models | `engine/app/hf_search.py`, `engine/app/engines/custom.py` (family `llm-gguf`) | search, quantization choice, sliced files, vision projector |

On disk: binaries in `<engines>/llamacpp/<variant>/` (`IMAGEGEN_LLAMACPP_DIR` to change it); weights in the Hugging Face
cache. `IMAGEGEN_LLAMACPP_TAG` replaces the pinned version (`latest` or a tag), `IMAGEGEN_LLAMACPP_VARIANT` forces a build.

### Pinning

The latest release published for at least 14 days at the time of pinning (on 2026-10-15 at 09:42 UTC: the release of
2026-10-01 at 09:32 UTC), whose 35 files have a published SHA-256 and whose expected names (table `ASSETS`) exist, checked
through the GitHub API. A neighbouring release (`b11311`) has only 25 files: a partial publication, to be avoided if the list is moved up by hand. Builds
come out several times a day; a version bump is decided at review, not automatically.

### `llama-server` flags used

Source: `tools/server/README.md` of release `b11317` (`https://github.com/ggml-org/llama.cpp/blob/b11317/tools/server/README.md`),
read on 2026-10-15 (identical to that of `b11312`, which was used for the first reading); **no binary has been run** to confirm them.

| Flag | Why |
|---|---|
| `--model`, `--alias`, `--host 127.0.0.1`, `--port` | loading the file, model name in the API, local listening only |
| `--ctx-size`, `--parallel 1` | requested context (the cache is paid at loading); one response at a time |
| `--jinja` | conversation templates and function calls (active by default, explicit here) |
| `--no-webui`, `--no-slots` | no web interface nor slot monitoring endpoint |
| `--cache-ram 1024` | prompt-state cache in RAM capped at 1 GiB (8 GiB by default, too much for unified memory shared with the model) |
| `--reasoning-format deepseek` | the model's reasoning arrives in `reasoning_content`, separate from the answer |
| `--mmproj` | vision projector, only for a model that reads images |
| `-ngl all` | everything on the GPU when the planner says it fits; otherwise the default (`--fit`, active by default) places the layers |
| variable `LLAMA_API_KEY` | API key, outside the command line (visible in `ps`) |

Request side (`/v1/chat/completions`): `stream_options.include_usage`, `cache_prompt`, the sampling parameters,
`tools`, `reasoning_effort` (`none` turns reasoning off), `parallel_tool_calls: false`. Images are never given by address:
the engine reads the file from the data folder (or a data URL) and sends a data URL, so the server reads and downloads nothing
(`--media-path` is not used).

## Memory

A single model in memory for the whole application (`ARCHITECTURE.md`, "Memory safety nets"): the generation worker leaves before a chat model,
the chat server leaves before a worker. The need of a chat = weights (model and projector) + context cache +
0.6 GB of buffers (`llm_models.memory_need_gb`). The cache comes from the architecture of each model (full-cache layers,
sliding-window layers, heads, dimension, read from the model's `config.json`) with a 10% margin; for a model added
from Hugging Face, whose architecture is unknown, it is guessed from the size of the weights (0.03 MB per token and per GB of weights,
calibrated on Qwen3 8B: overestimated for most).

## To check at review

- That the archives have the expected structure: the program is looked for where the archive puts it (`find_binary_dir`) and the
  CUDA libraries are copied alongside, but **no real archive has been downloaded** to confirm this.
- The format of `llama-server --list-devices` (read by `_DEVICE`): unreadable output is accepted in good faith.
- The `macos-x64` build: classified as "cpu" for lack of having verified that it enables Metal.
- The capabilities of the predefined models (`tools`, `reasoning`, `vision`): read from the base models' cards, never tried for real with this server.
- The licences (`THIRD_PARTY_LICENSES.md`): section 5 of the LFM Open License has not been re-read.
