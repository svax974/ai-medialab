#!/usr/bin/env python3
"""Cross-construit un livrable PORTABLE (sans installateur) de Chambre noire pour Windows ou Linux x86_64.

    python3 scripts/package_cross.py --profile win-cuda      # → desktop/dist/Chambre-noire-win-cuda.zip
    python3 scripts/package_cross.py --profile linux-cuda    # → desktop/dist/Chambre-noire-linux-cuda.tar.gz

Étapes : (1) runtime Python + dépendances de la cible (scripts/build_runtime.py, mode cross), (2) coque Tauri de la cible,
(3) archive + somme SHA-256.

- Windows : coque compilée avec mingw-w64 (cible Rust x86_64-pc-windows-gnu ; `brew install mingw-w64`).
- Linux   : coque compilée dans un conteneur Docker linux/amd64 (WebKitGTK n'est pas cross-compilable sans sysroot) ;
            runtime assemblé sur un volume APFS sensible à la casse (sinon des fichiers de roues Linux ne différant que
            par la casse s'écraseraient sur le disque insensible à la casse du Mac).

Aucun livrable cross-construit n'a pu être exécuté sur son matériel cible (voir README) : seule la coque Linux et le
serveur embarqué sont éprouvés sans GPU dans un conteneur.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
TAURI = DESKTOP / "src-tauri"
DIST = DESKTOP / "dist"
CROSS = DESKTOP / "build-cross"
PROFILES = json.loads((DESKTOP / "runtime" / "profiles.json").read_text())["profiles"]
BINARY = "chambre-noire"


def log(msg: str) -> None:
    print(f"\033[1;33m›\033[0m {msg}", flush=True)


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def human(n: float) -> str:
    for unit in ("o", "Ko", "Mo", "Go"):
        if n < 1024 or unit == "Go":
            return f"{n:.1f} {unit}" if unit != "o" else f"{int(n)} o"
        n /= 1024
    return ""


READMES = {
    "windows": """Chambre noire — version Windows ({label})
=========================================================

Application portable : aucun installateur, rien à installer en dehors des prérequis ci-dessous.

1. Extraire l'archive dans un dossier à chemin COURT (ex. C:\\Chambre-noire) — Windows limite les chemins à 260 caractères.
2. Lancer « Chambre noire.exe ».

