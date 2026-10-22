#!/usr/bin/env python3
# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Periodic review of the third-party components the app integrates (see docs/components/README.md).

    engine/.venv/bin/python scripts-local/review_components.py            # report only, changes nothing
    engine/.venv/bin/python scripts-local/review_components.py --snapshot # also refresh docs/components/audiocpp-families.json

For each component (native engines, Python libraries of the audio packs, the web stack of front/ and back/, Tauri): what the app pins, the latest upstream version, and (audio.cpp) which model families are new,
changed status or changed licence since the last snapshot. Needs network access; `GITHUB_TOKEN` lifts the GitHub
rate limit. Read-only on the app: the only file it writes is the snapshot, and only with --snapshot.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

from app import audio_packs, audiocpp, engine_install  # noqa: E402

# Web stack tracked by the review: package.json of the workspace -> packages (the range is read from the file, never copied).
NPM = {"front": ["@mui/material", "@mui/icons-material", "@emotion/react", "@emotion/styled", "@tanstack/react-query",
                 "zustand", "@fontsource-variable/hanken-grotesk", "@fontsource-variable/jetbrains-mono",
                 "@fontsource/instrument-serif", "react", "vite"],
       "back": ["@nestjs/core", "@nestjs/typeorm", "typeorm", "better-sqlite3", "openapi-typescript"]}

SNAPSHOT = ROOT / "docs" / "components" / "audiocpp-families.json"
# PyPI libraries of the audio packs: the pin is read from the pack definitions, never copied here.
PYPI = {"qwen-tts": "qwen3", "pocket-tts": "speech", "kokoro": "speech", "faster-whisper": "speech",
        "mlx-whisper": "speech", "soundfile": "speech"}


def get_json(url: str) -> Any:
    return engine_install._http_json(url)


def pinned_requirement(package: str, pack_id: str) -> str:
    pack = audio_packs.PACKS[pack_id]
    for req in (*pack.requirements, *pack.apple_requirements):
        if re.match(rf"{re.escape(package)}(?![\w-])", req):
            return req
    return "?"


def latest_pypi(package: str) -> str:
    return get_json(f"https://pypi.org/pypi/{package}/json")["info"]["version"]


def latest_release(repo: str) -> dict[str, Any]:
    return get_json(f"https://api.github.com/repos/{repo}/releases/latest")


