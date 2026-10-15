# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Update checks for the installed engines and models. Nothing is installed here: the check only reads.

Models (Hugging Face). The cache names every blob after the id the Hub gives the file (the SHA-256 of an LFS file, the
git blob id of a small one), and every snapshot file is a link to its blob. A remote file whose id differs from the
blob its local link points to has changed since the download: that is an update. Only the files the model downloads
(its sources' patterns) and already has count, so a commit that touches a README, or adds a variant the user did not
pick, is not an update. A cache that holds copies instead of links (no symlinks, Windows) is compared by size.

Engines. stable-diffusion.cpp and audio.cpp are pinned to the release the application was tested with
(`engine_install.PINNED_TAG`, `audiocpp.PINNED_TAG`): an installed build older than the pin is the recommended, tested
update (`state`); a build newer than the pin (installed as `latest`) is flagged `rollback`, to go back to the tested one. When upstream has a newer release than the installed one and the pin, the row also carries it as
`latest`, an untested update the user may choose anyway; it comes with the regressions the repository documents for that
build (`KNOWN_REGRESSIONS`). Nothing blocks the choice: the application only warns. A Python pack (isolated environment) is out of date when the dependencies the application pins for it
changed since it was installed (the hash in its `ready.json`). Dependencies the pack leaves unpinned (`>=`) cannot be
checked against their index and are not looked at.

The fast video decoders (`taehv.py`) are pinned by SHA-256 in the code: nothing to check.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import audio_packs, audiocpp, config, engine_install, runtime_settings, sdcpp
from .engines import MODELS, resolve, selected_variants
from .engines.base import HfSource, _matches, hf_hub_dir, installation_status, repo_cache_dir

GIB = 1024**3
MAX_PARALLEL = 6
# What the Hub lists for a repo: path -> (id of the file, size in bytes).
RemoteFiles = dict[str, tuple[str, int]]
# What the cache holds: path -> (id of the blob the link points to, or None for a plain copy; size in bytes).
LocalFiles = dict[str, tuple[str | None, int]]


# Known regressions ------------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Regression:
    """A defect of upstream builds that is written down in this repository (never a guess)."""

    engine: str  # engine id of the rows ("sdcpp")
    first: int  # first and last build number affected (`master-<number>-<hash>`), both included
    last: int
    effect: str  # French sentence shown in the warning
    source: str  # where the repository documents it


KNOWN_REGRESSIONS: tuple[Regression, ...] = (
    Regression("sdcpp", 864, 899, "Le gestionnaire de mémoire de stable-diffusion.cpp a régressé pour Wan 2.2 et LTX (issue #1976).",
               "engine/app/engine_install.py, commentaire de PINNED_TAG"),
)


def build_number(tag: str | None) -> int | None:
    """`master-956-1b0ba10` -> 956."""
    m = re.match(r"master-(\d+)", tag or "")
    return int(m.group(1)) if m else None


def regressions_for(engine_id: str, tag: str | None) -> list[dict[str, str]]:
    """The known regressions that touch a release of an engine."""
    number = build_number(tag)
    if number is None:
        return []
    return [{"effect": r.effect, "source": r.source} for r in KNOWN_REGRESSIONS
            if r.engine == engine_id and r.first <= number <= r.last]


def _order(tag: str | None) -> tuple[int, ...] | None:
    """Comparable form of a release tag: `master-956-...` or `v0.9.1`; None when it is neither."""
    if (n := build_number(tag)) is not None:
        return (n,)
    m = re.match(r"v?(\d+(?:\.\d+)*)", tag or "")
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def _newer(tag: str | None, than: str | None) -> bool:
    """Whether `tag` is a later release than `than`; tags that cannot be ordered count as different when they differ."""
    a, b = _order(tag), _order(than)
    return a > b if a is not None and b is not None else bool(tag) and tag != than


# Models ---------------------------------------------------------------------------------------------------------------

def remote_files(repo: str) -> RemoteFiles:
    """Every file of the repo on the Hub (main revision), with its id. Raises the Hub's errors."""
    from huggingface_hub import HfApi

    api = HfApi(token=runtime_settings.get_settings().get("hf_token") or None)
    files: RemoteFiles = {}
    for entry in api.list_repo_tree(repo, recursive=True):
        if entry.__class__.__name__ == "RepoFile":
            files[entry.path] = (entry.lfs.sha256 if entry.lfs else entry.blob_id, int(entry.size or 0))
    return files


def local_files(repo: str) -> LocalFiles:
    """The files of the repo in the cache. The snapshot `refs/main` points to wins over older ones for the same path."""
    root = repo_cache_dir(repo)
    snapshots = root / "snapshots"
    if not snapshots.is_dir():
        return {}
    main = root / "refs" / "main"
    first = main.read_text().strip() if main.is_file() else ""
    dirs = sorted((d for d in snapshots.iterdir() if d.is_dir()), key=lambda d: (d.name != first, -d.stat().st_mtime))
    found: LocalFiles = {}
    for snap in dirs:
        for p in snap.rglob("*"):
            rel = p.relative_to(snap).as_posix()
            if rel in found or not (p.is_symlink() or p.is_file()):
                continue
            try:
                size = p.stat().st_size
            except OSError:  # a link whose blob is gone
                continue
            found[rel] = (os.path.basename(os.readlink(p)) if p.is_symlink() else None, size)
    return found


@dataclass
class SourceDiff:
    """What changed on the Hub for the files a source downloads (and the cache already has)."""

    changed: list[str] = field(default_factory=list)
    bytes: int = 0
    ids: dict[str, str] = field(default_factory=dict)  # changed path -> its id on the Hub


def diff_source(src: HfSource, remote: RemoteFiles, local: LocalFiles) -> SourceDiff:
    out = SourceDiff()
    for path, (remote_id, size) in remote.items():
        if path not in local or not (src.patterns is None or _matches(path, src.patterns)):
            continue
        local_id, local_size = local[path]
        if (local_id is not None and local_id != remote_id) or (local_id is None and local_size != size):
            out.changed.append(path)
            out.bytes += size
            out.ids[path] = remote_id
    return out


def fingerprint(ids: dict[str, str]) -> str:
    """Identity of what changed on the Hub (path and id of every changed file): another change, another fingerprint. The advice
    stored for an update is tied to it, so that it is known to be out of date when the Hub changes again."""
    return hashlib.sha1("\n".join(f"{p}:{i}" for p, i in sorted(ids.items())).encode()).hexdigest()[:12]


def local_revision(repo: str) -> str | None:
    """Short id of the revision of the cache (`refs/main`), or None."""
    ref = repo_cache_dir(repo) / "refs" / "main"
    return ref.read_text().strip()[:7] if ref.is_file() else None


def installed_models() -> list[Any]:
    """The models that are installed, with the quantization the user picked (the one that is in use)."""
    chosen = selected_variants()
    specs = [resolve(base, chosen) for base in MODELS.values()]
    return [s for s in specs if s.all_sources() and installation_status(s)["state"] == "installed"]


def _fetch(repos: set[str], remote: Callable[[str], RemoteFiles]) -> dict[str, RemoteFiles | Exception]:
    def one(repo: str) -> RemoteFiles | Exception:
        try:
            return remote(repo)
        except Exception as exc:  # noqa: BLE001  a repo that cannot be read must not hide the others
            return exc

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        return dict(zip(sorted(repos), pool.map(one, sorted(repos))))


def _describe(exc: Exception) -> str:
    from .download_worker import _describe as describe

    return describe(exc)


def check_model(spec: Any, remotes: dict[str, RemoteFiles | Exception]) -> dict[str, Any]:
    row: dict[str, Any] = {"id": spec.id, "name": spec.name, "kind": spec.kind, "state": "current", "files": 0,
                           "size_gb": 0.0, "error": None, "fingerprint": None, "revision": None}
    changed: dict[str, str] = {}
    for src in spec.all_sources():
        got = remotes[src.repo]
        if isinstance(got, Exception):
            return {**row, "state": "error", "error": _describe(got)}
        diff = diff_source(src, got, local_files(src.repo))
        row["files"] += len(diff.changed)
        row["size_gb"] += diff.bytes / GIB
        changed.update({f"{src.repo}/{p}": i for p, i in diff.ids.items()})
    row["size_gb"] = round(row["size_gb"], 2)
    if row["files"]:
        row["state"] = "update"
        row["fingerprint"] = fingerprint(changed)
        row["revision"] = local_revision(spec.all_sources()[0].repo)
    return row


def check_models(remote: Callable[[str], RemoteFiles] = remote_files, only: str | None = None) -> list[dict[str, Any]]:
    specs = [s for s in installed_models() if only in (None, s.id)]
    remotes = _fetch({src.repo for s in specs for src in s.all_sources()}, remote)
    return [check_model(s, remotes) for s in specs]


def prune_replaced(repo: str) -> int:
    """After an update: drop, from the older snapshots of `repo`, the files the main snapshot replaced; returns bytes freed.

    A file only the old snapshot has is kept: another model may share the repo with different patterns and still need it.
    The data nothing links to anymore is deleted afterwards (the cache keeps a deduplicated store, see
    `downloads._delete_source`)."""
    from .downloads import _repo_links

    root = repo_cache_dir(repo)
    main = root / "refs" / "main"
    snapshots = root / "snapshots"
    if not (main.is_file() and snapshots.is_dir()):
        return 0
    current = snapshots / main.read_text().strip()
    if not current.is_dir():
        return 0
    kept = {p.relative_to(current).as_posix() for p in current.rglob("*") if p.is_symlink() or p.is_file()}
    targets: set[Path] = set()
    for snap in (d for d in snapshots.iterdir() if d.is_dir() and d != current):
        for p in list(snap.rglob("*")):
            if (p.is_symlink() or p.is_file()) and p.relative_to(snap).as_posix() in kept:
                try:
                    targets.add(p.resolve())
                except OSError:
                    pass
                p.unlink(missing_ok=True)
        for d in sorted((x for x in snap.rglob("*") if x.is_dir()), reverse=True) + [snap]:
            if not any(d.iterdir()):
                d.rmdir()
    hub = hf_hub_dir().resolve()
    live = {p.resolve() for p in _repo_links(hub) if p.exists()}
    freed = 0
    for t in targets:
        if t.is_file() and t not in live:
            freed += t.stat().st_size
            t.unlink()
    for link in (root / "blobs").iterdir() if (root / "blobs").is_dir() else []:
        if link.is_symlink() and not link.exists():  # pointed at data that was just deleted
            link.unlink()
    return freed


# Engines --------------------------------------------------------------------------------------------------------------

def latest_tag(repo: str) -> str | None:
    """Newest release of a GitHub repo, or None when it cannot be read (offline, rate limit)."""
    try:
        return str(engine_install._http_json(f"https://api.github.com/repos/{repo}/releases/latest")["tag_name"])
    except Exception:  # noqa: BLE001  informational only
        return None


def _kinds(match: Callable[[Any], bool]) -> list[str]:
    return sorted({s.kind for s in MODELS.values() if match(s)})


def _installed_tag(folder: Path) -> str | None:
    try:
        return str(json.loads((folder / "VERSION.json").read_text()).get("tag") or "") or None
    except (OSError, ValueError):
        return None


def _binary_row(engine_id: str, name: str, kinds: list[str], variant: str, installed: str | None, target: str,
                upstream: str | None, size_mb: int) -> dict[str, Any]:
    wanted = upstream if target == "latest" else target  # `IMAGEGEN_*_TAG=latest` follows upstream
    latest = None
    if upstream and upstream != wanted and _newer(upstream, installed):
        latest = {"tag": upstream, "regressions": regressions_for(engine_id, upstream)}
    # A build newer than the pin (installed through `latest`) is not downgraded on its own, but the user can go back to the tested one.
    rollback = bool(wanted and installed and target != "latest" and _order(installed) and _order(wanted) and _newer(installed, wanted))
    return {"id": engine_id, "name": name, "kinds": kinds, "state": "update" if wanted and _newer(wanted, installed) else "current",
            "installed": installed or "?", "target": wanted, "upstream": upstream, "latest": latest, "rollback": rollback,
            "variant": variant, "size_mb": size_mb, "reason": "pinned", "advice": None}


def _sdcpp_rows(upstream: Callable[[str], str | None]) -> list[dict[str, Any]]:
    root = config.ENGINES_DIR / "sdcpp"
    variants = [d for d in sorted(root.iterdir()) if (d / sdcpp.binary_name()).is_file()] if root.is_dir() else []
    if not variants:
        return []
    folder = variants[0]  # the build the installer manages; the update replaces this one
    return [_binary_row("sdcpp", "stable-diffusion.cpp", _kinds(lambda s: s.backend == "sdcpp"), folder.name,
                        _installed_tag(folder), engine_install.default_tag(), upstream(engine_install.REPO),
                        engine_install.install_size_mb(folder.name))]


def _audiocpp_rows(upstream: Callable[[str], str | None]) -> list[dict[str, Any]]:
    found = audiocpp.installed_binary()
    if not found:
        return []
    variant, binary = found
    tag = audiocpp.version_info(binary).get("tag")
    return [_binary_row("audiocpp", "audio.cpp", _kinds(lambda s: s.options.get("pack") == "audiocpp"), variant, tag,
                        audiocpp.default_tag(), upstream(audiocpp.REPO), audiocpp.install_size_mb(variant))]


def _pack_rows() -> list[dict[str, Any]]:
    rows = []
    for pack in audio_packs.PACKS.values():
        marker = audio_packs.pack_dir(pack.id) / "ready.json"
        if pack.native or not marker.is_file() or not audio_packs.venv_python(pack.id).is_file():
            continue
        try:
            ready = json.loads(marker.read_text())
        except (OSError, ValueError):
            continue
        outdated = ready.get("hash") != audio_packs._requirements_hash(pack)
        rows.append({"id": pack.id, "name": pack.name, "kinds": _kinds(lambda s, p=pack.id: s.options.get("pack") == p),
                     "state": "update" if outdated else "current", "installed": time.strftime("%Y-%m-%d", time.localtime(
                         ready.get("installed_at") or 0)) if ready.get("installed_at") else "?",
                     "target": None, "upstream": None, "latest": None, "rollback": False, "variant": None, "size_mb": pack.size_mb, "reason": "recipe",
                     "advice": None})
    return rows


def check_engines(upstream: Callable[[str], str | None] = latest_tag) -> list[dict[str, Any]]:
    return _sdcpp_rows(upstream) + _audiocpp_rows(upstream) + _pack_rows()


def check_all(remote: Callable[[str], RemoteFiles] = remote_files,
              upstream: Callable[[str], str | None] = latest_tag) -> dict[str, Any]:
    return {"engines": check_engines(upstream), "models": check_models(remote), "checked_at": time.time()}