Prérequis
- Windows 10 (1809+) ou 11, 64 bits.
- Microsoft Edge WebView2 Runtime (déjà présent sur Windows 11 et sur Windows 10 à jour).
- Microsoft Visual C++ Redistributable 2015-2022 x64 (https://aka.ms/vs/17/release/vc_redist.x64.exe) : PyTorch en a besoin
  et ne l'embarque pas.
{gpu}

Premier lancement : Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » car l'exécutable n'est pas
signé (pas de certificat de signature) : « Informations complémentaires » → « Exécuter quand même ».

Données (base, images générées, journaux) : %LOCALAPPDATA%\\app.chambrenoire.studio
Modèles : %USERPROFILE%\\.cache\\huggingface\\hub (téléchargés depuis l'application : bouton « Modèles »).
Journal du serveur : %LOCALAPPDATA%\\app.chambrenoire.studio\\logs\\backend.log

WebView2Loader.dll (Microsoft, licence BSD) est livrée à côté de l'exécutable : ne pas la supprimer.

Statut : construit par cross-compilation depuis macOS ; son exécution sur Windows n'a pas pu être vérifiée par l'auteur.
""",
    "linux": """Chambre noire — version Linux x86_64 ({label})
=========================================================

Application portable : aucun installateur.

    tar xzf Chambre-noire-{profile}.tar.gz
    cd Chambre-noire-{profile}
    ./chambre-noire.sh

Prérequis
- Distribution 64 bits récente (glibc ≥ 2.28 ; coque construite sous Ubuntu 22.04).
- Bibliothèques WebKitGTK : sous Debian/Ubuntu `sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1`.
{gpu}

Données : ~/.local/share/app.chambrenoire.studio (journal du serveur : logs/backend.log)
Modèles : ~/.cache/huggingface/hub (téléchargés depuis l'application : bouton « Modèles »).

Statut : construit par cross-compilation depuis macOS. Le serveur embarqué et la coque démarrent dans un conteneur sans GPU ;
l'exécution sur GPU n'a pas pu être vérifiée par l'auteur.
""",
}
GPU_TEXT = {
    "cuda": "- GPU NVIDIA avec pilote récent (CUDA 12.8 : pilote ≥ 570) ; la mémoire vidéo détermine les modèles utilisables.",
    "rocm": "- GPU AMD compatible ROCm et pilote adapté (voir la matrice de compatibilité AMD).",
}


def readme_text(profile_name: str, profile: dict) -> str:
    gpu = GPU_TEXT["rocm" if "rocm" in profile_name else "cuda"]
    return READMES[profile["os"]].format(label=profile["label"], gpu=gpu, profile=profile_name)


# --- Runtime ---------------------------------------------------------------------------------------

def ensure_runtime(profile_name: str, resources: Path) -> None:
    if (resources / "runtime" / "python").is_dir() and (resources / "runtime" / "site-packages").is_dir():
        log(f"Runtime déjà assemblé : {resources}")
        return
    run([sys.executable, ROOT / "scripts" / "build_runtime.py", "--profile", profile_name, "--out", resources])


# --- Windows ---------------------------------------------------------------------------------------

def build_shell_windows() -> tuple[Path, Path]:
    log("Coque Tauri → x86_64-pc-windows-gnu (mingw-w64)…")
    for tool in ("x86_64-w64-mingw32-gcc", "x86_64-w64-mingw32-windres"):
        if not shutil.which(tool):
            sys.exit(f"{tool} introuvable (brew install mingw-w64).")
    env = {
        **os.environ,
        "CC_x86_64_pc_windows_gnu": "x86_64-w64-mingw32-gcc",
        "CXX_x86_64_pc_windows_gnu": "x86_64-w64-mingw32-g++",
        "AR_x86_64_pc_windows_gnu": "x86_64-w64-mingw32-ar",
        # Ne pas recopier le runtime macOS (desktop/build/resources) dans le dossier cible.
        "TAURI_CONFIG": json.dumps({"bundle": {"resources": []}}),
    }
    run(["rustup", "target", "add", "x86_64-pc-windows-gnu"], env=env)
    run(["cargo", "build", "--release", "--target", "x86_64-pc-windows-gnu", "--features", "tauri/custom-protocol"],
        cwd=TAURI, env=env)
    out = TAURI / "target" / "x86_64-pc-windows-gnu" / "release"
    exe, loader = out / f"{BINARY}.exe", out / "WebView2Loader.dll"
    for f in (exe, loader):
        if not f.is_file():
            sys.exit(f"Introuvable après compilation : {f}")
    return exe, loader


def write_zip(archive: Path, top: str, entries: list[tuple[Path, str]], resources: Path, extra_text: dict[str, str]) -> None:
    """Zip64 en flux (pas de dossier intermédiaire de plusieurs Go sur le disque)."""
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.unlink(missing_ok=True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zf:
        for src, name in entries:
            zf.write(src, f"{top}/{name}")
        for name, text in extra_text.items():
            zf.writestr(f"{top}/{name}", text.replace("\n", "\r\n"))
        files = [p for sub in ("backend", "frontend", "runtime") for p in sorted((resources / sub).rglob("*")) if p.is_file()]
        for i, p in enumerate(files, 1):
            zf.write(p, f"{top}/{p.relative_to(resources).as_posix()}")
            if i % 5000 == 0:
                print(f"  {i}/{len(files)} fichiers", flush=True)


def package_windows(profile_name: str, profile: dict, skip_runtime: bool) -> Path:
    resources = CROSS / profile_name / "resources"
    if not skip_runtime:
        ensure_runtime(profile_name, resources)
    exe, loader = build_shell_windows()
    top = f"Chambre-noire-{profile_name}"
    archive = DIST / f"{top}.zip"
    log(f"Archive {archive.name}…")
    write_zip(archive, top, [(exe, "Chambre noire.exe"), (loader, "WebView2Loader.dll")], resources,
              {"LISEZMOI.txt": readme_text(profile_name, profile)})
    return archive


# --- Linux -----------------------------------------------------------------------------------------

DOCKERFILE = """FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential pkg-config curl ca-certificates git file \\
    libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev \\
    xvfb xauth libwebkit2gtk-4.1-0 dbus-x11 \\
 && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH=/root/.cargo/bin:$PATH
"""
LINUX_IMAGE = "chambre-noire-linux-builder"
LINUX_VOLUME = "chambre-noire-linux-target"


def build_shell_linux() -> Path:
    log("Coque Tauri → Linux x86_64 (conteneur Docker linux/amd64, Ubuntu 22.04)…")
    if not shutil.which("docker"):
        sys.exit("Docker est requis pour la coque Linux.")
    ctx = CROSS / "linux-docker"
    ctx.mkdir(parents=True, exist_ok=True)
    (ctx / "Dockerfile").write_text(DOCKERFILE)
    run(["docker", "build", "--platform", "linux/amd64", "-t", LINUX_IMAGE, ctx])
    out_dir = CROSS / "linux-shell"
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    # Sources en lecture seule + copie de travail dans le conteneur ; target/ dans un volume nommé (supprimé ensuite).
    script = (
        "set -e; mkdir -p /work && cd /src && "
        "tar --exclude=./target --exclude=./gen -cf - . | tar -xf - -C /work && cd /work && "
        "export TAURI_CONFIG='{\"bundle\":{\"resources\":[]}}' CARGO_TARGET_DIR=/target CARGO_BUILD_JOBS=4 && "
        "cargo build --release --features tauri/custom-protocol && "
        f"cp /target/release/{BINARY} /out/{BINARY} && file /out/{BINARY}"
    )
    run(["docker", "run", "--rm", "--platform", "linux/amd64", "-v", f"{TAURI}:/src:ro",
         "-v", f"{LINUX_VOLUME}:/target", "-v", f"{out_dir}:/out", LINUX_IMAGE, "bash", "-c", script])
    binary = out_dir / BINARY
    if not binary.is_file():
        sys.exit("Binaire Linux introuvable après compilation.")
    return binary


LAUNCHER = """#!/bin/sh
# Lanceur de Chambre noire (version portable).
cd "$(dirname "$(readlink -f "$0")")" || exit 1
exec ./chambre-noire "$@"
"""


def write_tar(archive: Path, top: str, binary: Path, resources: Path, readme: str) -> None:
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.unlink(missing_ok=True)

    def add_bytes(tf: tarfile.TarFile, name: str, data: bytes, mode: int) -> None:
        import io

        info = tarfile.TarInfo(f"{top}/{name}")
        info.size, info.mode, info.mtime = len(data), mode, int(time.time())
        tf.addfile(info, io.BytesIO(data))

    with tarfile.open(archive, "w:gz", compresslevel=6) as tf:
        tf.add(binary, f"{top}/{BINARY}", filter=lambda i: (setattr(i, "mode", 0o755), i)[1])
        add_bytes(tf, "chambre-noire.sh", LAUNCHER.encode(), 0o755)
        add_bytes(tf, "LISEZMOI.txt", readme.encode(), 0o644)
        for sub in ("backend", "frontend", "runtime"):
            tf.add(resources / sub, f"{top}/{sub}")


def case_sensitive_volume(name: str, size_gb: int) -> Path:
    """Volume APFS sensible à la casse (image sparse) monté sous /Volumes ; retourne son point de montage."""
    image = CROSS / f"{name}.sparseimage"
    mount = Path("/Volumes") / name
    if mount.exists():
        return mount
    CROSS.mkdir(parents=True, exist_ok=True)
    if not image.exists():
        run(["hdiutil", "create", "-size", f"{size_gb}g", "-type", "SPARSE", "-fs", "Case-sensitive APFS",
             "-volname", name, image.with_suffix("")], stdout=subprocess.DEVNULL)
    run(["hdiutil", "attach", image, "-nobrowse", "-quiet"])
    return mount


def detach_volume(name: str, delete_image: bool) -> None:
    mount = Path("/Volumes") / name
    if mount.exists():
        subprocess.run(["hdiutil", "detach", str(mount), "-force", "-quiet"], check=False)
    if delete_image:
        (CROSS / f"{name}.sparseimage").unlink(missing_ok=True)


def package_linux(profile_name: str, profile: dict, skip_runtime: bool, keep: bool) -> Path:
    vol_name = f"cn-{profile_name}"
    mount = case_sensitive_volume(vol_name, 22)
    resources = mount / "resources"
    try:
        if not skip_runtime:
            ensure_runtime(profile_name, resources)
        binary = build_shell_linux()
        top = f"Chambre-noire-{profile_name}"
        archive = DIST / f"{top}.tar.gz"
        log(f"Archive {archive.name}…")
        write_tar(archive, top, binary, resources, readme_text(profile_name, profile))
    finally:
        if not keep:
            detach_volume(vol_name, delete_image=True)
    return archive


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", required=True, choices=[n for n, p in PROFILES.items() if p["os"] in ("windows", "linux")])
    ap.add_argument("--skip-runtime", action="store_true", help="réutilise le runtime déjà assemblé")
    ap.add_argument("--keep-workdir", action="store_true", help="(Linux) garde le volume de travail monté")
    args = ap.parse_args()
    profile = PROFILES[args.profile]
    if sys.platform != "darwin":
        sys.exit("Ce script cross-construit depuis macOS ; sur Windows/Linux, utilisez build_runtime.py + tauri build.")

    archive = package_windows(args.profile, profile, args.skip_runtime) if profile["os"] == "windows" \
        else package_linux(args.profile, profile, args.skip_runtime, args.keep_workdir)

    digest = sha256(archive)
    (archive.parent / f"{archive.name}.sha256").write_text(f"{digest}  {archive.name}\n")
    print()
    log(f"Livrable : {archive}")
    print(f"  taille  {human(archive.stat().st_size)}\n  sha256  {digest}")


if __name__ == "__main__":
    main()
