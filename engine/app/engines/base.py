# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Common contract for generation engines.

A model is a `ModelSpec` (metadata, capabilities, parameters exposed to the UI) plus an `Engine`
class (load + generate, runs in the worker process).

To add a model: create a module in `app/engines/` with a spec and an engine, then register it in
`app/engines/__init__.py`.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from PIL import Image

ReferenceMode = Literal["none", "init", "multi", "face"]


def size_reference_index(mode: str, count: int) -> int:
    """Which attached image gives the format and the "Original" size: the first one, except in "face" mode where the
    first image is the face to follow and the second, when given, is the start image."""
    return 1 if mode == "face" and count > 1 else 0


@dataclass
class ParamSpec:
    key: str
    label: str
    type: Literal["int", "float", "text", "bool"]
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    help: str = ""
    advanced: bool = False
    # Only shown when reference images are attached.
    requires_references: bool = False


Backend = Literal["mlx", "torch", "sdcpp", "llamacpp", "pack", "demo"]
Kind = Literal["image", "audio", "video", "llm", "diagram"]


@dataclass
class PresetVoice:
    """Built-in voice of a TTS model."""

    id: str
    name: str
    language: str  # language code ("fr", "en"...); "*" = every language of the model
    gender: Literal["f", "m", "n"] = "n"
    description: str = ""


@dataclass
class Language:
    code: str
    label: str


@dataclass
class AudioCaps:
    """What the UI can offer for an audio model."""

    task: Literal["tts", "stt"] = "tts"
    languages: list[Language] = field(default_factory=list)
    voices: list[PresetVoice] = field(default_factory=list)
    # Voice cloning from a sample: "none", "optional" (a transcript improves it) or "required".
    clone: Literal["none", "optional", "required"] = "none"
    # Free-text style instruction ("warm tone, calm voice"...).
    instruct: bool = False
    instruct_help: str = ""
    # Voice created from a description (the description is the voice).
    design: bool = False
    speed: bool = False
    # Tags that can be inserted in the text ("[laugh]"...).
    tags: list[str] = field(default_factory=list)
    max_chars: int = 600
    sample_rate: int = 24000


@dataclass
class VideoResolution:
    id: str  # "480p"
    label: str
    short_side: int  # pixels of the shorter side at this definition
    long_side: int  # the longer side never exceeds this (keeps tall/wide aspects within what the model handles)


@dataclass
class VideoCaps:
    """What the UI can offer for a video model."""

    tasks: list[Literal["t2v", "i2v", "v2v"]] = field(default_factory=lambda: ["t2v"])
    fps: int = 24
    frame_step: int = 4  # frames = n * frame_step + 1
    default_seconds: float = 5.0
    min_seconds: float = 1.0
    max_seconds: float = 5.0
    # Longest span one model run may produce (the model's own clip length). A longer clip is made of several runs chained
    # image-to-video (each starts from the last frame of the previous one), whose real length is the longest the memory
    # measured on this machine allows (video_memory.py); None: one run, so `max_seconds` is also the run length.
    segment_seconds: float | None = None
    resolutions: list[VideoResolution] = field(default_factory=list)
    default_resolution: str = ""
    image_input: Literal["none", "optional", "required"] = "none"  # start image
    last_frame: bool = False  # accepts an end image too
    # What the image input is: the first frame ("start") or a subject / style to follow ("reference").
    image_role: Literal["start", "reference"] = "start"
    video_input: Literal["none", "optional", "required"] = "none"  # source video to edit
    audio_out: bool = False
    english_only: bool = False
    license_warning: str = ""  # shown prominently when not empty


