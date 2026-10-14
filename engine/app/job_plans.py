# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Job requests and the pure planning of a generation: parameters in, worker items out.

A `JobRequest` is everything the engine needs to run one generation: the model, the prompt, the free-form
parameters, the input files (absolute paths) and the folder to write to. Nothing here reads or writes the studio
database.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

from .engines import get_spec
from .engines.base import GenerationRequest, size_reference_index
from .engines.sdcpp_engine import effective_settings
from .media import VIDEO_EXTENSIONS, image_size, probe_video, resolve_size, video_frame_count, video_size

# Receives (job, event name, payload): `job.started`, `job.progress`, `job.preview`, `job.output`, `job.done`,
# `job.failed`, `job.cancelled`. The default sink publishes them on the event bus.
JobSink = Callable[["JobRequest", str, dict[str, Any]], None]


def new_seed() -> int:
    return random.randint(0, 2**31 - 1)


@dataclass
class JobRequest:
    job_id: str
    model_id: str
    prompt: str
    params: dict[str, Any]
    inputs: list[str] = field(default_factory=list)  # absolute paths: reference images, source clip, ...
    output_dir: str = ""
    # Voices of the caller's library by id (`{"path", "transcript", "name"}`); the engine has no library of its own.
    voices: dict[str, dict[str, Any]] | None = None
    sink: JobSink | None = None  # None: publish on the event bus

    # Runtime state, owned by the JobManager.
    state: str = "queued"  # queued | loading | running | done | failed | cancelled
    error: str | None = None
    outputs: list[dict[str, Any]] = field(default_factory=list)
    progress: dict[str, Any] = field(default_factory=dict)


def is_video_path(path: str | Path) -> bool:
    return str(path).lower().endswith(VIDEO_EXTENSIONS)


def build_plan(job: JobRequest) -> dict[str, Any]:
    """Validated and resolved parameters plus the items to hand to the worker; ValueError carries the user message."""
    try:
        spec = get_spec(job.model_id)
    except KeyError as exc:
        raise ValueError(str(exc)) from None
    if spec.kind == "audio":
        return _audio_plan(job, spec)
    if spec.kind == "video":
        return _video_plan(job, spec)
    return _image_plan(job, spec)


def _output(job: JobRequest, index: int, ext: str) -> str:
    return str(Path(job.output_dir) / f"{job.job_id}_{index}.{ext}")


def _existing(job: JobRequest) -> list[Path]:
    return [p for p in (Path(i) for i in job.inputs) if p.is_file()]


def _image_plan(job: JobRequest, spec) -> dict[str, Any]:
    params = dict(job.params)
    ref_paths = [p for p in _existing(job) if not is_video_path(p)]
    if spec.reference_mode == "none":
        ref_paths = []
    else:
        ref_paths = ref_paths[: spec.max_references]
    if spec.requires_references and not ref_paths:
        raise ValueError(f"{spec.name} a besoin d'au moins une image de référence.")
    if not job.prompt.strip():
        raise ValueError("Le prompt est vide.")

    defaults = spec.default_params()
    width, height = resolve_size(
        params,
        multiple=spec.size_multiple,
        min_side=spec.min_side,
        max_side=spec.max_side,
        default_megapixels=spec.default_megapixels,
        reference=ref_paths[size_reference_index(spec.reference_mode, len(ref_paths))] if ref_paths else None,
    )
    steps = int(params.get("steps") or defaults.get("steps") or 30)
    guidance = params.get("guidance", defaults.get("guidance"))
    steps, guidance = effective_settings(spec, steps, guidance, editing=bool(ref_paths) and spec.reference_mode == "multi")
    strength = params.get("strength", defaults.get("strength")) if ref_paths else None
    negative = params.get("negative_prompt") or None
    seeds = params.get("seeds") or [new_seed()]

    params.update(width=width, height=height, steps=steps, seeds=seeds)
    if guidance is not None:
        params["guidance"] = float(guidance)
    if strength is not None:
        params["strength"] = float(strength)
    else:
        params.pop("strength", None)
    params["references_used"] = len(ref_paths)
    # Model-specific parameters (LoRA strength, pixel post-processing...) reach the engine as they are.
    extra = {k: params.get(k, v) for k, v in defaults.items() if k not in _COMMON_IMAGE_PARAMS}

    items = []
    for i, seed in enumerate(seeds):
        req = GenerationRequest(
            prompt=job.prompt,
            width=width,
            height=height,
            steps=steps,
            seed=int(seed),
            guidance=float(guidance) if guidance is not None else None,
            negative_prompt=negative,
            references=[str(p) for p in ref_paths],
            strength=float(strength) if strength is not None else None,
            extra=extra,
        )
        items.append({"request": asdict(req), "output": _output(job, i, "png")})
    return {"kind": "image", "model_id": spec.id, "params": params, "items": items, "prompt": job.prompt}


_COMMON_IMAGE_PARAMS = {"steps", "guidance", "strength", "negative_prompt"}


