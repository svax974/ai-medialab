# PyTorch: which GPUs can the audio engines use?

*Last verified: 2026-10-13, against the wheel indexes of pytorch.org, the PyTorch documentation and AMD.*
Registry and review procedure: [README.md](README.md).

The PyTorch audio packs (Qwen3-TTS, Kokoro, Pocket TTS, Whisper) and the "torch" pack of the main engine (images and videos, installed on
request) install their **own** PyTorch (`_torch_index` in
`engine/app/audio_packs.py`). The rule "is this GPU usable?" is `torch_acceleration()` in the same file; the
"slow · processor" marker of the catalogue (`_degraded` in `engine/app/catalog.py`) follows from it.

## What is verified

| Hardware | Usable by the packs? | Evidence |
|---|---|---|
| NVIDIA (Windows, Linux) | yes, CUDA wheels | index `cu128`: Windows and Linux |
| Apple Silicon | yes, Metal (MPS) | macOS PyPI wheels |
| AMD under **Linux** | yes, ROCm wheels | index `rocm6.4` to `rocm7.14` of pytorch.org: **`manylinux` x86_64 only** |
| AMD under **Windows** | **not integrated** | no ROCm Windows wheel on pytorch.org (indexes `rocm6.4`, `7.0`, `7.1`, `7.2`, `7.14`: 0 `win_amd64` file). AMD publishes a separate preview (PyTorch 2.9.1 + ROCm 7.2.1, Python 3.12, direct wheels on `repo.radeon.com`, Radeon RX 7000/9000 cards and some Ryzen AI; RX 6000 excluded). The `win-rocm` profile of `desktop/runtime/profiles.json` uses it for the main engine, not for the packs |
| Intel (Arc A/B, Core Ultra with integrated Arc GPU) | **not integrated** | PyTorch `xpu` backend (≥ 2.5), wheels on the `xpu` index for **Windows 11 and Linux** (official "Getting Started on Intel GPU" documentation); the engines only choose between cuda, mps and cpu (`pick_device`) |
| Any "Vulkan only" GPU | **no** | PyTorch's Vulkan backend is flagged as **unmaintained** in its tutorial, absent from the default builds (option `USE_VULKAN`), designed for mobile and limited to 32-bit floating-point computation in the original documentation; the current equivalent is ExecuTorch's Vulkan delegate, which runs exported models, not our PyTorch code |
| torch-directml (Windows, AMD/Intel) | **no** | in maintenance mode, stuck around PyTorch 2.2 |

## Decision

There is no complete solution: AMD outside Linux, Intel and Vulkan-only GPUs have no reliable PyTorch path
tested here. The "slow · processor" marker therefore stays, with the **GGUF twin** (audio.cpp, Vulkan) offered
when it exists (`twin` in the model options, see `audio_specs.py`). Models tagged "CPU" (Kokoro,
Pocket, Whisper) and the native engines are never marked.

## Leads to remove the marker on some machines (not done: none can be tested on a Mac)

1. **Intel XPU**: `xpu` index in `_torch_index`, `torch.xpu` in `pick_device` and in the engines of the packs, then validate
   Qwen3-TTS (dtype, memory) on an Arc or Core Ultra machine.
2. **AMD Windows (RDNA 3/4)**: reuse the wheels of the `win-rocm` profile for the packs, validate on a Radeon RX 7000/9000.
3. Then extend `torch_acceleration()` and its test (`TestDegradedMarker`) at the same time.

## To check at review

`scripts-local/review_components.py` shows, for the most recent ROCm index and for `xpu`, the latest version per system.
If **ROCm appears for Windows on pytorch.org**, or if the Windows `xpu` version catches up with the Linux one, review
`torch_acceleration()`. Also note: a `rocm7.14` index now exists while the `linux-rocm` profile pins `rocm7.2`.
