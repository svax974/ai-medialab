# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Demo engine: fake images generated instantly, to try the UI without a GPU.
Enabled with the IMAGEGEN_DEMO=1 environment variable."""

from __future__ import annotations

import colorsys
import hashlib
import random
import time

from PIL import Image, ImageDraw, ImageFilter, ImageOps

from .base import Engine, GenerationCancelled, ModelSpec, ParamSpec

SPEC = ModelSpec(
    id="demo",
    name="Démo (sans GPU)",
    family="Test",
    description="Génère des images abstraites en quelques secondes pour tester l'interface.",
    engine="app.engines.demo:DemoEngine",
    backend="demo",
    reference_mode="multi",
    max_references=4,
    params=[
        ParamSpec("steps", "Étapes", "int", 12, 2, 40, 1, "Durée simulée."),
        ParamSpec("strength", "Influence de l'image", "float", 0.5, 0.05, 0.95, 0.05, requires_references=True),
        ParamSpec("negative_prompt", "Prompt négatif", "text", "", advanced=True),
    ],
    default_quantize=None,
    quantize_options=[],
    tags=["test"],
)


class DemoEngine(Engine):
    def load(self) -> None:
        time.sleep(1.5)

    def generate(self, req, hooks):
        rng = random.Random(int(hashlib.md5(f"{req.prompt}|{req.seed}".encode()).hexdigest(), 16))
        w, h = req.width, req.height
        hue = rng.random()
        img = Image.new("RGB", (w, h))
        draw = ImageDraw.Draw(img)
        for y in range(0, h, 4):
            r, g, b = colorsys.hsv_to_rgb((hue + y / h * 0.25) % 1, 0.65, 0.35 + 0.5 * y / h)
            draw.rectangle([0, y, w, y + 4], fill=(int(r * 255), int(g * 255), int(b * 255)))
        for _ in range(14):
            cx, cy, rad = rng.randrange(w), rng.randrange(h), rng.randrange(min(w, h) // 12, min(w, h) // 3)
            r, g, b = colorsys.hsv_to_rgb((hue + rng.random() * 0.4) % 1, 0.7, 0.95)
            draw.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(int(r * 255), int(g * 255), int(b * 255)))
        img = img.filter(ImageFilter.GaussianBlur(min(w, h) / 40))
        if req.references:
            ref = ImageOps.fit(Image.open(req.references[0]).convert("RGB"), (w, h))
            img = Image.blend(img, ref, req.strength or 0.5)
        draw = ImageDraw.Draw(img)
        draw.text((24, h - 40), req.prompt[:80], fill=(255, 255, 255))

        for step in range(1, req.steps + 1):
            time.sleep(0.25)
            hooks.on_step(step, req.steps)
            if hooks.is_cancelled():
                raise GenerationCancelled()
            if hooks.preview_every and step % hooks.preview_every == 0 and step < req.steps:
                p = img.filter(ImageFilter.GaussianBlur(30 * (1 - step / req.steps)))
                p.thumbnail((512, 512))
                hooks.on_preview(p)
        return img