@dataclass
class LlmCaps:
    """What the chat can offer for a language model (run by llama.cpp, see `llm.py`)."""

    context_default: int = 16384  # tokens of context a chat opens with (the KV cache is paid for up front)
    context_max: int = 32768  # what the model was trained for (or what we allow)
    vision: bool = False  # reads images through a multimodal projector (`options["files"]["mmproj"]`)
    tools: bool = False  # can call functions (OpenAI-style `tools`)
    # "none": no thinking; "toggle": thinks when asked; "always": always thinks; "levels": thinks at low/medium/high.
    reasoning: Literal["none", "toggle", "always", "levels"] = "none"
    moe: bool = False  # mixture of experts: runs like its active parameters, loads like its total
    params_b: float | None = None  # billions of parameters (total)
    active_params_b: float | None = None  # billions of parameters active per token (MoE)


@dataclass
class HfSource:
    """A Hugging Face repo (or part of one) a model depends on, or a locally produced artifact (`kind="derived"`):
    weights quantized once from such a repo and saved under `DERIVED_DIR`, never re-derived at load time."""

    repo: str  # for kind="derived": the upstream repo this was produced from (for display only)
    patterns: list[str] | None = None  # files to download (fnmatch); None = whole repo
    check_files: list[str] = field(default_factory=list)  # patterns that must match for the source to count as installed
    size_gb: float | None = None  # approximate size, for overall progress
    kind: Literal["hf", "derived"] = "hf"
    local_dir: str = ""  # kind="derived": path under DERIVED_DIR holding the produced checkpoint


@dataclass
class Variant:
    """One quantization of a model: only the weight files differ.

    Picking a variant downloads only that one. `sources` and `options` replace the model's; everything else
    (params, references, shared encoders) stays the same."""

    key: str
    label: str  # "Q4_K", "4 bits"...
    size_gb: float
    sources: list["HfSource"]
    options: dict[str, Any] = field(default_factory=dict)  # merged into ModelSpec.options
    weights_gb: float | None = None
    largest_component_gb: float | None = None


@dataclass
class ModelSpec:
    id: str
    name: str
    family: str
    description: str
    engine: str  # "module:Class", imported lazily in the worker
    # Inference backend: "mlx" (native Metal, Mac), "torch" (CUDA / ROCm / MPS), "sdcpp", "llamacpp" (chat), "pack", "demo".
    backend: Backend = "mlx"
    # References: "none" (text only), "init" (one start image, img2img), "multi" (multi-image editing), "face" (image 1:
    # a face followed through an IP-Adapter, image 2: an optional start image)
    reference_mode: ReferenceMode = "none"
    max_references: int = 0
    requires_references: bool = False
    text_to_image: bool = True
    params: list[ParamSpec] = field(default_factory=list)
    size_multiple: int = 16
    min_side: int = 256
    max_side: int = 2048
    default_megapixels: float = 1.0
    quantize_options: list[int] = field(default_factory=lambda: [3, 4, 5, 6, 8])
    default_quantize: int | None = 8
    # Download (Hugging Face)
    hf_repo: str | None = None
    # Files to download (fnmatch patterns relative to the repo root); None = whole repo.
    hf_patterns: list[str] | None = None
    # Every pattern must match at least one file for the model to count as installed.
    check_files: list[str] = field(default_factory=list)
    download_size_gb: float | None = None
    license: str = ""
    gated: bool = False
    # Memory
    weights_gb: float | None = None  # weights loaded at full precision
    largest_component_gb: float | None = None
    memory_hint: str = ""
    tags: list[str] = field(default_factory=list)
    # Weight precision shown in the UI ("Q4_K", "bf16"...); empty = inferred (see catalog.precision_of).
    precision: str = ""
    # Added by the user from Hugging Face (see engines/custom.py).
    custom: bool = False
    # "image" (image generation), "audio" (TTS, transcription), "video" or "llm" (chat).
    kind: Kind = "image"
    audio: AudioCaps | None = None
    video: VideoCaps | None = None
    llm: LlmCaps | None = None
    # Engine-specific options (pipeline class, argument names...).
    options: dict[str, Any] = field(default_factory=dict)
    # Models spread over several repos (e.g. GGUF + encoder + VAE); takes precedence over hf_repo.
    sources: list[HfSource] = field(default_factory=list)
    # Available quantizations. `sources`/`options` above describe the default variant.
    variants: list[Variant] = field(default_factory=list)
    default_variant: str = ""
    variant: str = ""  # variant actually selected (set by `with_variant`)

    def all_sources(self) -> list[HfSource]:
        if self.sources:
            return self.sources
        if self.hf_repo:
            return [HfSource(self.hf_repo, self.hf_patterns, self.check_files, self.download_size_gb)]
        return []

    def default_params(self) -> dict[str, Any]:
        return {p.key: p.default for p in self.params}

    def to_public(self) -> dict[str, Any]:
        d = asdict(self)
        d["variants"] = [{"key": v.key, "label": v.label, "size_gb": v.size_gb} for v in self.variants]
        d.pop("engine")
        d.pop("options")
        d.pop("hf_patterns")
        d.pop("check_files")
        d.pop("sources")
        return d


