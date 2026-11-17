# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Image-to-mesh inference using the official TripoSG implementation."""
from . import Engine, require_cuda
from common import local_snapshot


class TripoSGEngine(Engine):
    def load(self) -> None:
        import torch
        from triposg.pipelines.pipeline_triposg import TripoSGPipeline
        from briarmbg import BriaRMBG

        device = require_cuda()
        self.background = BriaRMBG.from_pretrained(local_snapshot(self.options["sources"][1])).to(device).eval()
        self.pipeline = TripoSGPipeline.from_pretrained(local_snapshot(self.options["sources"][0])).to(device, torch.float16)

    def generate(self, req: dict, output: str) -> dict:
        import numpy as np
        import torch
        import trimesh
        from image_process import prepare_image

        image = prepare_image(req["references"][0], bg_color=np.array([1.0, 1.0, 1.0]), rmbg_net=self.background)
        with torch.no_grad():
            result = self.pipeline(image=image, generator=torch.Generator(device=self.pipeline.device).manual_seed(int(req["seed"])),
                                   num_inference_steps=int(req["steps"]), guidance_scale=float(req["guidance"])).samples[0]
        trimesh.Trimesh(result[0].astype(np.float32), np.ascontiguousarray(result[1])).export(output)
        return {}
