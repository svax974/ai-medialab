# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""PyTorch + diffusers engine: NVIDIA (CUDA), AMD (ROCm) and Apple (MPS).

One generic engine driven by `ModelSpec.options`:

    pipeline        diffusers pipeline class (e.g. "QwenImage21Pipeline")
    img2img         class used when a start image is given ("init" references), built with from_pipe
    guidance_arg    name of the pipeline's guidance argument ("true_cfg_scale", "guidance_scale"...)
    image_arg       argument that receives the reference images (default "image")
    image_is_list   pass references as a list (multi-image editing) or a single image
    load_kwargs     from_pretrained arguments (e.g. variant="fp16")
    call_kwargs     fixed arguments added to every call (e.g. max_sequence_length)
    scheduler       {"class", "config"}: replaces the repo's scheduler (e.g. DPM++ 2M Karras for a fine-tune whose repo
                    ships DDPM)
    loras           [{"repo", "file", "trigger"}]: LoRA files loaded on top of the pipeline (needs `peft`); their
                    strength is the `lora_scale` parameter and their trigger words are put in front of the prompt
    ip_adapter      {"repo", "subfolder", "file", "encoder"}: IP-Adapter that follows the face of the first image ("face"
                    reference mode; strength: `face_scale` parameter)
    pixelate        factor of the "Pixels nets" post-processing (`pixel_perfect` parameter): shrink then enlarge
                    without smoothing, so the image sits on a real pixel grid

Per-request parameters that are not common arguments (`lora_scale`, `face_scale`, `pixel_perfect`) come in `GenerationRequest.extra`.

