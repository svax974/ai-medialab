# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Stable Fast 3D single-image inference, following upstream run.py at ff21fc4."""

from __future__ import annotations

import os
from contextlib import nullcontext
from pathlib import Path

from . import Engine
from common import Cancelled, local_snapshot


class SF3DEngine(Engine):
    def load(self) -> None:
        # Upstream requires this before the first MPS operation; its MPS path is experimental.
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        import torch
        from sf3d.system import SF3D
        from sf3d.utils import get_device

        self.device = get_device()
        self.model = SF3D.from_pretrained(local_snapshot(self.options["sources"][0]), config_name="config.yaml", weight_name="model.safetensors")
        self.model.to(self.device)
        self.model.eval()

    def generate(self, req: dict, output: str) -> dict:
        import rembg
        import torch
        from PIL import Image
        from sf3d.utils import remove_background, resize_foreground

        references = req.get("references") or []
        if len(references) != 1:
            raise ValueError("Stable Fast 3D requiert une image de référence.")
        home = os.environ.get("U2NET_HOME")
        if not home or not (Path(home) / "u2net.onnx").is_file():
            raise RuntimeError("Le modèle de détourage u2net n'est pas installé dans le pack.")
        image = resize_foreground(remove_background(Image.open(references[0]).convert("RGBA"), rembg.new_session()), 0.85)
        if self.cancelled():
            raise Cancelled()
        autocast = torch.autocast(device_type="cuda", dtype=torch.bfloat16) if self.device.startswith("cuda") else nullcontext()
        with torch.no_grad(), autocast:
            mesh, _ = self.model.run_image([image], bake_resolution=1024, remesh="none", vertex_count=-1)
        if self.cancelled():
            raise Cancelled()
        mesh.export(output, file_type="glb", include_normals=True)
        return {}
