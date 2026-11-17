# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Pinned upstream isolated-runtime definitions for TripoSR and Stable Fast 3D.

Constructed by the pack registry after its PackDef and PackArchive types have been defined.
SF3D's two native extensions and torchmcubes must be built after torch is installed.
"""

U2NET_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
U2NET_MD5 = "60024c5c889badc19c04ad937298a77b"


def reconstruction_packs(PackDef, PackArchive):
    """Return pack definitions; all executable source archives are pinned to commits."""
    common = ("numpy==1.26.4", "Pillow==10.1.0", "einops==0.7.0", "omegaconf==2.3.0",
              "rembg==2.0.57", "onnxruntime", "pooch", "setuptools==69.5.1", "wheel", "ninja")
    return {
        "triposr": PackDef(
            id="triposr", name="TripoSR (image vers 3D)", family="mesh", python="3.10",
            torch_packages=("torch==2.4.1", "torchvision==0.19.1"), rocm="rocm6.1", cuda="cu121",
            requirements=(*common, "transformers==4.35.0", "trimesh==4.0.5", "huggingface-hub<0.26", "imageio",
                          "scikit-build-core>=1.0", "pybind11>=2.10", "cmake>=3.24"),
            build_requirements=("git+https://github.com/tatsy/torchmcubes.git@a9ac95aa329957ba646e7bb057f825f5dfa77f38",),
            archives=(PackArchive("https://github.com/VAST-AI-Research/TripoSR/archive/107cefdc244c39106fa830359024f6a2f1c78871.tar.gz", ("tsr",)),),
            imports=("torch", "torchvision", "torchmcubes", "tsr.system", "rembg", "onnxruntime"),
            auxiliary_files=((U2NET_URL, "u2net/u2net.onnx", U2NET_MD5),),
            size_mb=3500, engine="PyTorch + TripoSR",
            contents="PyTorch, TripoSR, torchmcubes et rembg; compilation native requise.",
        ),
        "sf3d": PackDef(
            id="sf3d", name="Stable Fast 3D (image vers 3D)", family="mesh", python="3.10",
            torch_packages=("torch==2.4.1", "torchvision==0.19.1"), rocm="rocm6.1", cuda="cu121",
            requirements=(*common, "jaxtyping==0.2.31", "transformers==4.42.3", "open_clip_torch==2.24.0",
                          "trimesh==4.4.1", "huggingface-hub==0.23.4", "pynanoinstantmeshes==0.0.3", "gpytoolbox==0.2.0"),
            archives=(PackArchive("https://github.com/Stability-AI/stable-fast-3d/archive/ff21fc491b4dc5314bf6734c7c0dabd86b5f5bb2.tar.gz", ("sf3d", "texture_baker", "uv_unwrapper")),),
            local_packages=("texture_baker", "uv_unwrapper"),
            imports=("torch", "torchvision", "sf3d.system", "texture_baker._C", "uv_unwrapper._C", "rembg", "onnxruntime"),
            auxiliary_files=((U2NET_URL, "u2net/u2net.onnx", U2NET_MD5),),
            size_mb=4000, engine="PyTorch + Stable Fast 3D",
            contents="PyTorch, Stable Fast 3D et ses extensions natives; OpenMP requis sur Mac. Poids soumis à licence et accès Hugging Face.",
        ),
    }