def with_variant(spec: ModelSpec, key: str | None) -> ModelSpec:
    """Spec to use for quantization `key` (falls back to the default if unknown)."""
    import copy

    if not spec.variants:
        return spec
    chosen = next((v for v in spec.variants if v.key == key), None) or \
        next((v for v in spec.variants if v.key == spec.default_variant), spec.variants[0])
    out = copy.copy(spec)
    out.variant = chosen.key
    out.sources = list(chosen.sources)
    out.options = {**spec.options, **chosen.options}
    out.download_size_gb = chosen.size_gb
    out.precision = chosen.label
    if chosen.weights_gb is not None:
        out.weights_gb = chosen.weights_gb
    if chosen.largest_component_gb is not None:
        out.largest_component_gb = chosen.largest_component_gb
    return out


def hf_hub_dir() -> Path:
    from huggingface_hub import constants

    return Path(constants.HF_HUB_CACHE)


def repo_cache_dir(repo: str) -> Path:
    return hf_hub_dir() / f"models--{repo.replace('/', '--')}"


def _matches(rel: str, patterns: list[str]) -> bool:
    from fnmatch import fnmatch

    return any(fnmatch(rel, p) for p in patterns)


def _scan_dir(root: Path, patterns: list[str] | None, check_files: list[str]) -> dict[str, Any]:
    """How much of `check_files`/`patterns` is present directly under `root` (no snapshot indirection)."""
    if not root.is_dir():
        return {"ok": 0, "size": 0}
    files = [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() or p.is_symlink()]
    if check_files:
        ok = sum(1 for pat in check_files if any(_matches(f, [pat]) for f in files))
    else:
        ok = 1 if any(f.endswith((".safetensors", ".gguf")) for f in files) else 0
    size = 0
    for p in root.rglob("*"):
        rel = p.relative_to(root).as_posix()
        if (patterns is None or _matches(rel, patterns)) and (p.is_file() or p.is_symlink()):
            try:
                size += p.stat().st_size
            except OSError:
                pass
    return {"ok": ok, "size": size}


def derived_dir(src: HfSource) -> Path:
    from ..config import DERIVED_DIR

    return DERIVED_DIR / src.local_dir


def _source_status(src: HfSource) -> dict[str, Any]:
    needed = len(src.check_files) or 1
    if src.kind == "derived":
        # A temp dir used while producing the checkpoint (atomic rename on success) never counts as installed.
        scan = _scan_dir(derived_dir(src), src.patterns, src.check_files)
        state = "installed" if scan["ok"] >= needed else "missing"
        return {"state": state, "size": scan["size"]}
    root = repo_cache_dir(src.repo)
    snapshots = root / "snapshots"
    best: tuple[int, Path] | None = None
    if snapshots.is_dir():
        for snap in snapshots.iterdir():
            if not snap.is_dir():
                continue
            scan = _scan_dir(snap, None, src.check_files)
            if best is None or scan["ok"] > best[0]:
                best = (scan["ok"], snap)
    size = 0
    if best:
        size = _scan_dir(best[1], src.patterns, [])["size"]
    incomplete = (root / "blobs").is_dir() and any((root / "blobs").glob("*.incomplete"))
    if best and best[0] >= needed:
        state = "installed"  # leftover .incomplete files (cancelled downloads) don't matter
    elif (best and best[0] > 0) or incomplete:
        state = "partial"
    else:
        state = "missing"
    return {"state": state, "size": size}


