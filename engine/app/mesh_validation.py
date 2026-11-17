# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Validate the self-contained binary glTF emitted by a mesh worker."""
import json
import struct
from pathlib import Path


def validate_glb(path: Path) -> None:
    """Reject malformed GLBs and resources that could trigger external requests."""
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12:
            raise ValueError("Fichier GLB incomplet.")
        magic, version, length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or length != path.stat().st_size:
            raise ValueError("Fichier GLB invalide.")
        chunk_header = stream.read(8)
        if len(chunk_header) != 8:
            raise ValueError("Fichier GLB incomplet.")
        size, kind = struct.unpack("<I4s", chunk_header)
        if kind != b"JSON" or size > min(length - 20, 16 * 1024 * 1024):
            raise ValueError("Fichier GLB invalide.")
        doc = json.loads(stream.read(size))
    if not isinstance(doc, dict) or not isinstance(doc.get("asset"), dict) or doc["asset"].get("version") != "2.0":
        raise ValueError("Document glTF invalide.")
    def check(node: object) -> None:
        if isinstance(node, dict):
            if any(str(key).lower() == "uri" for key in node):
                raise ValueError("Le GLB doit contenir toutes ses ressources.")
            if any(key in node for key in ("KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu")):
                raise ValueError("Compression GLB non prise en charge.")
            for value in node.values():
                check(value)
        elif isinstance(node, str) and node in ("KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"):
            raise ValueError("Compression GLB non prise en charge.")
        elif isinstance(node, list):
            for value in node:
                check(value)

    check(doc)
