#!/usr/bin/env python3
"""Télécharge une build officielle de stable-diffusion.cpp (moteur GGUF) dans engines/sdcpp/<variant>/.

    python3 scripts/fetch_sdcpp.py --variant metal                # macOS Apple Silicon
    python3 scripts/fetch_sdcpp.py --variant vulkan --os windows  # tout GPU (NVIDIA, AMD, Intel)
    python3 scripts/fetch_sdcpp.py --variant cuda   --os windows  # NVIDIA (inclut le runtime CUDA 12)
    python3 scripts/fetch_sdcpp.py --variant rocm   --os windows  # AMD

Réservé au développement et au packaging : l'application, elle, installe le moteur toute seule (écran « Modèles »).
Même code que l'application (backend/app/engine_install.py) : somme SHA-256 vérifiée contre celle publiée par GitHub,
extraction sans sortie du dossier cible, rien n'est exécuté. GITHUB_TOKEN (facultatif) évite la limite d'appels anonymes.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine_install import ASSETS, host_os, install_variant  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", required=True, choices=["metal", "cuda", "rocm", "vulkan", "cpu"])
    ap.add_argument("--os", dest="target_os", choices=["macos", "windows", "linux"], default=host_os())
    ap.add_argument("--tag", default="latest", help="étiquette de la version (défaut : la dernière)")
    ap.add_argument("--dest", type=Path, default=ROOT / "engines" / "sdcpp")
    ap.add_argument("--allow-unverified", action="store_true", help="accepte une archive sans somme publiée (déconseillé)")
    args = ap.parse_args()
    if (args.target_os, args.variant) not in ASSETS:
        sys.exit(f"Pas de build « {args.variant} » pour {args.target_os}. Disponibles : "
                 + ", ".join(f"{o}/{v}" for o, v in ASSETS))

    def progress(done: int, total: int, message: str) -> None:
        print(f"\r› {message} : {done / 1e6:.0f} / {total / 1e6:.0f} Mo", end="", flush=True)

    meta = install_variant(args.target_os, args.variant, args.dest, tag=args.tag, progress=progress,
                           allow_unverified=args.allow_unverified)
    print(f"\n✓ {args.dest / args.variant} ({meta['tag']}, sha256 vérifié)")


if __name__ == "__main__":
    main()
