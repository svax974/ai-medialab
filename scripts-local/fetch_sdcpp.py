#!/usr/bin/env python3
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Downloads an official stable-diffusion.cpp build (GGUF engine) into engines/sdcpp/<variant>/.

    python3 scripts-local/fetch_sdcpp.py --variant metal                # macOS Apple Silicon
    python3 scripts-local/fetch_sdcpp.py --variant vulkan --os windows  # any GPU (NVIDIA, AMD, Intel)
    python3 scripts-local/fetch_sdcpp.py --variant cuda   --os windows  # NVIDIA (includes the CUDA 12 runtime)
    python3 scripts-local/fetch_sdcpp.py --variant rocm   --os windows  # AMD

For development and packaging only; the app installs the engine itself ("Modèles" screen).
Same code as the app (engine/app/engine_install.py): SHA-256 checked against the sum GitHub publishes,
extraction can't escape the target folder, nothing is executed. GITHUB_TOKEN (optional) avoids the anonymous rate limit.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

from app.engine_install import ASSETS, PINNED_TAG, host_os, install_variant  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", required=True, choices=["metal", "cuda", "rocm", "vulkan", "cpu"])
    ap.add_argument("--os", dest="target_os", choices=["macos", "windows", "linux"], default=host_os())
    ap.add_argument("--tag", default=PINNED_TAG, help="étiquette de la version (défaut : la version validée ; « latest » pour la dernière)")
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
