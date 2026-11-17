# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""TripoSR single-image inference, following upstream run.py at 107cefd."""

from __future__ import annotations

import os
from pathlib import Path

from . import Engine
from common import Cancelled, local_snapshot


class TripoSREngine(Engine):
    def load(self) -> None:
        import torch
        from tsr.system import TSR

        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.model = TSR.from_pretrained(local_snapshot(self.options["sources"][0]), config_name="config.yaml", weight_name="model.ckpt")
        self.model.renderer.set_chunk_size(8192)
        self.model.to(self.device)
        self.model.eval()

    def generate(self, req: dict, output: str) -> dict:
        import numpy as np
        import rembg
        import torch
        from PIL import Image
        from tsr.utils import remove_background, resize_foreground

        references = req.get("references") or []
        if len(references) != 1:
            raise ValueError("TripoSR requiert une image de référence.")
        home = os.environ.get("U2NET_HOME")
        if not home or not (Path(home) / "u2net.onnx").is_file():
            raise RuntimeError("Le modèle de détourage u2net n'est pas installé dans le pack.")
        image = resize_foreground(remove_background(Image.open(references[0]), rembg.new_session()), 0.85)
        rgba = np.asarray(image).astype(np.float32) / 255.0
        image = Image.fromarray(((rgba[:, :, :3] * rgba[:, :, 3:4] + (1 - rgba[:, :, 3:4]) * 0.5) * 255).astype(np.uint8))
        if self.cancelled():
            raise Cancelled()
        with torch.no_grad():
            codes = self.model([image], device=self.device)
            if self.cancelled():
                raise Cancelled()
            mesh = self.model.extract_mesh(codes, True, resolution=256)[0]
        if self.cancelled():
            raise Cancelled()
        mesh.export(output, file_type="glb")
        return {}
