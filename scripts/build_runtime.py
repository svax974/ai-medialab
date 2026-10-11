#!/usr/bin/env python3
"""Assemble les ressources embarquées de l'application de bureau pour un profil d'exécution.

    python3 scripts/build_runtime.py --profile mac-arm64 --out desktop/build/resources

Structure produite (celle attendue par backend/app/config.py et par la coque Tauri) :

    <out>/backend/app/...            code du serveur
    <out>/frontend/dist/...          interface compilée
    <out>/runtime/python/...         interpréteur python-build-standalone (relocatable)
    <out>/runtime/site-packages/...  dépendances du profil (uv pip install --target)

Les profils (index pip, extras, versions de torch) sont dans desktop/runtime/profiles.json.
Prérequis : uv, accès réseau (téléchargement de Python et des roues), npm (si l'interface n'est pas déjà compilée).

Cross-construction : un profil dont l'OS n'est pas celui de l'hôte (ex. win-cuda / linux-cuda depuis un Mac) est assemblé
sans rien exécuter de la cible : l'interpréteur python-build-standalone de la cible est téléchargé (SHA-256 vérifié contre
la liste officielle de la release), les roues de la cible sont installées par `uv pip install --python-platform`, et le
bytecode est compilé avec un Python 3.12 de l'hôte (même numéro magique). Aucun test de fumée n'est possible : on contrôle
statiquement la présence des fichiers clés.
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

# python-build-standalone : version et release épinglées pour la cross-construction (même 3.12 que `uv python install`).
PBS_RELEASE = "20260510"
PBS_VERSION = "3.12.13"
PBS_TRIPLES = {"windows": "x86_64-pc-windows-msvc", "linux": "x86_64-unknown-linux-gnu"}
# Plateformes de roues pour `uv pip install --python-platform`.
UV_PLATFORMS = {"windows": "x86_64-pc-windows-msvc", "linux": "x86_64-manylinux_2_28"}

# Dossiers de tests supprimés des paquets embarqués (jamais importés à l'exécution).
PRUNE_DIR_NAMES = {"tests", "test", "testing_utils", "__pycache__"}
# Gros dossiers de torch inutiles à l'exécution (en-têtes C++, CMake).
PRUNE_PATHS = ["torch/include", "torch/share/cmake"]  # torch/bin (torch_shm_manager) est requis
# Parties de la bibliothèque standard inutiles ici.
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
    """Chemin de l'interpréteur dans runtime/python, selon l'OS CIBLE."""
    return "python.exe" if target_os == "windows" else "bin/python3"


# --- Étapes ----------------------------------------------------------------------------------------

def ensure_frontend(force: bool) -> Path:
    dist = ROOT / "frontend" / "dist"
    if force or not (dist / "index.html").is_file():
        log("Compilation de l'interface…")
        fe = ROOT / "frontend"
        npm = shutil.which("npm") or "npm"  # npm.cmd sous Windows
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
    """Télécharge une archive (donnée non fiable) dans un dossier dédié et vérifie son SHA-256 contre la liste officielle."""
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
            tf.extractall(tmp, filter="data")  # refuse chemins absolus, liens sortants, fichiers spéciaux
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
    """Embarque les binaires stable-diffusion.cpp (moteur GGUF) du profil dans <out>/engines/sdcpp/<variant>/.

    Absents du dépôt, ils sont téléchargés depuis la version officielle (somme SHA-256 vérifiée,
    voir scripts/fetch_sdcpp.py). Pour une cross-construction, ils vont dans un cache de build."""
    variants = profile.get("sdcpp_variants", [])
    (out / "engines").mkdir(parents=True, exist_ok=True)  # la coque déclare toujours ce dossier de ressources
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
    """Dépendances de base + extras du profil (depuis backend/pyproject.toml) + pins du profil."""
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
        # Roues de la plateforme cible, sans rien exécuter ; pas de compilation de sdist (--no-build) : une
        # dépendance sans roue pour la cible fait échouer l'installation au lieu de produire un binaire hôte.
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
        # Les roues GPU (+cuXXX / +rocmX) ne sont publiées que sur l'index PyTorch.
        cmd += ["--index-strategy", "unsafe-best-match"]
    run(cmd)
    return site


def prune_site_packages(site: Path) -> None:
    log("Allègement de site-packages (tests, en-têtes, bytecode obsolète)…")
    before = du(site)
    for rel in PRUNE_PATHS:
        shutil.rmtree(site / rel, ignore_errors=True)
    for lib in site.glob("torch/lib/*.lib"):  # bibliothèques d'import Windows : inutiles à l'exécution
        lib.unlink(missing_ok=True)
    for d in sorted((p for p in site.rglob("*") if p.is_dir() and p.name in PRUNE_DIR_NAMES), reverse=True):
        shutil.rmtree(d, ignore_errors=True)
    for rec in site.glob("*.dist-info/RECORD"):
        rec.unlink(missing_ok=True)
    print(f"  {human(before)} → {human(du(site))}")


def compile_bytecode(py: Path, *dirs: Path) -> None:
    """Pré-compile avec l'interpréteur embarqué (bon numéro magique). unchecked-hash : l'application est figée,
    et PYTHONDONTWRITEBYTECODE=1 à l'exécution — les .pyc ne doivent donc jamais dépendre des dates."""
    log("Pré-compilation du bytecode…")
    for d in dirs:
        run([py, "-m", "compileall", "-q", "-j", "0", "--invalidation-mode", "unchecked-hash", d])


def host_python(version: str) -> Path:
    """Python 3.12 de l'hôte, pour pré-compiler le bytecode d'une cible étrangère (le numéro magique ne dépend que de la version)."""
    found = subprocess.run(["uv", "python", "find", version], capture_output=True, text=True)
    if found.returncode != 0 or not found.stdout.strip():
        sys.exit(f"Python {version} introuvable sur l'hôte (uv python install {version}).")
    return Path(found.stdout.strip())


def static_check(out: Path, profile: dict) -> None:
    """Contrôle statique d'un runtime cross-construit (rien n'est exécuté)."""
    log("Contrôle statique du runtime cross-construit…")
    rt = out / "runtime"
    site = rt / "site-packages"
    windows = profile["os"] == "windows"
    required = [
        rt / "python" / py_rel(profile["os"]),
        out / "backend" / "app" / "main.py",
        out / "frontend" / "dist" / "index.html",
        site / "fastapi" / "__init__.py", site / "uvicorn" / "__init__.py", site / "PIL" / "__init__.py",
        site / "huggingface_hub" / "__init__.py", site / "psutil" / "__init__.py",
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
    # Aucun binaire de l'hôte ne doit s'être glissé dans les roues de la cible.
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
    """Sur Apple Silicon, tout binaire Mach-O doit porter au moins une signature ad hoc valide."""
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
        "import app.main, uvicorn, fastapi, PIL, huggingface_hub, psutil;"
        "print('backend importé');"
        + ("import mlx.core, mflux;print('mlx', mlx.core.__version__ if hasattr(mlx.core,'__version__') else 'ok');" if "mlx" in profile["extras"] else "")
        + ("import torch, diffusers, transformers;print('torch', torch.__version__, 'diffusers', diffusers.__version__);" if "torch" in profile["extras"] else "")
    )
    run([py, "-I", "-c", "import sys;sys.path[:0]=%r;exec(%r)" % (env["PYTHONPATH"].split(os.pathsep), code)], env=env)
    shutil.rmtree(out.parent / "smoke-data", ignore_errors=True)


# --- Programme -------------------------------------------------------------------------------------

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
