# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Shared pieces for the mflux-based engines (MLX, Apple Silicon)."""

from __future__ import annotations

import gc
from pathlib import Path
from typing import Any, Callable

from .base import Engine, GenerationCancelled, Hooks

PROMPT_CACHE_MAX = 64


class ProgressDispatcher:
    """mflux callback, registered once at load time. Forwards progress of the current generation to
    the worker hooks and handles cancellation and previews.

    mflux calls `before_loop` right after the prompt is encoded, which is when the text encoder
    is no longer needed and can be freed (low-memory mode)."""

    def __init__(self, preview_fn: Callable[[Any, Any], Any] | None):
        self.hooks: Hooks | None = None
        self.preview_fn = preview_fn
        self.after_encoding: Callable[[], None] | None = None
        self.step = 0

    def start(self, hooks: Hooks, after_encoding: Callable[[], None] | None) -> None:
        self.hooks = hooks
        self.after_encoding = after_encoding
        self.step = 0

    def stop(self) -> None:
        self.hooks = None
        self.after_encoding = None

    def call_before_loop(self, seed, prompt, latents, config, **_: Any) -> None:
        if self.after_encoding:
            self.after_encoding()

    def call_in_loop(self, t, seed, prompt, latents, config, time_steps) -> None:
        hooks = self.hooks
        if hooks is None:
            return
        self.step += 1
        total = getattr(time_steps, "total", None) or config.num_inference_steps
        hooks.on_step(self.step, total)
        if hooks.is_cancelled():
            raise GenerationCancelled()
        every = hooks.preview_every
        if self.preview_fn and every > 0 and self.step % every == 0 and self.step < total:
            try:
                image = self.preview_fn(latents, config)
                if image is not None:
                    hooks.on_preview(image)
            except Exception as exc:  # a failed preview must never fail the generation
                print(f"[preview] failed: {exc}", flush=True)


class MfluxEngine(Engine):
    """Base for mflux engines.

    Subclasses provide `build_model()`, `run()` and optionally `latent_creator` (for previews).

    Low-memory mode (`low_memory` option, on by default) works like the mflux CLI: text encoders are
    freed as soon as the prompt is encoded. They are reloaded on the next generation if the prompt
    isn't cached, on their own (`reload_encoders`) when the subclass supports it, otherwise by
    rebuilding the whole model.
    """

    latent_creator: Any = None
    encoder_attrs: tuple[str, ...] = ("text_encoder",)
    # Components kept in memory between generations.
    resident_attrs: tuple[str, ...] = ("transformer", "vae")

    @property
    def low_memory(self) -> bool:
        return bool(self.options.get("low_memory", True))

    def build_model(self):
        raise NotImplementedError

    def run(self, req, hooks):
        raise NotImplementedError

    def needs_encoders(self, req) -> bool:
        """False when the needed embeddings are already cached (encoders not needed)."""
        return True

    def reload_encoders(self) -> bool:
        """Reload only the encoders. Returns False if unsupported."""
        return False

    def load(self) -> None:
        self.model = self.build_model()
        self._materialize()
        if self.low_memory:
            self._enable_vae_tiling()
        self.encoders_loaded = all(getattr(self.model, a, None) is not None for a in self.encoder_attrs)
        if not self.encoders_loaded and not self.low_memory:
            self._restore_encoders()  # enough memory: keep the encoder resident
        self.dispatcher = ProgressDispatcher(self._preview if self.latent_creator else None)
        self.model.callbacks.register(self.dispatcher)

    def _enable_vae_tiling(self) -> None:
        """Tiled VAE decoding. Without it, even a 512x512 preview decode needed about 17 GB of
        transient memory, enough to make a 36 GB machine swap."""
        from mflux.models.common.vae.tiling_config import TilingConfig

        if getattr(self.model, "tiling_config", None) is None and TilingConfig.may_tile_implicitly(self.model):
            self.model.tiling_config = TilingConfig()

    def _materialize(self) -> None:
        """Evaluate the resident weights right away.

        MLX loads and quantizes lazily. Otherwise quantization only happens on the first forward pass
        while the original bf16 weights are still referenced: measured 15 GB retained instead of 9
        after the first generation, then +14 GB per new prompt (a leak). Evaluated here, the quantized
        weights are streamed tensor by tensor (peak around 10 GB) and memory stays flat.
        """
        import mlx.core as mx

        params = [getattr(self.model, a).parameters() for a in self.resident_attrs
                  if getattr(self.model, a, None) is not None]
        if params:
            mx.eval(*params)
        gc.collect()
        mx.clear_cache()

    def generate(self, req, hooks):
        import mlx.core as mx

        if not self.encoders_loaded and self.needs_encoders(req):
            self._restore_encoders()
        self.dispatcher.start(hooks, self._evict_encoders if self.low_memory else None)
        try:
            return self.run(req, hooks)
        finally:
            self.dispatcher.stop()
            # Release the Metal cache built up during the generation.
            gc.collect()
            mx.clear_cache()

    def _evict_encoders(self) -> None:
        import mlx.core as mx

        if not self.encoders_loaded:
            return
        cache = getattr(self.model, "prompt_cache", None)
        if cache:
            # Force evaluation of the embeddings before dropping the encoder (MLX is lazy).
            while len(cache) > PROMPT_CACHE_MAX:
                cache.pop(next(iter(cache)))
            mx.eval([a for pair in cache.values() for a in pair])
        for attr in self.encoder_attrs:
            if getattr(self.model, attr, None) is not None:
                setattr(self.model, attr, None)
        self.encoders_loaded = False
        gc.collect()
        mx.clear_cache()

    def _restore_encoders(self) -> None:
        if not self.reload_encoders():
            # Fallback: full rebuild (same cost as starting the CLI).
            self.model = None
            gc.collect()
            self.load()
            return
        self.encoders_loaded = True

    def save(self, result, path: Path) -> None:
        # mflux GeneratedImage; metadata export is turned off.
        result.save(path=path, export_json_metadata=False, overwrite=True)

    def _preview(self, latents, config):
        import mlx.core as mx

        from mflux.models.common.vae.vae_util import VAEUtil
        from mflux.utils.image_util import ImageUtil

        unpacked = self.latent_creator.unpack_latents(latents=latents, height=config.height, width=config.width)
        decoded = VAEUtil.decode(vae=self.model.vae, latent=unpacked, tiling_config=self.model.tiling_config)
        image = ImageUtil.to_pil(decoded)
        image.thumbnail((512, 512))
        del unpacked, decoded
        gc.collect()
        mx.clear_cache()  # give the decode buffers back to the system instead of caching them
        return image