def audiocpp_families(tag: str) -> dict[str, dict[str, Any]]:
    """Families of an audio.cpp release, from its `model_specs/*.json` and `docs/model_licenses.md`."""
    raw = f"https://raw.githubusercontent.com/{audiocpp.REPO}/{tag}"
    listing = get_json(f"https://api.github.com/repos/{audiocpp.REPO}/contents/model_specs?ref={tag}")
    lic: dict[str, tuple[str, str]] = {}
    text = urllib.request.urlopen(f"{raw}/docs/model_licenses.md", timeout=30).read().decode()
    for line in text.splitlines():
        m = re.match(r"\| `(\w+)` \| (.*?) \| (.*?) \| (Yes|No|Conditional|Unclear) \|", line)
        if m:
            lic.setdefault(m[1], (re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", m[3]), m[4]))
    out: dict[str, dict[str, Any]] = {}
    for item in listing:
        if not item["name"].endswith(".json"):
            continue
        d = json.load(urllib.request.urlopen(item["download_url"], timeout=30))
        license_, commercial = lic.get(d["family"], ("?", "?"))
        out[d["family"]] = {"name": d["display_name"], "category": d["category"], "status": d["status"],
                            "tasks": d["tasks"], "languages": d["languages"][:40], "license": license_,
                            "commercial": commercial}
    return out


def npm_requirement(workspace: str, package: str) -> str:
    """The range pinned by `<workspace>/package.json` (dependencies or devDependencies)."""
    data = json.loads((ROOT / workspace / "package.json").read_text())
    return {**data.get("devDependencies", {}), **data.get("dependencies", {})}.get(package, "?")


def latest_npm(package: str) -> str:
    return get_json(f"https://registry.npmjs.org/{package.replace('/', '%2F')}/latest")["version"]


def tauri_requirement() -> str:
    text = (ROOT / "desktop" / "src-tauri" / "Cargo.toml").read_text()
    m = re.search(r'^tauri\s*=\s*(?:\{[^}]*version\s*=\s*)?"([^"]+)"', text, re.M)
    return m[1] if m else "?"


def latest_crate(name: str) -> str:
    req = urllib.request.Request(f"https://crates.io/api/v1/crates/{name}", headers={"User-Agent": "ai-medialab-review"})
    return json.load(urllib.request.urlopen(req, timeout=30))["crate"]["max_stable_version"]


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ai-medialab-review"})
    return urllib.request.urlopen(req, timeout=60).read().decode()


def pytorch_index(index: str) -> dict[str, str]:
    """Latest torch version per platform on one pytorch.org wheel index (`rocm7.2`, `xpu`...)."""
    html = fetch_text(f"https://download.pytorch.org/whl/{index}/torch/")
    found: dict[str, str] = {}
    for platform, tag in (("Linux", "(?:manylinux[0-9_]*|linux)_x86_64"), ("Windows", "win_amd64")):
        versions = re.findall(rf"torch-(\d+(?:\.\d+)+)%2B[a-z0-9.]+-cp3\d+-cp3\d+t?-{tag}", html)
        found[platform] = max(versions, key=lambda v: tuple(map(int, v.split(".")))) if versions else "aucune"
    return found


def latest_rocm_index() -> str:
    html = fetch_text("https://download.pytorch.org/whl/")
    versions = sorted(set(re.findall(r"rocm(\d+(?:\.\d+)+)", html)), key=lambda v: tuple(map(int, v.split("."))))
    return f"rocm{versions[-1]}"


def diff_families(old: dict[str, Any], new: dict[str, Any]) -> list[str]:
    lines = []
    for fam in sorted(new.keys() - old.keys()):
        n = new[fam]
        lines.append(f"  + nouvelle famille  {fam:<22} {n['category']:<12} {n['status']:<12} {n['license']} (commercial : {n['commercial']})")
    for fam in sorted(old.keys() - new.keys()):
        lines.append(f"  - retirée           {fam}")
    for fam in sorted(old.keys() & new.keys()):
        for key in ("status", "license", "commercial"):
            if old[fam].get(key) != new[fam].get(key):
                lines.append(f"  ~ {fam:<22} {key} : {old[fam].get(key)} -> {new[fam].get(key)}")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--snapshot", action="store_true", help="rewrite the audio.cpp families snapshot")
    args = ap.parse_args()

    print("== Moteurs natifs")
    for name, repo, pinned in (("stable-diffusion.cpp", engine_install.REPO, engine_install.PINNED_TAG),
                               ("audio.cpp", audiocpp.REPO, audiocpp.PINNED_TAG)):
        rel = latest_release(repo)
        flag = "à jour" if rel["tag_name"] == pinned else "NOUVELLE VERSION"
        print(f"  {name:<22} épinglé {pinned:<22} dernière {rel['tag_name']:<22} {rel['published_at'][:10]}  {flag}")

    print("== Bibliothèques Python des packs audio")
    for package, pack_id in PYPI.items():
        try:
            print(f"  {package:<16} épinglé {pinned_requirement(package, pack_id):<22} dernière {latest_pypi(package)}")
        except Exception as exc:  # noqa: BLE001
            print(f"  {package:<16} {exc}")

    print("== Pile web (package.json de front/ et back/, Cargo.toml du bureau)")
    for workspace, packages in NPM.items():
        for package in packages:
            try:
                print(f"  {workspace:<5} {package:<38} épinglé {npm_requirement(workspace, package):<10} dernière {latest_npm(package)}")
            except Exception as exc:  # noqa: BLE001
                print(f"  {workspace:<5} {package:<38} {exc}")
    try:
        print(f"  bureau {'tauri':<37} épinglé {tauri_requirement():<10} dernière {latest_crate('tauri')}")
    except Exception as exc:  # noqa: BLE001
        print(f"  bureau tauri {exc}")

    print("== Accélération PyTorch des packs audio (voir docs/components/pytorch-gpu.md)")
    for index in (latest_rocm_index(), "xpu"):
        try:
            per_os = pytorch_index(index)
            note = ""
            if index.startswith("rocm") and per_os["Windows"] != "aucune":
                note = "  <-- ROCm Windows sur pytorch.org : revoir torch_acceleration()"
            print(f"  index {index:<9} Linux {per_os['Linux']:<8} Windows {per_os['Windows']:<8}{note}")
        except Exception as exc:  # noqa: BLE001
            print(f"  index {index:<9} {exc}")

    print("== Familles de modèles d'audio.cpp (depuis le dernier instantané)")
    latest = latest_release(audiocpp.REPO)["tag_name"]
    new = audiocpp_families(latest)
    old = json.loads(SNAPSHOT.read_text())
    changes = diff_families(old["families"], new)
    print(f"  instantané {old['release']} ({old['captured']}) : {len(old['families'])} familles ; amont {latest} : {len(new)}")
    print("\n".join(changes) or "  aucun changement")
    if args.snapshot:
        from datetime import date

        SNAPSHOT.write_text(json.dumps({"release": latest, "captured": date.today().isoformat(), "families": new},
                                       ensure_ascii=False, indent=1, sort_keys=True))
        print(f"  instantané mis à jour : {SNAPSHOT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
