#!/usr/bin/env python3
"""Télécharge une build officielle de stable-diffusion.cpp (moteur GGUF) dans engines/sdcpp/<variant>/.

    python3 scripts/fetch_sdcpp.py --variant metal                # macOS Apple Silicon
    python3 scripts/fetch_sdcpp.py --variant vulkan --os windows  # tout GPU (NVIDIA, AMD, Intel)
    python3 scripts/fetch_sdcpp.py --variant cuda   --os windows  # NVIDIA (inclut le runtime CUDA 12)
    python3 scripts/fetch_sdcpp.py --variant rocm   --os windows  # AMD

Sécurité : l'archive est téléchargée dans un dossier temporaire neuf, sa somme SHA-256 est comparée à celle
publiée par GitHub (champ `digest` de l'asset) et l'extraction refuse les chemins hors du dossier cible.
Rien n'est exécuté. Le jeton GITHUB_TOKEN (facultatif) évite la limite d'appels anonymes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = "leejet/stable-diffusion.cpp"

# (os, variant) -> motifs d'assets (le premier est la build, les suivants sont des compléments à extraire au même endroit)
ASSETS: dict[tuple[str, str], list[str]] = {
    ("macos", "metal"): [r"-bin-Darwin-.*-arm64\.zip$"],
    ("windows", "vulkan"): [r"-bin-win-vulkan-x64\.zip$"],
    ("windows", "cuda"): [r"-bin-win-cuda12-x64\.zip$", r"^cudart-sd-bin-win-cu12-x64\.zip$"],
    ("windows", "rocm"): [r"-bin-win-rocm-.*-x64\.zip$"],
    ("windows", "cpu"): [r"-bin-win-cpu-x64\.zip$"],
    ("linux", "vulkan"): [r"-bin-Linux-.*-x86_64-vulkan\.zip$"],
    ("linux", "rocm"): [r"-bin-Linux-.*-x86_64-rocm-.*\.zip$"],
    ("linux", "cpu"): [r"-bin-Linux-[^-]*-[^-]*-x86_64\.zip$"],
}


def host_os() -> str:
    return {"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux")


def http_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "chambre-noire", "Accept": "application/vnd.github+json"})
    if token := os.environ.get("GITHUB_TOKEN"):
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(url: str, dest: Path) -> str:
    sha = hashlib.sha256()
    req = urllib.request.Request(url, headers={"User-Agent": "chambre-noire"})
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
            sha.update(chunk)
    return sha.hexdigest()


def safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    root = dest.resolve()
    for info in zf.infolist():
        target = (dest / info.filename).resolve()
        if root != target and root not in target.parents:
            sys.exit(f"Archive refusée : chemin hors du dossier cible ({info.filename})")
    zf.extractall(dest)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", required=True, choices=["metal", "cuda", "rocm", "vulkan", "cpu"])
    ap.add_argument("--os", dest="target_os", choices=["macos", "windows", "linux"], default=host_os())
    ap.add_argument("--tag", default="latest", help="étiquette de la version (défaut : la dernière)")
    ap.add_argument("--dest", type=Path, default=ROOT / "engines" / "sdcpp")
    ap.add_argument("--allow-unverified", action="store_true", help="accepte une archive sans somme publiée (déconseillé)")
    args = ap.parse_args()

    patterns = ASSETS.get((args.target_os, args.variant))
    if not patterns:
        sys.exit(f"Pas de build « {args.variant} » pour {args.target_os}. Disponibles : "
                 + ", ".join(f"{o}/{v}" for o, v in ASSETS))
    url = f"https://api.github.com/repos/{REPO}/releases/" + ("latest" if args.tag == "latest" else f"tags/{args.tag}")
    release = http_json(url)
    assets = release["assets"]
    out = args.dest / args.variant
    tmp = Path(tempfile.mkdtemp(prefix="sdcpp-"))
    try:
        stage = tmp / "stage"
        stage.mkdir()
        meta = {"tag": release["tag_name"], "assets": []}
        for pat in patterns:
            matches = [a for a in assets if re.search(pat, a["name"])]
            if len(matches) != 1:
                sys.exit(f"Asset « {pat} » : {len(matches)} correspondance(s) dans {release['tag_name']}")
            asset = matches[0]
            expected = (asset.get("digest") or "").removeprefix("sha256:")
            print(f"› {asset['name']} ({asset['size'] / 1e6:.0f} Mo)", flush=True)
            archive = tmp / asset["name"]
            got = download(asset["browser_download_url"], archive)
            if expected:
                if got != expected:
                    sys.exit(f"SOMME DE CONTRÔLE INVALIDE pour {asset['name']} : attendu {expected}, obtenu {got}")
                print("  sha256 vérifié")
            elif not args.allow_unverified:
                sys.exit(f"Aucune somme publiée pour {asset['name']} : refus (voir --allow-unverified)")
            with zipfile.ZipFile(archive) as zf:
                safe_extract(zf, stage)
            meta["assets"].append({"name": asset["name"], "sha256": got})
        if out.exists():
            shutil.rmtree(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stage, out)
        for exe in ("sd-cli", "sd-server"):
            p = out / exe
            if p.is_file():
                p.chmod(0o755)
        (out / "VERSION.json").write_text(json.dumps(meta, indent=2) + "\n")
        print(f"✓ {out} ({meta['tag']})")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