def remaining_download_gb(spec: ModelSpec) -> float:
    """Approximate size still to download for `spec`: the sources not yet installed in the cache (a file shared with
    another model, e.g. a text encoder, counts only when it is missing)."""
    return installation_status(spec)["need_gb"]


def installation_status(spec: ModelSpec) -> dict[str, Any]:
    """Install state of a model, read from the Hugging Face cache (shared with mflux and diffusers).

    state is "installed", "partial" (required files missing or download interrupted) or "missing".
    A multi-repo model is only "installed" when every repo is. `need_gb` is what is left to download: the sources not
    installed yet, less what a partial one already holds (a repo shared with another model counts only when missing).

    A bf16 source that a `kind="derived"` sibling was produced from counts as satisfied once that derived output is
    installed: the bf16 copy can then be freed (see `downloads.DownloadManager.free_bf16`) without the model
    falling back to "partial" — only the derived checkpoint is required from then on.
    """
    sources = spec.all_sources()
    if not sources:
        return {"state": "installed", "size_gb": 0.0, "need_gb": 0.0, "temp_gb": 0.0}
    parts = [_source_status(src) for src in sources]
    satisfied_repos = {src.repo for src, p in zip(sources, parts) if src.kind == "derived" and p["state"] == "installed"}
    effective = [{"state": "installed", "size": p["size"]} if src.kind == "hf" and src.repo in satisfied_repos else p
                 for src, p in zip(sources, parts)]
    need = sum(max(0.0, (src.size_gb or 0) - p["size"] / 1024**3)
               for src, p in zip(sources, effective) if p["state"] != "installed")
    # Part of `need` that is only a stepping stone (the bf16 source of a derived checkpoint, freeable afterwards).
    temp = sum(max(0.0, (src.size_gb or 0) - p["size"] / 1024**3)
               for src, p in zip(sources, effective) if p["state"] != "installed" and src.repo in {d.repo for d in sources if d.kind == "derived"} and src.kind == "hf")
    states = {p["state"] for p in effective}
    if states == {"installed"}:
        state = "installed"
    elif states == {"missing"}:
        state = "missing"
    else:
        state = "partial"
    return {"state": state, "size_gb": round(sum(p["size"] for p in parts) / 1024**3, 2), "need_gb": round(need, 2),
            "temp_gb": round(temp, 2)}


@dataclass
class GenerationRequest:
    prompt: str
    width: int
    height: int
    steps: int
    seed: int
    guidance: float | None = None
    negative_prompt: str | None = None
    references: list[str] = field(default_factory=list)
    strength: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class GenerationCancelled(Exception):
    pass


@dataclass
class Hooks:
    """Callbacks the worker hands to the engine during a generation."""

    on_step: Callable[[int, int], None]
    on_preview: Callable[[Image.Image], None]
    is_cancelled: Callable[[], bool]
    preview_every: int = 0  # 0 = no intermediate previews
    # Stage of a long generation ("prepare", "sampling", "decode", "encode"), for engines that know it.
    on_phase: Callable[[str], None] = lambda phase: None


class Engine:
    """Base class. Only ever runs in the worker process."""

    def __init__(self, spec: ModelSpec, quantize: int | None, options: dict[str, Any] | None = None):
        self.spec = spec
        self.quantize = quantize
        self.options = options or {}

    def load(self) -> None:
        raise NotImplementedError

    def generate(self, req: GenerationRequest, hooks: Hooks) -> Image.Image:
        """Return the final PIL image. Must raise GenerationCancelled when cancelled."""
        raise NotImplementedError

    def save(self, result: Any, path: Path) -> None:
        result.save(path)
