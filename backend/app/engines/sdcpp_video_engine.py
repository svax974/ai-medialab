# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Video engine on stable-diffusion.cpp: `sd-cli -M vid_gen` (Metal, CUDA, ROCm, Vulkan).

Same model as the image engine: one process per clip, cancelling kills it, and the output only appears at the end.
sd-cli cannot write MP4. Models without sound are written as numbered PNG frames, which `media.encode_mp4` turns into
H.264; LTX also makes sound, which only travels inside a `.webm` (VP8 + PCM), so that file is demuxed and re-encoded
with an AAC track. The real frame count of the output is trusted: sd-cli aligns the requested count to the model's
step (Wan/Hunyuan 4k+1, LTX 8k+1).

`ModelSpec.options`:
    files             role -> (repo, file): diffusion-model, vae, t5xxl, llm, audio-vae... (Hugging Face cache)
    cli_args          fixed arguments (sampling method, flow shift, VAE tiling...)
    fa_variants       builds for which FlashAttention is enabled (--diffusion-fa)
    offload_to_cpu    pass --offload-to-cpu (what the sd.cpp guides recommend); `IMAGEGEN_SDCPP_OFFLOAD=on|off` overrides
    default_negative  negative prompt used when the user left it empty
    high_noise        Wan 2.2 A14B: {"steps_ratio": share of the steps run by the high-noise expert, "sampling": method}
    tae               Wan fast decode: name of the TAEHV file (taehv.py) passed as `--tae` in place of the `vae` file
    sigmas            fixed sigma schedule (distilled LTX); `steps` must match its length - 1
"""

from __future__ import annotations

import os
import queue
import logging
import re
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .base import Engine, GenerationCancelled, GenerationRequest, Hooks
from .sdcpp_engine import PROGRESS, _explain, _kill, _pump

log = logging.getLogger(__name__)

# Log lines that mark the phases of vid_gen (stable-diffusion.cpp src/pipeline/video.cpp).
SAMPLING_START = re.compile(r"\bgenerate_video \d+x\d+x\d+")


class ProgressTracker:
    """Turns sd-cli's log lines into phases and cumulative sampling steps.

    The VAE (encode of the start image, decode of the video; full VAE tiles or the TAE alike) draws the same `k/N - s/it`
    bars as the sampler, so a bar only counts as a step between the `generate_video WxHxF` line and the end of sampling. Wan 2.2 A14B samples twice (high-noise
    expert, then low-noise one) and the counter restarts: steps are accumulated over both passes.

    `feed(line)` returns events: ("phase", name) with name in prepare | sampling | decode | encode, and ("step", done, total)."""

    def __init__(self, passes: list[int]) -> None:
        self.expected = [max(1, p) for p in passes] or [1]
        self.phase = "prepare"
        self.index = 0  # sampling pass in progress
        self.before = 0  # steps of the finished passes
        self.pass_total = self.expected[0]
        self._last = 0

    def _total(self) -> int:
        return self.before + self.pass_total + sum(self.expected[self.index + 1:])

    def feed(self, line: str) -> list[tuple]:
        events: list[tuple] = []
        if self.phase == "prepare" and SAMPLING_START.search(line):
            self.phase = "sampling"
            return [("phase", "sampling")]
        if self.phase == "sampling":
            if "sampling(high noise) completed" in line:
                self.before += self.pass_total
                self.index += 1
                self.pass_total = self.expected[min(self.index, len(self.expected) - 1)]
                self._last = 0
                return [("step", self.before, self._total())]
            if "sampling completed" in line:
                self.phase = "decode"
                return [("step", self._total(), self._total()), ("phase", "decode")]
            if m := PROGRESS.search(line):
                step, total = int(m.group(1)), int(m.group(2))
                self.pass_total = total
                if step != self._last:
                    self._last = step
                    events.append(("step", self.before + step, self._total()))
            return events
        if self.phase in ("prepare", "decode") and "generate_video completed" in line:
            self.phase = "encode"
            return [("phase", "encode")]
        return events


@dataclass
class SdcppVideoResult:
    """sd-cli's output, still on disk: `frames` (PNG pattern) or a `.webm` carrying sound."""

    folder: Path
    path: Path | None  # the .webm, or None for numbered frames
    fps: int

    def cleanup(self) -> None:
        shutil.rmtree(self.folder, ignore_errors=True)


