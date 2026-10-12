#!/usr/bin/env python3
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Assembles the desktop app's bundled resources for one runtime profile.

    python3 scripts/build_runtime.py --profile mac-arm64 --out desktop/build/resources

Output layout (what backend/app/config.py and the Tauri shell expect):

    <out>/backend/app/...            server code
    <out>/frontend/dist/...          built UI
    <out>/runtime/python/...         python-build-standalone interpreter (relocatable)
    <out>/runtime/site-packages/...  profile dependencies (uv pip install --target)

Profiles (pip index, extras, torch versions) live in desktop/runtime/profiles.json.
Requires uv, network access (Python and wheel downloads), and npm if the UI is not already built.

Cross-building: a profile whose OS differs from the host's (e.g. win-cuda / linux-cuda from a Mac) is assembled
without running anything from the target. The target's python-build-standalone interpreter is downloaded
(SHA-256 checked against the release's official list), the target wheels are installed with
`uv pip install --python-platform`, and bytecode is compiled with a host Python 3.12 (same magic number).
No smoke test is possible, so we only check statically that the key files are present.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
PROFILES_FILE = DESKTOP / "runtime" / "profiles.json"
IS_WINDOWS = sys.platform == "win32"

# python-build-standalone: version and release pinned for cross-building (same 3.12 as `uv python install`).
PBS_RELEASE = "20260510"
PBS_VERSION = "3.12.13"
PBS_TRIPLES = {"windows": "x86_64-pc-windows-msvc", "linux": "x86_64-unknown-linux-gnu"}
# Wheel platforms for `uv pip install --python-platform`.
UV_PLATFORMS = {"windows": "x86_64-pc-windows-msvc", "linux": "x86_64-manylinux_2_28"}

# Test folders stripped from bundled packages (never imported at runtime).
PRUNE_DIR_NAMES = {"tests", "test", "testing_utils", "__pycache__"}
# Big torch folders not needed at runtime (C++ headers, CMake).
PRUNE_PATHS = ["torch/include", "torch/share/cmake"]  # torch/bin (torch_shm_manager) is required
# Parts of the stdlib we don't need.
PRUNE_STDLIB = ["test", "idlelib", "tkinter", "turtledemo", "ensurepip/_bundled"]


def log(msg: str) -> None:
    print(f"\033[1;33m›\033[0m {msg}", flush=True)


def run(cmd: list[str | Path], **kw) -> None:
    print("  $", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def du(path: Path) -> int:
    total = 0
    for p in path.rglob("*"):
        if p.is_file() and not p.is_symlink():
            total += p.stat().st_size
    return total


def human(n: float) -> str:
    for unit in ("o", "Ko", "Mo", "Go"):
        if n < 1024 or unit == "Go":
            return f"{n:.1f} {unit}" if unit != "o" else f"{int(n)} o"
        n /= 1024
    return ""


def host_os() -> str:
    return {"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux")


def py_rel(target_os: str) -> str:
    """Interpreter path inside runtime/python, based on the TARGET OS."""
    return "python.exe" if target_os == "windows" else "bin/python3"


# --- Steps ---

def ensure_frontend(force: bool) -> Path:
    dist = ROOT / "frontend" / "dist"
    if force or not (dist / "index.html").is_file():
        log("Compilation de l'interface…")
        fe = ROOT / "frontend"
        npm = shutil.which("npm") or "npm"  # npm.cmd on Windows
        if not (fe / "node_modules").is_dir():
            run([npm, "install", "--silent"], cwd=fe)
        run([npm, "run", "build", "--silent"], cwd=fe)
    return dist


def copy_backend(out: Path) -> None:
    log("Copie du backend…")
    shutil.copytree(
        ROOT / "backend" / "app",
        out / "backend" / "app",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "tests", "test"),
    )


def download_verified(url: str, sums_url: str, filename: str, dest_dir: Path) -> Path:
    """Downloads an archive (untrusted data) into its own folder and checks its SHA-256 against the official list."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    sums = urllib.request.urlopen(sums_url, timeout=60).read().decode()
    expected = next((line.split()[0] for line in sums.splitlines() if line.strip().endswith(filename)), None)
    if not expected:
        sys.exit(f"{filename} absent de {sums_url}")
    path = dest_dir / filename
    if not path.exists():
        log(f"Téléchargement de {filename}…")
        with urllib.request.urlopen(url, timeout=120) as resp, path.open("wb") as f:
            shutil.copyfileobj(resp, f)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        path.unlink()
        sys.exit(f"SHA-256 invalide pour {filename} : {digest} ≠ {expected}")
    print(f"  SHA-256 vérifié : {digest}")
    return path


def install_python_cross(target_os: str, version: str, cache: Path, out: Path) -> Path:
    if version != PBS_VERSION[: len(version)]:
        sys.exit(f"Cross-construction : Python {version} non épinglé (disponible : {PBS_VERSION}).")
    triple = PBS_TRIPLES[target_os]
    filename = f"cpython-{PBS_VERSION}+{PBS_RELEASE}-{triple}-install_only_stripped.tar.gz"
    base = f"https://github.com/astral-sh/python-build-standalone/releases/download/{PBS_RELEASE}"
    archive = download_verified(f"{base}/{filename.replace('+', '%2B')}", f"{base}/SHA256SUMS", filename, cache / triple)
    dest = out / "runtime" / "python"
    with tempfile.TemporaryDirectory(dir=cache) as tmp:
        with tarfile.open(archive) as tf:
            tf.extractall(tmp, filter="data")  # rejects absolute paths, escaping links, special files
        shutil.copytree(Path(tmp) / "python", dest, symlinks=True)
    return dest / py_rel(target_os)


def install_python(version: str, cache: Path, out: Path, target_os: str | None = None) -> Path:
    if target_os and target_os != host_os():
        log(f"Python {version} de la cible {target_os} (python-build-standalone, SHA-256 vérifié)…")
        return install_python_cross(target_os, version, cache, out)
    log(f"Python {version} embarquable (python-build-standalone via uv)…")
    cache.mkdir(parents=True, exist_ok=True)
    run(["uv", "python", "install", version, "--install-dir", cache])
    candidates = sorted(
        (p for p in cache.glob(f"cpython-{version}.*") if p.is_dir() and not p.is_symlink()),
        key=lambda p: p.name,
    )
    if not candidates:
        sys.exit(f"Python {version} introuvable dans {cache}")
    src = candidates[-1]
    dest = out / "runtime" / "python"
    shutil.copytree(src, dest, symlinks=True)
    for rel in ("EXTERNALLY-MANAGED", "lib/python{v}/EXTERNALLY-MANAGED"):
        f = dest / rel.format(v=version)
        if f.exists():
            f.unlink()
    return dest / ("python.exe" if IS_WINDOWS else "bin/python3")


def copy_engines(out: Path, profile: dict, build: Path) -> None:
    """Bundles the profile's stable-diffusion.cpp (GGUF engine) binaries into <out>/engines/sdcpp/<variant>/.

    Not in the repo: they are downloaded from the official release (SHA-256 checked,
    see scripts/fetch_sdcpp.py). For a cross-build they go to a build cache."""
    variants = profile.get("sdcpp_variants", [])
    (out / "engines").mkdir(parents=True, exist_ok=True)  # the shell always declares this resource folder
    if not variants:
        return
    log(f"Moteur GGUF (stable-diffusion.cpp) : {', '.join(variants)}…")
    exe = "sd-cli.exe" if profile["os"] == "windows" else "sd-cli"
    base = ROOT / "engines" / "sdcpp" if profile["os"] == host_os() else build / "sdcpp-cache" / profile["os"]
    for v in variants:
        src = base / v
        if not (src / exe).is_file():
            run([sys.executable, ROOT / "scripts" / "fetch_sdcpp.py", "--variant", v, "--os", profile["os"],
                 "--dest", base])
        shutil.copytree(src, out / "engines" / "sdcpp" / v, dirs_exist_ok=True)


def prune_stdlib(py_root: Path, version: str, target_os: str | None = None) -> None:
    windows = (target_os or host_os()) == "windows"
    lib = py_root / ("Lib" if windows else f"lib/python{version}")
    for rel in PRUNE_STDLIB:
        shutil.rmtree(lib / rel, ignore_errors=True)
    for rel in ("share", "include", "lib/tcl9.0", "lib/tk9.0", "lib/tcl8.6", "lib/tk8.6", "tcl", "Doc", "include"):
        shutil.rmtree(py_root / rel, ignore_errors=True)
    for pat in ("bin/idle3*", "bin/pydoc3*", "bin/2to3*", "bin/pip*"):
        for f in py_root.glob(pat):
            f.unlink(missing_ok=True)


def read_requirements(profile: dict) -> list[str]:
    """Base dependencies + profile extras (from backend/pyproject.toml) + profile pins."""
    project = tomllib.loads((ROOT / "backend" / "pyproject.toml").read_text())["project"]
    reqs = list(project.get("dependencies", []))
    optional = project.get("optional-dependencies", {})
    for extra in profile.get("extras", []):
        reqs += optional[extra]
    reqs += profile.get("requirements", [])
    return reqs


def install_dependencies(py: Path, profile: dict, out: Path, build: Path, cross: bool = False) -> Path:
    site = out / "runtime" / "site-packages"
    site.mkdir(parents=True, exist_ok=True)
    reqs = read_requirements(profile)
    req_file = build / f"requirements-{profile['name']}.txt"
    req_file.write_text("\n".join(reqs) + "\n")
    log(f"Installation de {len(reqs)} dépendances directes dans runtime/site-packages…")
    if cross:
        # Target-platform wheels, nothing executed. No sdist builds (--no-build): a dependency with no
        # wheel for the target fails the install instead of producing a host binary.
        cmd: list[str | Path] = [
            "uv", "pip", "install", "--python-platform", UV_PLATFORMS[profile["os"]],
            "--python-version", profile["python"], "--target", site, "-r", req_file,
            "--link-mode", "copy", "--no-build",
        ]
    else:
        cmd = [
            "uv", "pip", "install", "--python", py, "--target", site, "-r", req_file,
            "--link-mode", "copy", "--compile-bytecode",
        ]
    if profile.get("index_url"):
        cmd += ["--default-index", profile["index_url"]]
    for url in profile.get("extra_index_urls", []):
        cmd += ["--extra-index-url", url]
    if profile.get("extra_index_urls"):
        # GPU wheels (+cuXXX / +rocmX) are only published on the PyTorch index.
        cmd += ["--index-strategy", "unsafe-best-match"]
    run(cmd)
    return site


def prune_site_packages(site: Path) -> None:
    log("Allègement de site-packages (tests, en-têtes, bytecode obsolète)…")
    before = du(site)
    for rel in PRUNE_PATHS:
        shutil.rmtree(site / rel, ignore_errors=True)
    for lib in site.glob("torch/lib/*.lib"):  # Windows import libraries, not needed at runtime
        lib.unlink(missing_ok=True)
    for d in sorted((p for p in site.rglob("*") if p.is_dir() and p.name in PRUNE_DIR_NAMES), reverse=True):
        shutil.rmtree(d, ignore_errors=True)
    for rec in site.glob("*.dist-info/RECORD"):
        rec.unlink(missing_ok=True)
    print(f"  {human(before)} → {human(du(site))}")


def compile_bytecode(py: Path, *dirs: Path) -> None:
    """Precompiles with the bundled interpreter (right magic number). unchecked-hash because the app is frozen
    and runs with PYTHONDONTWRITEBYTECODE=1, so the .pyc files must never depend on timestamps."""
    log("Pré-compilation du bytecode…")
    for d in dirs:
        run([py, "-m", "compileall", "-q", "-j", "0", "--invalidation-mode", "unchecked-hash", d])


def host_python(version: str) -> Path:
    """Host Python 3.12, used to precompile bytecode for a foreign target (the magic number only depends on the version)."""
    found = subprocess.run(["uv", "python", "find", version], capture_output=True, text=True)
    if found.returncode != 0 or not found.stdout.strip():
        sys.exit(f"Python {version} introuvable sur l'hôte (uv python install {version}).")
    return Path(found.stdout.strip())


def static_check(out: Path, profile: dict) -> None:
    """Static check of a cross-built runtime (nothing is executed)."""
    log("Contrôle statique du runtime cross-construit…")
    rt = out / "runtime"
    site = rt / "site-packages"
    windows = profile["os"] == "windows"
    required = [
        rt / "python" / py_rel(profile["os"]),
        out / "backend" / "app" / "main.py",
        out / "frontend" / "dist" / "index.html",
        site / "fastapi" / "__init__.py", site / "uvicorn" / "__init__.py", site / "PIL" / "__init__.py",
        site / "huggingface_hub" / "__init__.py", site / "psutil" / "__init__.py", site / "av" / "__init__.py",
    ]
    if "torch" in profile["extras"]:
        required += [site / "torch" / "__init__.py", site / "diffusers" / "__init__.py", site / "transformers" / "__init__.py"]
        if windows:
            required += [rt / "python" / "python312.dll", site / "torch" / "lib" / "c10.dll", site / "torch" / "lib" / "torch_cpu.dll"]
        else:
            required += [site / "torch" / "lib" / "libtorch_cpu.so", site / "torch" / "lib" / "libc10.so"]
    missing = [str(p.relative_to(out)) for p in required if not p.exists()]
    if missing:
        sys.exit("Fichiers manquants : " + ", ".join(missing))
    # No host binary may have slipped into the target wheels.
    foreign = [p for p in site.rglob("*") if p.is_file() and not p.is_symlink() and is_macho(p)][:3]
    if foreign:
        sys.exit("Binaires étrangers à la cible : " + ", ".join(str(p) for p in foreign))
    cuda = sorted(p.name for p in (site / "torch" / "lib").glob("cudart64_*.dll")) if windows else sorted(
        str(p.relative_to(site)) for p in site.glob("nvidia/cuda_runtime/lib/libcudart.so*"))
    print("  fichiers clés présents ; runtime CUDA :", cuda or "—")


def is_macho(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            magic = f.read(4)
    except OSError:
        return False
    return magic in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xcf")


def adhoc_sign_macos(runtime: Path) -> None:
    """On Apple Silicon every Mach-O binary must carry at least a valid ad-hoc signature."""
    log("Vérification / signature ad hoc des binaires Mach-O…")
    candidates = [
        p for p in runtime.rglob("*")
        if p.is_file() and not p.is_symlink() and (p.suffix in {".so", ".dylib"} or os.access(p, os.X_OK)) and is_macho(p)
    ]

    def fix(p: Path) -> bool:
        ok = subprocess.run(["codesign", "--verify", str(p)], capture_output=True).returncode == 0
        if ok:
            return False
        subprocess.run(["codesign", "--force", "--sign", "-", str(p)], check=True, capture_output=True)
        return True

    with concurrent.futures.ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        resigned = sum(ex.map(fix, candidates))
    print(f"  {len(candidates)} binaires Mach-O, {resigned} re-signés (ad hoc)")


def smoke_test(py: Path, runtime: Path, out: Path, profile: dict) -> None:
    log("Test de fumée de l'environnement embarqué…")
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(runtime / "site-packages"), str(out / "backend")]),
        "PYTHONDONTWRITEBYTECODE": "1",
        "IMAGEGEN_DATA_DIR": str(out.parent / "smoke-data"),
    }
    env.pop("VIRTUAL_ENV", None)
    code = (
        "import app.main, uvicorn, fastapi, PIL, huggingface_hub, psutil, av;"
        "print('backend importé');"
        + ("import mlx.core, mflux;print('mlx', mlx.core.__version__ if hasattr(mlx.core,'__version__') else 'ok');" if "mlx" in profile["extras"] else "")
        + ("import torch, diffusers, transformers, gguf;print('torch', torch.__version__, 'diffusers', diffusers.__version__);" if "torch" in profile["extras"] else "")
    )
    run([py, "-I", "-c", "import sys;sys.path[:0]=%r;exec(%r)" % (env["PYTHONPATH"].split(os.pathsep), code)], env=env)
    shutil.rmtree(out.parent / "smoke-data", ignore_errors=True)


# --- Main ---

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    profiles = json.loads(PROFILES_FILE.read_text())["profiles"]
    ap.add_argument("--profile", required=True, choices=sorted(profiles))
    ap.add_argument("--out", default=str(DESKTOP / "build" / "resources"))
    ap.add_argument("--build-frontend", action="store_true", help="recompile l'interface même si dist/ existe")
    ap.add_argument("--skip-smoke", action="store_true")
    ap.add_argument(
        "--refresh-app",
        action="store_true",
        help="ne recopie que backend/ et frontend/dist (+ bytecode) dans un dossier déjà assemblé : "
        "quelques secondes au lieu de réinstaller Python et les dépendances",
    )
    args = ap.parse_args()

    profile = {"name": args.profile, **profiles[args.profile]}
    cross = profile["os"] != host_os()
    if cross and profile["os"] == "macos":
        sys.exit("Le profil macOS ne se construit que sur un Mac Apple Silicon.")
    if cross and profile["arch"] != "x86_64":
        sys.exit(f"Cross-construction limitée à x86_64 (profil : {profile['arch']}).")
    if profile["os"] == "macos" and platform.machine() != "arm64":
        sys.exit("Le profil mac-arm64 doit être construit sur Apple Silicon.")
    if cross:
        log(f"CROSS-CONSTRUCTION {host_os()} → {profile['os']} : rien n'est exécuté ; exécution non vérifiée sur le matériel cible.")
    if profile.get("status") != "verified":
        log(f"Profil {profile['status'].upper()} : {profile.get('notes', '')}")

    out = Path(args.out).resolve()
    build = out.parent
    if args.refresh_app:
        py = out / "runtime" / "python" / py_rel(profile["os"])
        if not py.is_file():
            sys.exit(f"{out} n'est pas assemblé : lancez d'abord sans --refresh-app.")
        dist = ensure_frontend(args.build_frontend)
        for sub in ("backend", "frontend"):
            shutil.rmtree(out / sub, ignore_errors=True)
        shutil.copytree(dist, out / "frontend" / "dist")
        copy_backend(out)
        shutil.rmtree(out / "engines", ignore_errors=True)
        copy_engines(out, profile, build)
        compile_bytecode(host_python(profile["python"]) if cross else py, out / "backend")
        if not args.skip_smoke:
            static_check(out, profile) if cross else smoke_test(py, out / "runtime", out, profile)
        log("Backend et interface rafraîchis.")
        return
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    dist = ensure_frontend(args.build_frontend)
    log("Copie de l'interface…")
    shutil.copytree(dist, out / "frontend" / "dist")
    copy_backend(out)
    copy_engines(out, profile, build)

    py = install_python(profile["python"], build / "python-cache", out, profile["os"])
    prune_stdlib(out / "runtime" / "python", profile["python"], profile["os"])
    site = install_dependencies(py, profile, out, build, cross)
    prune_site_packages(site)
    compile_bytecode(host_python(profile["python"]) if cross else py, site, out / "backend")
    if profile["os"] == "macos":
        adhoc_sign_macos(out / "runtime")
        if (out / "engines").is_dir():
            adhoc_sign_macos(out / "engines")
    if not args.skip_smoke:
        static_check(out, profile) if cross else smoke_test(py, out / "runtime", out, profile)

    print()
    log(f"Ressources prêtes : {out}")
    for part in ("runtime/python", "runtime/site-packages", "engines", "backend", "frontend"):
        if (out / part).exists():
            print(f"  {part:24s} {human(du(out / part))}")
    print(f"  {'TOTAL':24s} {human(du(out))}")


if __name__ == "__main__":
    main()
