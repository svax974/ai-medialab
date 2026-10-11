"""Outils partagés par les moteurs basés sur mflux (MLX, Apple Silicon)."""

from __future__ import annotations

import gc
from pathlib import Path
from typing import Any, Callable

from .base import Engine, GenerationCancelled, Hooks

PROMPT_CACHE_MAX = 64


class ProgressDispatcher:
    """Callback mflux enregistré une seule fois au chargement ; relaie la progression de la
    génération en cours vers les hooks du worker, gère l'annulation et les aperçus.

    `before_loop` est appelé par mflux juste après l'encodage du prompt : c'est le moment où
    l'encodeur de texte devient inutile et peut être libéré (mode économie de mémoire)."""

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
            except Exception as exc:  # un aperçu raté ne doit jamais faire échouer la génération
                print(f"[aperçu] échec : {exc}", flush=True)


class MfluxEngine(Engine):
    """Base des moteurs mflux.

    La sous-classe fournit `build_model()`, `run()` et éventuellement `latent_creator` (aperçus).

    Économie de mémoire (option `low_memory`, active par défaut) : comme la CLI mflux, les encodeurs
    de texte sont libérés dès que le prompt est encodé. Ils sont rechargés à la génération suivante
    si le prompt n'est pas déjà en cache — seuls (`reload_encoders`) si la sous-classe sait le faire,
    sinon en reconstruisant le modèle.
    """

    latent_creator: Any = None
    encoder_attrs: tuple[str, ...] = ("text_encoder",)
    # Composants qui restent en mémoire entre deux générations.
    resident_attrs: tuple[str, ...] = ("transformer", "vae")

    @property
    def low_memory(self) -> bool:
        return bool(self.options.get("low_memory", True))

    def build_model(self):
        raise NotImplementedError

    def run(self, req, hooks):
        raise NotImplementedError

    def needs_encoders(self, req) -> bool:
        """Faux si les embeddings nécessaires sont déjà en cache (les encodeurs sont alors inutiles)."""
        return True

    def reload_encoders(self) -> bool:
        """Recharge uniquement les encodeurs. Retourne False si non pris en charge."""
        return False

    def load(self) -> None:
        self.model = self.build_model()
        self._materialize()
        if self.low_memory:
            self._enable_vae_tiling()
        self.encoders_loaded = all(getattr(self.model, a, None) is not None for a in self.encoder_attrs)
        if not self.encoders_loaded and not self.low_memory:
            self._restore_encoders()  # assez de mémoire : on garde l'encodeur résident
        self.dispatcher = ProgressDispatcher(self._preview if self.latent_creator else None)
        self.model.callbacks.register(self.dispatcher)

    def _enable_vae_tiling(self) -> None:
        """Décodage VAE par tuiles : sans cela, décoder (même un simple aperçu 512²) demandait ≈ 17 Go
        transitoires, ce qui suffisait à faire swapper une machine de 36 Go."""
        from mflux.models.common.vae.tiling_config import TilingConfig

        if getattr(self.model, "tiling_config", None) is None and TilingConfig.may_tile_implicitly(self.model):
            self.model.tiling_config = TilingConfig()

    def _materialize(self) -> None:
        """Évalue tout de suite les poids résidents.

        MLX charge et quantifie paresseusement : sans cela, la quantification n'a lieu qu'au premier calcul,
        avec les poids bf16 d'origine encore référencés — mesuré : 15 Go retenus au lieu de 9 après la
        première génération, puis +14 Go à chaque nouveau prompt (fuite). Évalués ici, les poids quantifiés
        sont streamés tenseur par tenseur (pic ≈ 10 Go) et la mémoire reste stable.
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
            # Libère le cache Metal accumulé entre deux générations.
            gc.collect()
            mx.clear_cache()

    def _evict_encoders(self) -> None:
        import mlx.core as mx

        if not self.encoders_loaded:
            return
        cache = getattr(self.model, "prompt_cache", None)
        if cache:
            # Matérialise les embeddings avant de lâcher l'encodeur (évaluation paresseuse de MLX).
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
            # Repli : reconstruction complète (coût équivalent à un lancement de la CLI).
            self.model = None
            gc.collect()
            self.load()
            return
        self.encoders_loaded = True

    def save(self, result, path: Path) -> None:
        # GeneratedImage de mflux : conserve les métadonnées de génération dans l'image.
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
        mx.clear_cache()  # rend au système les tampons du décodage au lieu de les garder en cache
        return image
