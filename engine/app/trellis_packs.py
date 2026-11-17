# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Pinned TRELLIS 1 runtime and its offline image conditioning dependencies."""
from .mesh_runtime_sources import U2NET_MD5, U2NET_URL


def trellis_pack(PackDef, PackArchive):
    return PackDef(
        id="trellis", name="TRELLIS (texte et image vers 3D)", family="mesh", python="3.10",
        gpu="nvidia-linux-x86", gpu_reason="TRELLIS demande Linux x86-64, NVIDIA et le compilateur CUDA.",
        cuda="cu121", torch_packages=("torch==2.4.0", "torchvision==0.19.0"),
        requirements=("numpy<2", "pillow", "imageio", "imageio-ffmpeg", "tqdm", "easydict", "opencv-python-headless",
                      "scipy", "ninja", "rembg==2.0.57", "onnxruntime", "pooch", "trimesh", "xatlas", "pyvista", "open3d",
                      "pymeshfix", "igraph", "transformers==4.44.2", "huggingface_hub", "safetensors", "timm",
                      "spconv-cu120", "xformers==0.0.27.post2", "wheel", "setuptools", "pybind11", "cmake",
                      "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8"),
        archives=(PackArchive("https://github.com/microsoft/TRELLIS/archive/193e0502b5cb3eb5997ec457d5340e95d09b158e.tar.gz",
                              ("trellis", "extensions/vox2seq")),
                  PackArchive("https://github.com/facebookresearch/dinov2/archive/7764ea0f912e53c92e82eb78a2a1631e92725fc8.tar.gz",
                              ("dinov2",))),
        local_packages=("extensions/vox2seq",),
        build_requirements=("git+https://github.com/NVlabs/nvdiffrast.git@253ac4fcea7de5f396371124af597e6cc957bfae",
                            "git+https://github.com/JeffreyXiang/diffoctreerast.git@b09c20b84ec3aace4729e6e18a613112320eca3a",
                            "git+https://github.com/autonomousvision/mip-splatting.git@dda02ab5ecf45d6edb8c540d9bb65c7e451345a9#subdirectory=submodules/diff-gaussian-rasterization"),
        auxiliary_files=((U2NET_URL, "u2net/u2net.onnx", U2NET_MD5),
                         ("https://dl.fbaipublicfiles.com/dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth?versionId=HLmbhvcd2hPq9CNLwMvwswbRlzZRuOeA",
                          "dinov2_vitl14_reg4_pretrain.pth", "36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51")),
        imports=("torch", "spconv", "xformers", "nvdiffrast.torch", "vox2seq", "trellis.pipelines.trellis_text_to_3d", "dinov2.hub.backbones"),
        size_mb=8000, engine="PyTorch + TRELLIS", contents="TRELLIS, DINOv2, PyTorch et extensions CUDA compilées localement.",
    )


def trellis2_pack(PackDef, PackArchive):
    """Official Linux CUDA runtime; native extensions are installed from fixed revisions."""
    return PackDef(
        id="trellis2", name="TRELLIS.2 (image vers 3D)", family="mesh", python="3.10",
        gpu="nvidia-linux-x86", gpu_reason="TRELLIS.2 demande Linux x86-64, NVIDIA et le compilateur CUDA.",
        cuda="cu124", torch_packages=("torch==2.6.0", "torchvision==0.21.0"),
        requirements=("numpy<2", "pillow", "imageio", "imageio-ffmpeg", "tqdm", "easydict", "opencv-python-headless",
                      "ninja", "trimesh", "transformers>=4.56,<5", "huggingface_hub", "safetensors", "zstandard",
                      "kornia", "timm", "wheel", "setuptools", "packaging", "pybind11", "cmake",
                      "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8"),
        archives=(PackArchive("https://github.com/microsoft/TRELLIS.2/archive/75fbf0183001ed9876c8dbb35de6b68552ee08bd.tar.gz", ("trellis2",)),),
        build_requirements=("git+https://github.com/NVlabs/nvdiffrast.git@253ac4fcea7de5f396371124af597e6cc957bfae",
                            "git+https://github.com/JeffreyXiang/nvdiffrec.git@b296927cc7fd01c2ac1087c8065c4d7248f72da4",
                            "git+https://github.com/JeffreyXiang/CuMesh.git@12289e1062f0603f2f0d0771b02e1395d247f26f",
                            "git+https://github.com/JeffreyXiang/FlexGEMM.git@6dd94a859c26ee8246888502eada3dd8ad85532e",
                            "flash-attn==2.7.3",
                            "git+https://github.com/microsoft/TRELLIS.2.git@75fbf0183001ed9876c8dbb35de6b68552ee08bd#subdirectory=o-voxel"),
        imports=("torch", "nvdiffrast.torch", "cumesh", "flex_gemm", "o_voxel", "trellis2.pipelines"),
        size_mb=10000, engine="PyTorch + TRELLIS.2", contents="TRELLIS.2, PyTorch et extensions CUDA compilées localement.",
    )
