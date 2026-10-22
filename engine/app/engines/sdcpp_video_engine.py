# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
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

A model that takes a start image and makes no sound (`VideoCaps.segment_seconds`) renders long clips as chained runs whose
length follows the memory measured on this machine (`video_memory.py`); `IMAGEGEN_SDCPP_MAX_VRAM=off` stops passing
`--max-vram` (the memory budget of sd-cli, build 956 or newer).
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
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from ..memory_guard import available_gb, reserve_gb, total_gb
from ..sdcpp import prompt_args
from ..video_memory import PeakMeter
from .base import Engine, GenerationCancelled, GenerationRequest, Hooks
from .sdcpp_engine import PROGRESS, _explain, _kill, _pump

log = logging.getLogger(__name__)

# First sd.cpp release documented with `--max-vram` and segmented execution (docs/performance.md at master-956).
MAX_VRAM_MIN_BUILD = 956

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
                  references: list[str], offload: bool, tae: str | None = None, max_vram: float | None = None,
                  prompt_dir: Path | None = None) -> list[str]:
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
    negative = (req.negative_prompt or "").strip() or o.get("default_negative") or ""
    cmd += prompt_args(Path(binary), req.prompt, negative, prompt_dir)  # files instead of the command line in a private session
    cmd += ["-W", str(req.width), "-H", str(req.height), "--video-frames", str(frames),
            "--fps", str(fps), "--steps", str(low), "-s", str(req.seed), "-o", output]
    if req.guidance is not None:
        cmd += ["--cfg-scale", str(req.guidance)]
        if high:
            cmd += ["--high-noise-cfg-scale", str(req.guidance)]
    if high:
        cmd += ["--high-noise-steps", str(high), "--high-noise-sampling-method",
                (o.get("high_noise") or {}).get("sampling", "euler")]
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
    if max_vram is not None:
        cmd += ["--max-vram", f"{max_vram:.1f}"]  # managed memory budget: a graph over it runs in segments, slower
    return cmd


class SdcppVideoEngine(Engine):
    # Memory the machine has available now (a field, so that tests can set it).
    read_available = staticmethod(available_gb)

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

    def _chained(self, req: GenerationRequest) -> bool:
        """Whether the clip is rendered as chained runs sized by the measured memory (`VideoCaps.segment_seconds`)."""
        caps = self.spec.video
        return bool(caps.segment_seconds) and not caps.audio_out and req.extra.get("task", "t2v") != "v2v"

    def _max_vram(self, budget_gb: float) -> float | None:
        """Budget handed to `sd-cli --max-vram`: None when the build predates it (956) or `IMAGEGEN_SDCPP_MAX_VRAM=off`."""
        from ..sdcpp import build_number

        if (os.environ.get("IMAGEGEN_SDCPP_MAX_VRAM") or "").lower() in ("0", "off", "false"):
            return None
        number = build_number(self.binary)
        return max(1.0, budget_gb) if number is not None and number >= MAX_VRAM_MIN_BUILD else None

    def generate(self, req: GenerationRequest, hooks: Hooks) -> SdcppVideoResult:
        if not self._chained(req):
            return self._generate_clip(req, hooks)
        return self._generate_chained(req, hooks)

    def _generate_chained(self, req: GenerationRequest, hooks: Hooks) -> SdcppVideoResult:
        """The clip as runs one after the other (one sd-cli process, so one model in memory, at a time). Each run starts
        from the last frame of the previous, whose own first frame is dropped as a duplicate. Its length is the longest
        that the memory measured on this machine allows (`video_memory`); what a run really drew is recorded for the next."""
        from .. import video_memory as vm
        from ..media import video_frame_count

        caps, total = self.spec.video, int(req.extra["frames"])
        fps = int(req.extra.get("fps") or caps.fps)
        ceiling = video_frame_count(caps.segment_seconds, fps, caps.frame_step, caps.min_seconds, caps.segment_seconds)
        key = f"{self.spec.id}|{self.spec.variant or ''}|{int(bool(req.extra.get('fast_decode')))}"
        samples = vm.load_samples(key)
        reserve = reserve_gb(total_gb())
        tmp = Path(tempfile.mkdtemp(prefix="sdcpp-video-long-"))
        frames_dir = tmp / "frames"
        frames_dir.mkdir()
        start, end, planned, written, runs_done = req.references[:1], req.references[1:2], 0, 0, 0
        try:
            while planned < total:
                budget = self.read_available() - reserve
                count, measured = vm.next_run_frames(
                    new_needed=total - planned, first=planned == 0, step=caps.frame_step, ceiling=ceiling, width=req.width,
                    height=req.height, samples=samples, budget_gb=budget, weights_gb=self.spec.weights_gb)
                volume = vm.mvox(count, req.width, req.height)
                predicted, _ = vm.predict_gb(samples, volume, self.spec.weights_gb)
                if measured and count == caps.frame_step + 1 and predicted > budget:
                    raise RuntimeError(vm.explain_refusal(count, predicted, budget, self.spec.name))
                new = count if planned == 0 else count - 1
                runs_left = -(-(total - planned - new) // max(1, count - 1))  # runs after this one, at this length
                last = planned + new >= total
                run_req = replace(req, seed=req.seed + runs_done, references=start + (end if last else []),
                                  extra={**req.extra, "frames": count, "task": "i2v" if start else "t2v"})
                run_hooks = Hooks(
                    on_step=lambda done, _t, r=runs_done, n=runs_left: hooks.on_step(r * req.steps + done, (r + 1 + n) * req.steps),
                    on_preview=hooks.on_preview, is_cancelled=hooks.is_cancelled, preview_every=hooks.preview_every,
                    on_phase=hooks.on_phase)
                meter = vm.PeakMeter(self.read_available)
                clip = self._generate_clip(run_req, run_hooks, budget, meter)
                try:
                    files = sorted((clip.folder / "frames").glob("*.png"))
                    if not files:
                        raise RuntimeError("sd-cli n'a produit aucune image.")
                    if req.extra.get("private"):  # no file, no line: the measures only live for this clip (runs still grow)
                        samples = [*samples, vm.Sample(volume, meter.used_gb)]
                    else:
                        vm.record(key, vm.Sample(volume, meter.used_gb))
                        samples = vm.load_samples(key)
                        print(f"[video-memory] {self.spec.id} {count} images {req.width}x{req.height} : "
                              f"{meter.used_gb:.1f} Go utilisés, budget {budget:.1f} Go", flush=True)
                    shutil.copy(files[-1], tmp / f"start{runs_done + 1}.png")
                    start = [str(tmp / f"start{runs_done + 1}.png")]
                    for f in files if planned == 0 else files[1:]:
                        shutil.move(str(f), frames_dir / f"{written:05d}.png")
                        written += 1
                finally:
                    clip.cleanup()
                planned += new  # the plan, not the files: sd-cli's own count is trusted when it aligns a run differently
                runs_done += 1
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        return SdcppVideoResult(tmp, None, fps)

    def _generate_clip(self, req: GenerationRequest, hooks: Hooks, budget_gb: float | None = None,
                       meter: "PeakMeter | None" = None) -> SdcppVideoResult:
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
                                offload_enabled(o), tae, self._max_vram(budget_gb) if budget_gb is not None else None,
                                tmp if req.extra.get("private") else None)
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
                if meter:
                    meter.sample()
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
