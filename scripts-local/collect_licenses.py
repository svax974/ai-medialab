#!/usr/bin/env python3
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Collects the licence texts of everything the desktop installers redistribute, and gates the build on copyleft.

    python3 scripts-local/collect_licenses.py --bundle desktop/build/engine-bundle [--node-version 22.23.3]

Writes `<bundle>/licenses/` (copied into the app by `packaging.extraResources` of desktop/desktop.config.json):

    LICENSE, THIRD_PARTY_LICENSES.md     the project's own licence and the human-readable register
    python/<package>-<version>/...       licence files of the embedded Python packages (`*.dist-info`)
    python/CPython-LICENSE.txt           licence of the embedded interpreter
    npm/<package>@<version>.txt          licence file of each production dependency of back/ (from package-lock.json)
    node/LICENSE                         licence of the Node.js runtime (downloaded; a warning if the network is down)
    INDEX.tsv                            name, version, declared licence, source, for every collected package

The build FAILS (exit 1) when a redistributed package declares a strong copyleft licence (GPL, AGPL, SSPL) that is not in
ALLOWED_COPYLEFT. Weak copyleft (LGPL, MPL, EPL) and undeclared licences are reported as warnings. The packages the app
downloads on the user's machine (eSpeak-ng, the FFmpeg wheel, models) are not redistributed and not scanned here.
"""
from __future__ import annotations

import argparse
import email
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRONG = re.compile(r"\b(A?GPL|SSPL)\b", re.I)
WEAK = re.compile(r"\b(LGPL|MPL|EPL|CDDL)\b", re.I)
# Strong-copyleft packages knowingly redistributed (none today). A name added here needs a written justification.
ALLOWED_COPYLEFT: set[str] = set()
LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|notice|authors)([-_.].*)?$", re.I)


def licence_files(folder: Path) -> list[Path]:
    """Licence-like files of a package folder (top level, or `licenses/` for dist-info)."""
    found: list[Path] = []
    for base in (folder, folder / "licenses", folder / "license_files", folder / "LICENSES"):
        if base.is_dir():
            found += [p for p in sorted(base.iterdir()) if p.is_file() and LICENSE_FILE.match(p.name)]
    return found


def python_packages(site: Path) -> list[dict]:
    rows = []
    for dist in sorted(site.glob("*.dist-info")):
        meta = dist / "METADATA"
        if not meta.is_file():
            continue
        msg = email.message_from_string(meta.read_text(encoding="utf8", errors="replace"))
        declared = msg.get("License-Expression") or ""
        classifiers = [c.split("::")[-1].strip() for c in msg.get_all("Classifier", []) if c.startswith("License")]
        legacy = (msg.get("License") or "").split("\n")[0][:80] if len(msg.get("License") or "") < 200 else ""
        rows.append({
            "name": msg["Name"], "version": msg["Version"], "source": "python",
            "license": declared or legacy or "; ".join(classifiers),
            "files": licence_files(dist),
        })
    return rows


def npm_packages(back: Path) -> list[dict]:
    """Production dependencies of back/ according to package-lock.json (entries not flagged dev)."""
    lock = json.loads((back / "package-lock.json").read_text(encoding="utf8"))
    rows = []
    for key, entry in lock.get("packages", {}).items():
        if not key or entry.get("dev") or entry.get("devOptional"):
            continue
        folder = back / key
        pkg = folder / "package.json"
        if not pkg.is_file():
            continue  # optional platform package not installed on this machine
        data = json.loads(pkg.read_text(encoding="utf8"))
        declared = data.get("license") or entry.get("license") or ""
        if isinstance(declared, dict):
            declared = declared.get("type", "")
        rows.append({"name": data["name"], "version": data["version"], "source": "npm",
                     "license": declared, "files": licence_files(folder)})
    return rows


def classify(rows: list[dict]) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    for r in rows:
        label = f"{r['source']}:{r['name']}@{r['version']}"
        lic = r["license"]
        if STRONG.search(lic) and not re.search(r"\bLGPL\b", lic) and r["name"] not in ALLOWED_COPYLEFT:
            errors.append(f"{label} declares {lic!r} (strong copyleft)")
        elif WEAK.search(lic):
            warnings.append(f"{label} declares {lic!r} (weak copyleft: keep unmodified, ship its text)")
        elif not lic:
            warnings.append(f"{label} declares no licence")
        if not r["files"]:
            warnings.append(f"{label} ships no licence file")
    return errors, warnings


def copy_files(rows: list[dict], out: Path) -> None:
    for r in rows:
        if r["source"] == "python":
            dest = out / "python" / f"{r['name']}-{r['version']}"
            for f in r["files"]:
                dest.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest / f.name)
        else:
            safe = r["name"].replace("/", "__")
            text = "\n\n".join(f"--- {f.name} ---\n{f.read_text(encoding='utf8', errors='replace')}" for f in r["files"])
            if not text and r["license"]:  # no licence file shipped: keep the licence the package declares
                text = f"{r['name']} {r['version']}\nDeclared licence (package.json): {r['license']}\n"
            if text:
                (out / "npm").mkdir(parents=True, exist_ok=True)
                (out / "npm" / f"{safe}@{r['version']}.txt").write_text(text, encoding="utf8")


def add_runtime_licences(bundle: Path, out: Path, node_version: str | None) -> list[str]:
    warnings = []
    stdlib = sorted((bundle / "engine-runtime" / "python").glob("lib/python3*/LICENSE.txt"))
    if stdlib:
        shutil.copy2(stdlib[0], out / "python" / "CPython-LICENSE.txt")
    else:
        warnings.append("CPython LICENSE.txt not found in the embedded interpreter")
    if node_version:
        url = f"https://raw.githubusercontent.com/nodejs/node/v{node_version}/LICENSE"
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                (out / "node").mkdir(parents=True, exist_ok=True)
                (out / "node" / "LICENSE").write_bytes(resp.read())
        except OSError as exc:
            warnings.append(f"Node.js LICENSE not downloaded ({exc}); add {url} by hand before publishing")
    return warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bundle", type=Path, default=ROOT / "desktop/build/engine-bundle")
    parser.add_argument("--back", type=Path, default=ROOT / "back")
    parser.add_argument("--node-version", help="download the Node.js LICENSE of this version")
    parser.add_argument("--check-only", action="store_true", help="scan and report, write nothing")
    args = parser.parse_args()

    rows = python_packages(args.bundle / "engine-runtime" / "site-packages") + npm_packages(args.back)
    errors, warnings = classify(rows)

    if not args.check_only:
        out = args.bundle / "licenses"
        shutil.rmtree(out, ignore_errors=True)
        (out / "python").mkdir(parents=True)
        for name in ("LICENSE", "THIRD_PARTY_LICENSES.md"):
            shutil.copy2(ROOT / name, out / name)
        copy_files(rows, out)
        warnings += add_runtime_licences(args.bundle, out, args.node_version)
        index = "\n".join(f"{r['name']}\t{r['version']}\t{r['license']}\t{r['source']}" for r in rows)
        (out / "INDEX.tsv").write_text("name\tversion\tlicense\tsource\n" + index + "\n", encoding="utf8")

    print(f"[licenses] {len(rows)} packages scanned ({sum(r['source'] == 'python' for r in rows)} python, "
          f"{sum(r['source'] == 'npm' for r in rows)} npm)")
    for w in warnings:
        print(f"[licenses] warning: {w}")
    for e in errors:
        print(f"[licenses] ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
