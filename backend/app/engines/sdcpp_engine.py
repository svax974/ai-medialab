# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""GGUF engine: drives stable-diffusion.cpp's `sd-cli` (Metal, CUDA, ROCm, Vulkan, CPU).

One process per generation: cancelling just kills it, all memory is returned afterwards, and a GPU
driver crash doesn't take the server down. The price is reloading the weights for every image (a few
seconds, the files being in the disk cache); a resident server mode would be possible.

`ModelSpec.options`:
    files            role -> (repo, file): diffusion-model, llm, vae, llm_vision... (Hugging Face cache)
    vision_for_refs  roles only added when reference images are given (e.g. llm_vision)
    cli_args         fixed arguments (e.g. ["--sampling-method", "euler"])
    fa_variants      builds for which FlashAttention is enabled (--diffusion-fa)
    guidance_arg     guidance option (default --cfg-scale)
    edit_guidance    guidance used when editing (references) if the user left the default (1)
    edit_steps       step count used when editing if the user left the default
"""

from __future__ import annotations

import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from PIL import Image

from .base import Engine, GenerationCancelled, GenerationRequest, Hooks

# e.g. "|=====>    | 3/8 - 2.34s/it" or "3/8 - 0.42it/s"
PROGRESS = re.compile(r"(\d+)\s*/\s*(\d+)\s*-\s*([\d.]+)\s*(s/it|it/s)")


def effective_settings(spec, req: GenerationRequest, editing: bool) -> tuple[int, float | None]:
    """Steps and guidance actually used.

    The creation defaults don't suit instruction-based editing (reference images): it needs some
    guidance (measured: 1 doesn't follow the instruction) and 12 steps are enough (measured: same
    result as 20 in half the time). Only values the user left at the default are replaced, never an
    explicit setting."""
    o = spec.options
    steps, guidance = req.steps, req.guidance
    if editing:
        if o.get("edit_steps") and steps == spec.default_params().get("steps"):
            steps = o["edit_steps"]
        if o.get("edit_guidance") and (guidance is None or guidance <= 1.0):
            guidance = o["edit_guidance"]
    return steps, guidance


class SdcppEngine(Engine):
    def load(self) -> None:
        from huggingface_hub import hf_hub_download
        from huggingface_hub.errors import LocalEntryNotFoundError

        from ..system import get_system

        eng = get_system()["engines"]["sdcpp"]
        if not eng["available"]:
            raise RuntimeError(eng.get("reason") or "Moteur GGUF indisponible.")
        self.binary = Path(eng["binary"])
        self.variant = eng["variant"]
        self.paths: dict[str, str] = {}
        for role, (repo, filename) in self.spec.options["files"].items():
            try:
                self.paths[role] = hf_hub_download(repo, filename, local_files_only=True)
            except LocalEntryNotFoundError:
                raise RuntimeError(f"Fichier du modèle introuvable : {repo}/{filename} — téléchargez le modèle.") from None

    def generate(self, req: GenerationRequest, hooks: Hooks) -> Image.Image:
        o = self.spec.options
        refs = list(req.references)[: max(self.spec.max_references, 0)]
        use_init = bool(refs) and self.spec.reference_mode == "init"
        tmp = Path(tempfile.mkdtemp(prefix="sdcpp-"))
        out = tmp / "out.png"
        preview = tmp / "preview.png"
        try:
            cmd = [str(self.binary)]
            for role, path in self.paths.items():
                if role in o.get("vision_for_refs", []) and not refs:
                    continue
                cmd += [f"--{role}", path]
            steps, guidance = effective_settings(self.spec, req, editing=bool(refs) and not use_init)
            cmd += ["-p", req.prompt, "-W", str(req.width), "-H", str(req.height), "--steps", str(steps),
                    "-s", str(req.seed), "-o", str(out)]
            if guidance is not None:
                cmd += [o.get("guidance_arg", "--cfg-scale"), str(guidance)]
            if (req.negative_prompt or "").strip():
                cmd += ["-n", req.negative_prompt.strip()]
            if use_init:
                cmd += ["-i", refs[0], "--strength", str(req.strength if req.strength is not None else 0.75)]
            else:
                for r in refs:
                    cmd += ["-r", r]
            cmd += list(o.get("cli_args", []))
            if self.variant in o.get("fa_variants", []):
                cmd += ["--diffusion-fa"]
            if hooks.preview_every:
                cmd += ["--preview", "proj", "--preview-path", str(preview), "--preview-interval", str(hooks.preview_every)]

            lines: "queue.Queue[str | None]" = queue.Queue()
            proc = subprocess.Popen(cmd, cwd=str(self.binary.parent), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    env={**os.environ, "NO_COLOR": "1"})
            threading.Thread(target=_pump, args=(proc, lines), daemon=True).start()

            tail: list[str] = []
            last_preview = 0.0
            while True:
                try:
                    line = lines.get(timeout=0.25)
                except queue.Empty:
                    line = ""
                if line is None:
                    break
                if line:
                    tail = (tail + [line])[-25:]
                    m = PROGRESS.search(line)
                    if m:
                        hooks.on_step(int(m.group(1)), int(m.group(2)))
                if hooks.is_cancelled():
                    _kill(proc)
                    raise GenerationCancelled()
                if hooks.preview_every and preview.exists() and preview.stat().st_mtime > last_preview:
                    last_preview = preview.stat().st_mtime
                    try:
                        with Image.open(preview) as im:
                            hooks.on_preview(im.convert("RGB").copy())
                    except Exception:
                        pass  # file still being written, retry on the next loop
            code = proc.wait()
            if code != 0 or not out.exists():
                raise RuntimeError(_explain(code, tail, self.variant))
            with Image.open(out) as im:
                return im.copy()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def _pump(proc: subprocess.Popen, lines: "queue.Queue[str | None]") -> None:
    """Split output on \\n and \\r (the progress bar rewrites the same line)."""
    buf = b""
    assert proc.stdout
    while chunk := proc.stdout.read1(4096):  # type: ignore[attr-defined]
        buf += chunk
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for p in parts:
            if p.strip():
                lines.put(p.decode("utf-8", "replace").strip())
    if buf.strip():
        lines.put(buf.decode("utf-8", "replace").strip())
    lines.put(None)


def _kill(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def _explain(code: int, tail: list[str], variant: str) -> str:
    text = "\n".join(tail[-8:])
    low = text.lower()
    if any(k in low for k in ("out of memory", "failed to allocate", "vk_error_out_of", "cudamalloc")):
        return ("Mémoire GPU insuffisante pour ce modèle à cette taille. Réduisez la définition ou choisissez "
                f"une quantification plus légère. ({variant})")
    return f"sd-cli s'est arrêté (code {code}, build {variant}).\n{text}"