def offload_enabled(options: dict[str, Any], env: dict[str, str] | None = None) -> bool:
    mode = ((env if env is not None else os.environ).get("IMAGEGEN_SDCPP_OFFLOAD") or "").lower()
    if mode in ("1", "on", "true"):
        return True
    if mode in ("0", "off", "false"):
        return False
    return bool(options.get("offload_to_cpu"))


def split_steps(options: dict[str, Any], steps: int) -> tuple[int, int | None]:
    """(low-noise steps, high-noise steps or None) for a total. Without a high-noise expert: (steps, None)."""
    ratio = (options.get("high_noise") or {}).get("steps_ratio")
    if not ratio:
        return steps, None
    high = min(max(1, round(steps * ratio)), steps - 1)
    return steps - high, high


def build_command(binary: str, variant: str, spec, paths: dict[str, str], req: GenerationRequest, output: str,
                  references: list[str], offload: bool, tae: str | None = None) -> list[str]:
    o = spec.options
    frames = int(req.extra["frames"])
    fps = int(req.extra.get("fps") or spec.video.fps)
    low, high = split_steps(o, req.steps)
    cmd = [binary, "-M", "vid_gen"]
    for role, path in paths.items():
        if role == "vae" and tae:
            continue  # --tae replaces --vae: never both
        cmd += [f"--{role}", path]
    if tae:
        cmd += ["--tae", tae]
    cmd += ["-p", req.prompt, "-W", str(req.width), "-H", str(req.height), "--video-frames", str(frames),
            "--fps", str(fps), "--steps", str(low), "-s", str(req.seed), "-o", output]
    if req.guidance is not None:
        cmd += ["--cfg-scale", str(req.guidance)]
        if high:
            cmd += ["--high-noise-cfg-scale", str(req.guidance)]
    if high:
        cmd += ["--high-noise-steps", str(high), "--high-noise-sampling-method",
                (o.get("high_noise") or {}).get("sampling", "euler")]
    negative = (req.negative_prompt or "").strip() or o.get("default_negative") or ""
    if negative:
        cmd += ["-n", negative]
    if references:
        cmd += ["-i", references[0]]
        if len(references) > 1:
            cmd += ["--end-img", references[1]]
    if o.get("sigmas"):
        cmd += ["--sigmas", o["sigmas"]]
    cmd += list(o.get("cli_args", []))
    if variant in o.get("fa_variants", ["metal", "cuda", "rocm"]):
        cmd += ["--diffusion-fa"]
    if offload:
        cmd += ["--offload-to-cpu"]
    return cmd


