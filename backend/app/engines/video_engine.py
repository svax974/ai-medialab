# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video generation and editing with diffusers (CUDA, ROCm, MPS), driven by `ModelSpec.options`:

    pipeline          diffusers class of the repo (text → video, or image → video for I2V-only repos)
    i2v_pipeline      class used when a start image is given, built with from_pipe (None = not supported)
    v2v_pipeline      class used when a source video is given (video editing)
    family            "wan" | "cog" | "ltx2" | "hunyuan": the few behaviours that differ between pipelines
    gguf              {"transformer": (repo, file), "transformer_2": ...}: 4-bit transformers loaded from GGUF files
                      (the rest of the pipeline comes from the first source, the diffusers repo)
    transformer_class diffusers class used to load those GGUF files
    text_encoder_repo Gemma text encoder loaded from another repo (LTX: bf16 copy instead of the fp32 one)
    guidance_2        second guidance scale (Wan 2.2 A14B low-noise expert)
    guider            guidance lives in `pipe.guider` instead of a call argument (HunyuanVideo 1.5)
    distilled         fixed sigma schedule of the distilled LTX model
    dtype             compute dtype override ("float16" for CogVideoX 2B)

Per-request data comes in `GenerationRequest.extra`: task ("t2v" | "i2v" | "v2v"), frames, fps and the source
video path. The result is a `VideoResult`; `save` encodes it as an MP4.
"""

from __future__ import annotations

import gc
import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .base import Engine, GenerationCancelled, GenerationRequest, Hooks
from .diffusers_engine import _pick_device, _pick_dtype, empty_cache, place_pipeline


@dataclass
class VideoResult:
    frames: np.ndarray  # uint8 [F, H, W, 3]
    fps: int
    audio: np.ndarray | None = None  # float32 [channels, samples]
    sample_rate: int | None = None


def to_uint8(video: Any) -> np.ndarray:
    """Pipeline output (list of PIL images, or float array in [0, 1]) -> uint8 [F, H, W, 3]."""
    if isinstance(video, np.ndarray):
        if video.dtype == np.uint8:
            return video
        return (np.clip(video, 0.0, 1.0) * 255).round().astype(np.uint8)
    return np.stack([np.asarray(f.convert("RGB")) for f in video])


def _patch_ltx2_converter() -> None:
    """The LTX-2.3 GGUF checkpoints name the prompt AdaLN `*_adaln_single`; diffusers 0.41's converter keeps that name
    but the model expects `*_adaln`. Wrap the converter so these 12 tensors land in the right place."""
    from diffusers.loaders import single_file_model as sfm

    entry = sfm.SINGLE_FILE_LOADABLE_CLASSES["LTX2VideoTransformer3DModel"]
    if getattr(entry["checkpoint_mapping_fn"], "_patched", False):
        return
    original = entry["checkpoint_mapping_fn"]

    def convert(checkpoint, **kwargs):
        out = original(checkpoint, **kwargs)
        return {k.replace("prompt_adaln_single.", "prompt_adaln."): v for k, v in out.items()}

    convert._patched = True  # type: ignore[attr-defined]
    entry["checkpoint_mapping_fn"] = convert


class VideoDiffusersEngine(Engine):
    def load(self) -> None:
        import diffusers
        import torch

        from ..system import get_system, memory_plan

        self.device = _pick_device(torch)
        if self.device == "cpu":
            raise RuntimeError("Aucun GPU exploitable par PyTorch (CUDA, ROCm ou Metal) : la génération de vidéo sur "
                               "processeur est impraticable.")
        o = self.spec.options
        self.dtype = getattr(torch, o["dtype"]) if o.get("dtype") else _pick_dtype(torch, self.device)
        plan = memory_plan(self.spec.weights_gb, self.spec.largest_component_gb, get_system(), "torch")
        if not plan["fits"]:
            raise RuntimeError(f"Ce modèle ne tient pas sur cette machine. {plan['note']}")
        self.strategy = plan["strategy"]
        if o.get("gguf") and self.strategy == "sequential":
            self.strategy = "model_offload"  # layer-by-layer offload does not mix with quantized weights

        root = self._local_root()
        kwargs: dict[str, Any] = {}
        if o.get("gguf"):
            kwargs.update(self._load_gguf(root))
        if o.get("family") == "wan":
            # Wan's VAE is meant to run in fp32 (the weights are fp32 on disk anyway).
            kwargs["vae"] = diffusers.AutoencoderKLWan.from_pretrained(root, subfolder="vae", torch_dtype=torch.float32)
        if o.get("text_encoder_repo"):
            kwargs["text_encoder"] = self._load_gemma(o["text_encoder_repo"])
        cls = getattr(diffusers, o["pipeline"])
        pipe = cls.from_pretrained(root, torch_dtype=self.dtype, **kwargs)
        place_pipeline(pipe, self.strategy, self.device)
        if hasattr(pipe, "set_progress_bar_config"):
            pipe.set_progress_bar_config(disable=True)
        self.pipe = pipe
        self.derived: dict[str, Any] = {}
        vae = getattr(pipe, "vae", None)
        for name in ("enable_tiling", "enable_slicing"):  # keeps the VAE decode from spiking memory
            if vae is not None and hasattr(vae, name):
                try:
                    getattr(vae, name)()
                except Exception:  # noqa: BLE001
                    pass

    def _local_root(self) -> str:
        from huggingface_hub import snapshot_download

        src = self.spec.all_sources()[0]
        return snapshot_download(src.repo, allow_patterns=src.patterns, local_files_only=True)

    def _load_gguf(self, root: str) -> dict[str, Any]:
        import diffusers
        from diffusers import GGUFQuantizationConfig
        from huggingface_hub import hf_hub_download

        o = self.spec.options
        cls = getattr(diffusers, o["transformer_class"])
        if o["transformer_class"].startswith("LTX2"):
            _patch_ltx2_converter()
        out = {}
        for name, (repo, filename) in o["gguf"].items():
            path = hf_hub_download(repo, filename, local_files_only=True)
            out[name] = cls.from_single_file(
                path, quantization_config=GGUFQuantizationConfig(compute_dtype=self.dtype), torch_dtype=self.dtype,
                config=root, subfolder=name,
            )
        return out

    def _load_gemma(self, repo: str):
        from huggingface_hub import snapshot_download
        from transformers import Gemma3ForConditionalGeneration

        path = snapshot_download(repo, allow_patterns=["config.json", "generation_config.json", "model*.safetensors*"],
                                 local_files_only=True)
        return Gemma3ForConditionalGeneration.from_pretrained(path, torch_dtype=self.dtype)

    def _pipe_for(self, task: str):
        """Pipeline for a task: the repo's own, or a sibling sharing its components (from_pipe)."""
        import diffusers

        o = self.spec.options
        key = {"i2v": "i2v_pipeline", "v2v": "v2v_pipeline"}.get(task)
        name = o.get(key) if key else None
        if not name or name == o["pipeline"]:
            return self.pipe
        if name not in self.derived:
            derived = getattr(diffusers, name).from_pipe(self.pipe)
            if hasattr(derived, "set_progress_bar_config"):
                derived.set_progress_bar_config(disable=True)
            self.derived[name] = derived
        return self.derived[name]

    def generate(self, req: GenerationRequest, hooks: Hooks) -> VideoResult:
        import torch
        from PIL import Image, ImageOps

        from ..media import fit_image, read_frames

        o = self.spec.options
        extra = req.extra
        task = extra.get("task", "t2v")
        fps = int(extra.get("fps") or self.spec.video.fps)
        pipe = self._pipe_for(task)
        accepted = set(inspect.signature(pipe.__call__).parameters)

        kwargs: dict[str, Any] = dict(
            prompt=req.prompt, height=req.height, width=req.width, num_frames=int(extra["frames"]),
            num_inference_steps=req.steps, output_type="np",
            generator=torch.Generator(device="cpu").manual_seed(req.seed),  # same seed, same result on every machine
        )
        negative = (req.negative_prompt or "").strip()
        if negative:
            kwargs["negative_prompt"] = negative

        images = [fit_image(ImageOps.exif_transpose(Image.open(p)).convert("RGB"), req.width, req.height)
                  for p in req.references]
        if task == "i2v" and images:
            kwargs["image"] = images[0]
            if len(images) > 1 and "last_image" in accepted:
                kwargs["last_image"] = images[1]
        elif task == "v2v":
            kwargs.pop("num_frames")
            kwargs["video"] = read_frames(Path(extra["video"]), int(extra["frames"]), (req.width, req.height))
            if req.strength is not None:
                kwargs["strength"] = req.strength
        if req.guidance is not None:
            if o.get("guider"):
                pipe.guider.guidance_scale = req.guidance
            else:
                kwargs["guidance_scale"] = req.guidance
        if o.get("guidance_2") is not None:
            kwargs["guidance_scale_2"] = float(extra.get("guidance_2") or o["guidance_2"])
        if o.get("family") == "ltx2":
            kwargs.update(frame_rate=float(fps), return_dict=False)
            if o.get("distilled"):
                from diffusers.pipelines.ltx2.utils import DISTILLED_SIGMA_VALUES

                # The distilled model runs a fixed 8-step schedule without guidance.
                kwargs.update(sigmas=DISTILLED_SIGMA_VALUES, num_inference_steps=len(DISTILLED_SIGMA_VALUES),
                              guidance_scale=1.0, stg_scale=0.0, modality_scale=1.0,
                              audio_guidance_scale=1.0, audio_stg_scale=0.0, audio_modality_scale=1.0)
                kwargs.pop("negative_prompt", None)
        total = int(kwargs["num_inference_steps"])
        if "kwargs" not in accepted:
            dropped = [k for k in kwargs if k not in accepted]
            kwargs = {k: v for k, v in kwargs.items() if k in accepted}
            if dropped:
                print(f"[video] arguments ignored by {type(pipe).__name__}: {dropped}", flush=True)

        count = {"n": 0}

        def tick() -> None:
            count["n"] += 1
            hooks.on_step(min(count["n"], total), total)
            if hooks.is_cancelled():
                raise GenerationCancelled()

        restore = None
        if "callback_on_step_end" in accepted:
            def on_step(_pipe, _step, _timestep, cb_kwargs):
                tick()
                return cb_kwargs

            kwargs["callback_on_step_end"] = on_step
        else:
            # HunyuanVideo 1.5 has no step callback: count scheduler steps instead.
            scheduler = pipe.scheduler
            original = scheduler.step

            def step(*a, **k):
                out = original(*a, **k)
                tick()
                return out

            scheduler.step = step
            restore = lambda: setattr(scheduler, "step", original)  # noqa: E731

        try:
            with torch.inference_mode():
                result = pipe(**kwargs)
        finally:
            if restore:
                restore()
            gc.collect()
            empty_cache(self.device)

        audio = rate = None
        if o.get("family") == "ltx2":
            video, sound = result
            frames = to_uint8(video[0])
            audio = sound[0].float().cpu().numpy()
            rate = int(self.pipe.vocoder.config.output_sampling_rate)
        else:
            frames = to_uint8(result.frames[0])
        return VideoResult(frames, fps, audio, rate)

    def save(self, result: VideoResult, path: Path) -> dict[str, Any]:
        from ..media import encode_mp4

        encode_mp4(result.frames, result.fps, path, result.audio, result.sample_rate)
        frames, height, width = result.frames.shape[0], result.frames.shape[1], result.frames.shape[2]
        return {"width": width, "height": height, "fps": result.fps, "frames": frames,
                "has_audio": result.audio is not None, "duration": round(frames / result.fps, 3)}
