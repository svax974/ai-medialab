# Local 3D models and runtimes

The 3D studio uses the existing isolated generation worker and shared memory budget. Its primary asset format is
self-contained GLB: remote mesh resources must not be fetched during export, inspection or browser preview.
The implementation plan and cross-layer ownership are in `docs/plans/2026-11-17-mesh-generation-design.md`.

## Upstream sources

| Family | Official source | Conditioning | Model licence |
|---|---|---|---|
| Shap-E | [Diffusers documentation](https://huggingface.co/docs/diffusers/api/pipelines/shap_e), [OpenAI repository](https://github.com/openai/shap-e) | Separate text and image checkpoints | MIT |
| TripoSR | [Model card](https://huggingface.co/stabilityai/TripoSR), [runtime](https://github.com/VAST-AI-Research/TripoSR) | Image | MIT |
| TripoSG | [Model card](https://huggingface.co/VAST-AI/TripoSG), [runtime](https://github.com/VAST-AI-Research/TripoSG) | Image | MIT |
| TRELLIS | [Microsoft runtime](https://github.com/microsoft/TRELLIS) | Separate text and image checkpoints | MIT |
| TRELLIS.2 | [Model card](https://huggingface.co/microsoft/TRELLIS.2-4B), [runtime](https://github.com/microsoft/TRELLIS.2) | Image | MIT |
| Stable Fast 3D | [Model card](https://huggingface.co/stabilityai/stable-fast-3d), [runtime](https://github.com/Stability-AI/stable-fast-3d) | Image | Stability AI Community licence; gated access |

These are upstream capabilities, not a claim that real inference has been exercised in AI MediaLab. Model
specifications and actual installation requirements live in `engine/app/engines/mesh_specs.py`.
TRELLIS recommends text-to-image followed by image-to-3D over its direct text checkpoints for detail and creativity.
TRELLIS.2 officially targets Linux/NVIDIA and requires at least 24 GB GPU memory. Stable Fast 3D's official MPS support
is experimental. Never infer Apple compatibility from a generic Hugging Face library snippet.

## TripoSR and Stable Fast 3D runtime dependencies

`engine/app/mesh_runtime_sources.py` owns the exact upstream source revisions, package pins, auxiliary download URL and
checksum. Both packs install the official [rembg](https://github.com/danielgatis/rembg) (MIT) and its U²-Net ONNX
checkpoint during pack setup, before inference. The [U²-Net source](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE)
is Apache-2.0; the rembg release does not separately state licence terms for its ONNX conversion. Pack setup verifies the
checksum published by rembg. Both upstream runtimes also load DINO encoder assets from the model cache; their sources
are declared by the catalog. TripoSR loads its upstream `.ckpt` using PyTorch pickle: use only the trusted official weights.

TripoSR's official runtime code is MIT, while its compiled [torchmcubes](https://github.com/tatsy/torchmcubes/blob/main/LICENSE)
dependency is MPL-2.0. Stable Fast 3D's source and its texture-baker and UV-unwrapper extensions are in the upstream
repository under its [Stability AI Community License](https://github.com/Stability-AI/stable-fast-3d/blob/main/LICENSE.md);
its gated weights require accepting the model terms and Hugging Face authentication. Native extensions are built locally:
a matching CUDA toolkit/compiler is needed for CUDA and OpenMP is a prerequisite on macOS, not installed by the app.
TripoSR follows upstream's CUDA-or-CPU device selection; Stable Fast 3D supports CPU, CUDA and experimental MPS with
fallback. Real installation and model execution on these platforms have not been verified here.

## TripoSG, TRELLIS and TRELLIS.2 runtimes

`engine/app/trellis_packs.py` and `engine/app/mesh_runtime_sources.py` own the fixed executable source revisions,
CUDA package versions and install steps. TripoSG uses its authors’ Linux x86-64 CUDA wheel and the BRIA
[RMBG 1.4](https://huggingface.co/briaai/RMBG-1.4) model for background removal: the latter permits non-commercial use
without a separate commercial licence. Its encoder and both model repositories are downloaded through the existing
model setup before inference.

TRELLIS and TRELLIS.2 are currently offered only on Linux x86-64 with NVIDIA CUDA; they compile native extensions locally
and require a matching CUDA toolkit and compiler. TRELLIS stages the official DINOv2 checkpoint and pinned DINO source
locally, together with U²-Net, and replaces upstream's `torch.hub` network load. The text pipeline separately needs
its decoder checkpoints and OpenAI CLIP model. TRELLIS.2 separately downloads the original TRELLIS decoder, Meta
[DINOv3](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m), and BRIA
[RMBG 2.0](https://huggingface.co/briaai/RMBG-2.0). Both latter repositories require separately granted Hugging Face
access; DINOv3 has its own Meta licence and BRIA grants non-commercial use under its terms. RMBG 2.0 uses upstream
custom model code pinned to a fixed Hugging Face commit in `engine/app/engines/mesh_specs.py`. Its gated code and configuration were not accessible during this review, so its transitive runtime
behavior remains unverified. The upstream FlexGEMM installer merges an autotuning cache into `~/.flex_gemm`.

Native pack installation and real model inference have not been exercised; source and fake-adapter checks do not prove
that every compiler, GPU, gated model version or platform combination works.

## Review before updating

- Check official model and runtime licences separately, plus native dependencies and background-removal checkpoints.
- Re-read upstream installation requirements, source revisions and model file layout before changing pins.
- Check self-contained GLB export, rejected external resources, task/input validation, cancellation and memory limits.
- Keep fake-runtime tests distinct from real model, platform and browser observations in the delivery report.

Last verified against source: 2026-11-17 (official upstream model cards and runtime documentation; no real inference).
