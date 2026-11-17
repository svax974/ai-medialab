# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""TRELLIS image and text pipelines, following Microsoft's examples."""
import os

from . import Engine, require_cuda
from common import local_snapshot


class TrellisEngine(Engine):
    def load(self) -> None:
        os.environ["SPCONV_ALGO"] = "native"
        os.environ["ATTN_BACKEND"] = "xformers"
        from trellis.pipelines import TrellisImageTo3DPipeline, TrellisTextTo3DPipeline

        require_cuda()
        if self.options["image"]:
            self._offline_dino(TrellisImageTo3DPipeline)
        cls = TrellisImageTo3DPipeline if self.options["image"] else TrellisTextTo3DPipeline
        self.pipeline = cls.from_pretrained(local_snapshot(self.options["sources"][0]))
        self.pipeline.cuda()

    @staticmethod
    def _offline_dino(cls) -> None:
        import torch
        from pathlib import Path
        from torchvision import transforms
        from dinov2.hub.backbones import dinov2_vitl14_reg

        def initialize(pipeline, name):
            if name != "dinov2_vitl14_reg":
                raise ValueError("Encodeur DINOv2 inattendu.")
            path = Path(os.environ["MESH_PACK_DIR"]) / "dinov2_vitl14_reg4_pretrain.pth"
            model = dinov2_vitl14_reg(pretrained=False)
            model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
            pipeline.models["image_cond_model"] = model.eval()
            pipeline.image_cond_model_transform = transforms.Compose(
                [transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])])
        cls._init_image_cond_model = initialize

    def generate(self, req: dict, output: str) -> dict:
        from PIL import Image
        from trellis.utils import postprocessing_utils

        condition = Image.open(req["references"][0]) if self.options["image"] else req["prompt"]
        results = self.pipeline.run(condition, seed=int(req["seed"]))
        glb = postprocessing_utils.to_glb(results["gaussian"][0], results["mesh"][0], simplify=0.95, texture_size=1024)
        glb.export(output)
        return {}


class Trellis2Engine(Engine):
    def load(self) -> None:
        from trellis2.pipelines import Trellis2ImageTo3DPipeline
        from trellis2.pipelines.rembg import BiRefNet

        require_cuda()
        background = local_snapshot(self.options["sources"][3])
        original_init = BiRefNet.__init__

        def initialize(instance, model_name):
            if model_name != "briaai/RMBG-2.0":
                raise ValueError("Modèle de détourage inattendu.")
            original_init(instance, background)

        BiRefNet.__init__ = initialize
        try:
            self.pipeline = Trellis2ImageTo3DPipeline.from_pretrained(local_snapshot(self.options["sources"][0]))
        finally:
            BiRefNet.__init__ = original_init
        self.pipeline.cuda()

    def generate(self, req: dict, output: str) -> dict:
        import o_voxel
        from PIL import Image

        image = Image.open(req["references"][0])
        mesh = self.pipeline.run(image, seed=int(req["seed"]), pipeline_type="512")[0]
        mesh.simplify(16777216)
        glb = o_voxel.postprocess.to_glb(vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs,
            coords=mesh.coords, attr_layout=mesh.layout, voxel_size=mesh.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], decimation_target=250000,
            texture_size=1024, remesh=True, remesh_band=1, remesh_project=0, verbose=False)
        glb.export(output, extension_webp=True)
        return {}