Arguments the pipeline doesn't accept are dropped (filtered by signature), so most models need no
new code.
"""

from __future__ import annotations

import gc
import inspect
from typing import Any

from PIL import Image, ImageOps

from .base import Engine, GenerationCancelled, GenerationRequest, Hooks


class DiffusersEngine(Engine):
    def load(self) -> None:
        import torch
        import diffusers

        from ..system import get_system, memory_plan

        system = get_system()
        self.device = _pick_device(torch)
        if self.device == "cpu":
            raise RuntimeError(
                "Aucun GPU exploitable par PyTorch (CUDA, ROCm ou Metal) : la génération sur CPU est "
                "impraticable pour ce modèle."
            )
        self.dtype = _pick_dtype(torch, self.device)
        o = self.spec.options
        cls = getattr(diffusers, o["pipeline"])
        load_kwargs = dict(o.get("load_kwargs", {}))
        plan = memory_plan(self.spec.weights_gb, self.spec.largest_component_gb, system, "torch")
        if not plan["fits"]:
            raise RuntimeError(f"Ce modèle ne tient pas sur cette machine. {plan['note']}")
        self.strategy = plan["strategy"]

        pipe = cls.from_pretrained(self.spec.hf_repo, torch_dtype=self.dtype, **load_kwargs)
        if o.get("scheduler"):
            sched = getattr(diffusers, o["scheduler"]["class"])
            pipe.scheduler = sched.from_config(pipe.scheduler.config, **o["scheduler"].get("config", {}))
        self.loras = _load_loras(pipe, o.get("loras", []))
        if o.get("ip_adapter"):
            ip = o["ip_adapter"]
            pipe.load_ip_adapter(ip["repo"], subfolder=ip["subfolder"], weight_name=ip["file"],
                                 image_encoder_folder=ip["encoder"], local_files_only=True)
        place_pipeline(pipe, self.strategy, self.device)
        if hasattr(pipe, "set_progress_bar_config"):
            pipe.set_progress_bar_config(disable=True)
        self.pipe = pipe
        self.i2i = None  # img2img pipeline, created on demand
        self._tune_memory()

    def _tune_memory(self) -> None:
        # Tiled VAE decoding avoids the memory spike on large images.
        vae = getattr(self.pipe, "vae", None)
        if vae is not None and hasattr(vae, "enable_tiling"):
            try:
                vae.enable_tiling()
            except Exception:
                pass

    def generate(self, req: GenerationRequest, hooks: Hooks) -> Image.Image:
        import torch

        o = self.spec.options
        pipe = self.pipe
        refs = [_load(p) for p in req.references][: max(self.spec.max_references, 0)]
        start, face, images = reference_roles(self.spec.reference_mode, refs)
        if start is not None:
            pipe = self._img2img_pipe()

        # Keep the generator on CPU so the same seed gives the same result on every machine.
        generator = torch.Generator(device="cpu").manual_seed(req.seed)
        total = req.steps

        def on_step(_pipe, step, _timestep, cb_kwargs):
            hooks.on_step(step + 1, total)
            if hooks.is_cancelled():
                raise GenerationCancelled()
            return cb_kwargs

        if self.loras:
            self.pipe.set_adapters(self.loras, [float(req.extra.get("lora_scale", 1.0))] * len(self.loras))
        if o.get("ip_adapter"):
            self.pipe.set_ip_adapter_scale(float(req.extra.get("face_scale", 0.6)) if face is not None else 0.0)

        kwargs: dict[str, Any] = dict(
            prompt=with_triggers(req.prompt, [lora.get("trigger", "") for lora in o.get("loras", [])]),
            width=req.width,
            height=req.height,
            num_inference_steps=req.steps,
            generator=generator,
            callback_on_step_end=on_step,
            output_type="pil",
        )
        kwargs.update(o.get("call_kwargs", {}))
        guidance_arg = o.get("guidance_arg")
        if guidance_arg and req.guidance is not None:
            kwargs[guidance_arg] = req.guidance
        negative = (req.negative_prompt or "").strip()
        if negative:
            kwargs["negative_prompt"] = negative
        image_arg = o.get("image_arg", "image")
        if start is not None:
            # img2img draws at the size of its start image: bring it to the size asked for (same ratio when the format
            # follows that image, a centred crop otherwise), so a tiny or huge image gives a usable result.
            kwargs[image_arg] = ImageOps.fit(start, (req.width, req.height), Image.Resampling.LANCZOS)
            if req.strength is not None:
                kwargs["strength"] = req.strength
        elif images:
            kwargs[image_arg] = images if o.get("image_is_list", True) else images[0]
        if o.get("ip_adapter"):
            # Without a face the adapter is muted (scale 0) but the pipeline still expects an image.
            kwargs["ip_adapter_image"] = face if face is not None else Image.new("RGB", (224, 224))

        accepted = set(inspect.signature(pipe.__call__).parameters)
        if "kwargs" not in accepted:
            dropped = [k for k in kwargs if k not in accepted]
            kwargs = {k: v for k, v in kwargs.items() if k in accepted}
            if dropped:
                print(f"[diffusers] arguments ignored by {type(pipe).__name__}: {dropped}", flush=True)

        try:
            with torch.inference_mode():
                result = pipe(**kwargs)
        finally:
            gc.collect()
            self._empty_cache()
        image = result.images[0]
        if o.get("pixelate") and req.extra.get("pixel_perfect", True):
            image = pixelate(image, int(o["pixelate"]))
        return image

    def _img2img_pipe(self):
        if self.i2i is None:
            import diffusers

            cls = getattr(diffusers, self.spec.options["img2img"])
            self.i2i = cls.from_pipe(self.pipe)
            if hasattr(self.i2i, "set_progress_bar_config"):
                self.i2i.set_progress_bar_config(disable=True)
        return self.i2i

    def _empty_cache(self) -> None:
        empty_cache(self.device)


def _load_loras(pipe, loras: list[dict[str, Any]]) -> list[str]:
    """Load the LoRA files (already in the Hugging Face cache) as named adapters; returns their names."""
    if not loras:
        return []
    try:
        import peft  # noqa: F401  (diffusers loads LoRAs through it)
    except ImportError:
        raise RuntimeError("Le moteur PyTorch n'a pas la bibliothèque « peft » nécessaire aux LoRA : mettez l'application "
                           "à jour.") from None
    names = []
    for i, lora in enumerate(loras):
        name = f"lora{i}"
        pipe.load_lora_weights(lora["repo"], weight_name=lora["file"], adapter_name=name, local_files_only=True)
        names.append(name)
    return names


def reference_roles(mode: str, refs: list[Any]) -> tuple[Any, Any, list[Any]]:
    """(start image, face, images to edit) of the attached images for a reference mode: "init" starts from the first,
    "face" follows the face of the first and starts from the second when given, "multi" edits them all."""
    if mode == "init" and refs:
        return refs[0], None, []
    if mode == "face" and refs:
        return (refs[1] if len(refs) > 1 else None), refs[0], []
    if mode == "multi":
        return None, None, refs
    return None, None, []


def with_triggers(prompt: str, triggers: list[str]) -> str:
    """The prompt with the LoRA trigger words in front, unless the user already wrote them."""
    missing = [t for t in triggers if t and t.lower() not in prompt.lower()]
    return ", ".join([*missing, prompt]) if missing else prompt


def pixelate(image: Image.Image, factor: int) -> Image.Image:
    """Shrink by `factor` then enlarge back without smoothing (nearest neighbour): every block of factor × factor
    pixels gets one colour, as in real pixel art (method advised by the Pixel Art XL authors)."""
    w, h = image.size
    small = image.resize((max(1, w // factor), max(1, h // factor)), Image.Resampling.NEAREST)
    return small.resize((small.width * factor, small.height * factor), Image.Resampling.NEAREST)


def place_pipeline(pipe, strategy: str, device: str) -> None:
    """Apply a memory plan (see system.memory_plan) to a loaded pipeline."""
    if strategy == "full":
        pipe.to(device)
    elif strategy == "model_offload":
        pipe.enable_model_cpu_offload()
    else:
        pipe.enable_sequential_cpu_offload()


def empty_cache(device: str) -> None:
    import torch

    if device == "cuda":
        torch.cuda.empty_cache()
    elif device == "mps":
        torch.mps.empty_cache()


def _load(path: str) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def _pick_device(torch) -> str:
    if torch.cuda.is_available():  # also true for ROCm builds (torch.version.hip)
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _pick_dtype(torch, device: str):
    if device == "cuda":
        # bf16 on Ampere+ / RDNA3+, fp16 on older cards.
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    return torch.bfloat16