def _audio_plan(job: JobRequest, spec) -> dict[str, Any]:
    from .dialogue import parse_dialogue
    from .voices import resolve_voice

    params = dict(job.params)
    caps = spec.audio
    text = job.prompt.strip()
    if not text:
        raise ValueError("Le texte est vide.")
    if caps.task != "tts":
        raise ValueError(f"{spec.name} ne synthétise pas de voix.")
    codes = [l.code for l in caps.languages]
    language = params.get("language") or (codes[0] if codes else "en")
    if codes and language not in codes:
        language = codes[0]
    instruct = (params.get("instruct") or "").strip()
    default_voice = resolve_voice(spec, params.get("voice"), language, instruct, job.voices)

    cast = params.get("cast") or {}
    if cast:
        segments = parse_dialogue(
            text, {n: resolve_voice(spec, v, language, instruct, job.voices) for n, v in cast.items()}, default_voice
        )
    else:
        segments = [{"text": text, "voice": default_voice}]
    if not any(s["text"].strip() for s in segments):
        raise ValueError("Le texte est vide.")

    defaults = spec.default_params()
    speed = float(params.get("speed", defaults.get("speed", 1.0)) or 1.0)
    extra = {k: params[k] for k in defaults if k not in ("speed",) and k in params}
    seeds = params.get("seeds") or [new_seed()]
    params.update(language=language, seeds=seeds, steps=1, speed=speed)
    items = []
    for i, seed in enumerate(seeds):
        items.append({
            "segments": segments, "language": language, "instruct": instruct or None, "speed": speed,
            "seed": int(seed), "params": extra, "output": _output(job, i, "wav"),
        })
    voice_label = segments[0]["voice"].get("label") or segments[0]["voice"].get("id") or ""
    return {
        "kind": "audio", "model_id": spec.id, "params": params, "items": items, "prompt": job.prompt,
        "voice_label": voice_label, "speakers": [s.get("label") for s in segments if s.get("label")],
    }


def _video_plan(job: JobRequest, spec) -> dict[str, Any]:
    params = dict(job.params)
    caps = spec.video
    if not job.prompt.strip():
        raise ValueError("Le prompt est vide.")
    existing = _existing(job)
    images = [p for p in existing if not is_video_path(p)]
    videos = [p for p in existing if is_video_path(p)]

    # Decide the task from what is attached: a source video edits, a start image animates, else text only.
    if videos and caps.video_input != "none":
        # A reference image rides along with the edit when the model takes one (Kiwi-Edit, Bernini).
        task, images = "v2v", (images[:1] if caps.image_input != "none" else [])
    elif images and caps.image_input != "none":
        task = "i2v"
        images = images[: 2 if caps.last_frame else 1]
    else:
        task, images = "t2v", []
    if task != "v2v":
        videos = []
    if caps.image_input == "required" and task != "i2v":
        raise ValueError(f"{spec.name} a besoin d'une image de départ.")
    if caps.video_input == "required" and task != "v2v":
        raise ValueError(f"{spec.name} a besoin d'une vidéo source.")

    res = next((r for r in caps.resolutions if r.id == params.get("resolution")),
               next((r for r in caps.resolutions if r.id == caps.default_resolution), caps.resolutions[0]))
    aspect = str(params.get("aspect") or "16:9")
    ratio = None
    if aspect not in ("16:9", "9:16", "1:1", "4:3", "3:4"):
        # "auto" (or anything unknown): follow the start image / source video.
        ref = images[0] if images else None
        if ref is not None:
            w0, h0 = image_size(ref)
            ratio = w0 / h0
        elif videos:
            info = probe_video(videos[0])
            ratio = info["width"] / info["height"]
        aspect = "16:9"
    width, height = video_size(aspect, res.short_side, res.long_side, spec.size_multiple, ratio)

    defaults = spec.default_params()
    seconds = float(params.get("seconds") or caps.default_seconds)
    frames = video_frame_count(seconds, caps.fps, caps.frame_step, caps.min_seconds, caps.max_seconds)
    steps = int(params.get("steps") or defaults.get("steps") or 30)
    guidance = params.get("guidance", defaults.get("guidance"))
    strength = params.get("strength", defaults.get("strength")) if task == "v2v" else None
    negative = params.get("negative_prompt") or None
    seeds = (params.get("seeds") or [new_seed()])[:2]

    params.update(width=width, height=height, steps=steps, seeds=seeds, frames=frames, fps=caps.fps,
                  seconds=round(frames / caps.fps, 2), resolution=res.id, aspect=aspect, task=task)
    if guidance is not None:
        params["guidance"] = float(guidance)
    if strength is not None:
        params["strength"] = float(strength)
    else:
        params.pop("strength", None)
    params["references_used"] = len(images) + len(videos)

    items = []
    for i, seed in enumerate(seeds):
        req = GenerationRequest(
            prompt=job.prompt, width=width, height=height, steps=steps, seed=int(seed),
            guidance=float(guidance) if guidance is not None else None, negative_prompt=negative,
            references=[str(p) for p in images], strength=float(strength) if strength is not None else None,
            extra={"task": task, "frames": frames, "fps": caps.fps, "video": str(videos[0]) if videos else None,
                   **{p.key: bool(params.get(p.key, p.default)) for p in spec.params if p.type == "bool"}},
        )
        items.append({"request": asdict(req), "output": _output(job, i, "mp4")})
    return {"kind": "video", "model_id": spec.id, "params": params, "items": items, "prompt": job.prompt}