class SdcppVideoEngine(Engine):
    def load(self) -> None:
        from huggingface_hub import hf_hub_download
        from huggingface_hub.errors import LocalEntryNotFoundError

        from ..sdcpp import video_unsupported
        from ..system import get_system, memory_plan

        system = get_system()
        eng = system["engines"]["sdcpp"]
        if not eng["available"]:
            raise RuntimeError(eng.get("reason") or "Moteur GGUF indisponible.")
        plan = memory_plan(self.spec.weights_gb, self.spec.largest_component_gb, system, "sdcpp",
                           self.spec.options.get("overhead_gb", 0.0))
        if not plan["fits"]:  # video fills the memory for minutes: refuse up front rather than let the machine swap
            raise RuntimeError(f"Ce modèle ne tient pas sur cette machine. {plan['note']}")
        self.binary = Path(eng["binary"])
        self.variant = eng["variant"]
        if err := video_unsupported(self.binary, self.variant):
            raise RuntimeError(err)
        self.paths: dict[str, str] = {}
        for role, (repo, filename) in self.spec.options["files"].items():
            try:
                self.paths[role] = hf_hub_download(repo, filename, local_files_only=True)
            except LocalEntryNotFoundError:
                raise RuntimeError(f"Fichier du modèle introuvable : {repo}/{filename} — téléchargez le modèle.") from None

    def _fast_decoder(self, req: GenerationRequest, hooks: Hooks) -> str | None:
        """Path of the TAEHV decoder when fast decode is on and available; None means the full VAE is used.

        The first use downloads 23 MB. If that fails (offline...), generation goes on with the full VAE: slower, not broken."""
        from .. import taehv

        name = self.spec.options.get("tae")
        if not name or not req.extra.get("fast_decode"):
            return None
        try:
            if not taehv.is_ready(name):
                hooks.on_phase("fetch")  # "téléchargement du décodeur rapide (23 Mo)…"
            return str(taehv.ensure_tae(name))
        except taehv.TaeUnavailable as e:
            log.warning("%s Décodage complet du VAE à la place.", e)
            return None

    def generate(self, req: GenerationRequest, hooks: Hooks) -> SdcppVideoResult:
        from PIL import Image, ImageOps

        from ..media import fit_image

        o = self.spec.options
        task = req.extra.get("task", "t2v")
        if task not in ("t2v", "i2v"):
            raise RuntimeError("Ce moteur ne sait pas encore éditer une vidéo existante.")
        fps = int(req.extra.get("fps") or self.spec.video.fps)
        low, high = split_steps(o, req.steps)
        tracker = ProgressTracker([high, low] if high else [low])
        tmp = Path(tempfile.mkdtemp(prefix="sdcpp-video-"))
        try:
            with_sound = bool(self.spec.video.audio_out)
            output = tmp / "out.webm" if with_sound else tmp / "frames" / "%05d.png"
            if not with_sound:
                output.parent.mkdir()
            refs = []
            for i, ref in enumerate(req.references if task == "i2v" else []):
                img = fit_image(ImageOps.exif_transpose(Image.open(ref)).convert("RGB"), req.width, req.height)
                refs.append(str(tmp / f"ref{i}.png"))
                img.save(refs[-1])
            tae = self._fast_decoder(req, hooks)
            cmd = build_command(str(self.binary), self.variant, self.spec, self.paths, req, str(output), refs,
                                offload_enabled(o), tae)
            hooks.on_phase("prepare")

            lines: "queue.Queue[str | None]" = queue.Queue()
            proc = subprocess.Popen(cmd, cwd=str(self.binary.parent), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    env={**os.environ, "NO_COLOR": "1"})
            threading.Thread(target=_pump, args=(proc, lines), daemon=True).start()
            tail: list[str] = []
            while True:
                try:
                    line = lines.get(timeout=0.25)
                except queue.Empty:
                    line = ""
                if line is None:
                    break
                if line:
                    tail = (tail + [line])[-25:]
                    for event in tracker.feed(line):
                        if event[0] == "phase":
                            hooks.on_phase(event[1])
                        else:
                            hooks.on_step(event[1], event[2])
                if hooks.is_cancelled():
                    _kill(proc)
                    raise GenerationCancelled()
            code = proc.wait()
            if code != 0 or not (output.exists() if with_sound else any(output.parent.glob("*.png"))):
                raise RuntimeError(_explain(code, tail, self.variant, video=True))
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        if tracker.phase != "encode":  # sd-cli's own "completed" line normally got there first
            hooks.on_phase("encode")
        return SdcppVideoResult(tmp, output if with_sound else None, fps)

    def save(self, result: SdcppVideoResult, path: Path) -> dict[str, Any]:
        import numpy as np
        from PIL import Image

        from ..media import encode_mp4, read_video_with_audio

        try:
            audio = rate = None
            if result.path is not None:
                frames, audio, rate = read_video_with_audio(result.path)
            else:
                files = sorted((result.folder / "frames").glob("*.png"))
                frames = np.stack([np.asarray(Image.open(f).convert("RGB")) for f in files])
            if len(frames) == 0:
                raise RuntimeError("sd-cli n'a produit aucune image.")
            encode_mp4(frames, result.fps, path, audio, rate)
            count, height, width = frames.shape[0], frames.shape[1], frames.shape[2]
            return {"width": width, "height": height, "fps": result.fps, "frames": count,
                    "has_audio": audio is not None, "duration": round(count / result.fps, 3)}
        finally:
            result.cleanup()
