# Copyright (c) 2026 Stéphane Vaxelaire
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

ReferenceMode = Literal["none", "init", "multi"]


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


Backend = Literal["mlx", "torch", "sdcpp", "pack", "demo"]
Kind = Literal["image", "audio", "video"]


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
class HfSource:
    """A Hugging Face repo (or part of one) a model depends on."""

    repo: str
    patterns: list[str] | None = None  # files to download (fnmatch); None = whole repo
    check_files: list[str] = field(default_factory=list)  # patterns that must match for the source to count as installed
    size_gb: float | None = None  # approximate size, for overall progress


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
    # Inference backend: "mlx" (native Metal, Mac), "torch" (CUDA / ROCm / MPS), "sdcpp", "pack", "demo".
    backend: Backend = "mlx"
    # References: "none" (text only), "init" (one start image, img2img), "multi" (multi-image editing)
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
    # "image" (image generation), "audio" (TTS, transcription) or "video".
    kind: Kind = "image"
    audio: AudioCaps | None = None
    video: VideoCaps | None = None
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


def _source_status(src: HfSource) -> dict[str, Any]:
    root = repo_cache_dir(src.repo)
    snapshots = root / "snapshots"
    best: tuple[int, Path] | None = None
    if snapshots.is_dir():
        for snap in snapshots.iterdir():
            if not snap.is_dir():
                continue
            files = [p.relative_to(snap).as_posix() for p in snap.rglob("*") if p.is_file() or p.is_symlink()]
            if src.check_files:
                ok = sum(1 for pat in src.check_files if any(_matches(f, [pat]) for f in files))
            else:
                ok = 1 if any(f.endswith((".safetensors", ".gguf")) for f in files) else 0
            if best is None or ok > best[0]:
                best = (ok, snap)
    needed = len(src.check_files) or 1
    size = 0
    if best:
        snap = best[1]
        for p in snap.rglob("*"):
            rel = p.relative_to(snap).as_posix()
            if (src.patterns is None or _matches(rel, src.patterns)) and (p.is_file() or p.is_symlink()):
                try:
                    size += p.stat().st_size
                except OSError:
                    pass
    incomplete = (root / "blobs").is_dir() and any((root / "blobs").glob("*.incomplete"))
    if best and best[0] >= needed:
        state = "installed"  # leftover .incomplete files (cancelled downloads) don't matter
    elif (best and best[0] > 0) or incomplete:
        state = "partial"
    else:
        state = "missing"
    return {"state": state, "size": size}


def installation_status(spec: ModelSpec) -> dict[str, Any]:
    """Install state of a model, read from the Hugging Face cache (shared with mflux and diffusers).

    state is "installed", "partial" (required files missing or download interrupted) or "missing".
    A multi-repo model is only "installed" when every repo is.
    """
    sources = spec.all_sources()
    if not sources:
        return {"state": "installed", "size_gb": 0.0}
    parts = [_source_status(src) for src in sources]
    states = {p["state"] for p in parts}
    if states == {"installed"}:
        state = "installed"
    elif states == {"missing"}:
        state = "missing"
    else:
        state = "partial"
    return {"state": state, "size_gb": round(sum(p["size"] for p in parts) / 1024**3, 2)}


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
