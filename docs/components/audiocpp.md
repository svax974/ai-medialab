# audio.cpp — GGUF audio engine (ggml)

*Last verified against source and upstream: 2026-10-13.* Register and review procedure: [README.md](README.md).

## Why

PyTorch audio engines only cover CUDA, ROCm (Linux) and Metal; on an AMD or Intel GPU under Windows, or on an
NVIDIA without a usable CUDA driver, they fall back to the CPU. audio.cpp (<https://github.com/0xShug0/audio.cpp>,
Apache-2.0) runs more than a hundred audio models in GGUF format on Metal, CUDA, **Vulkan** (any GPU) or CPU, with
precompiled binaries. It is the same principle as stable-diffusion.cpp for images and video.

No case-by-case handling per model: a single binary, a common CLI (`--family`, `--model`, `--backend`), and each additional model
reduces to a spec entry in `engine/app/engines/audiocpp_specs.py`.

## What is integrated

| Element | Where | Role |
|---|---|---|
| Installation and choice of build | `engine/app/audiocpp.py` | downloads the pinned version (`PINNED_TAG`), checks the SHA-256 published by GitHub, extracts without leaving the target folder, checks that a GPU is seen, otherwise tries the next build down to the CPU |
| "Native" pack | `engine/app/audio_packs.py` (pack `audiocpp`, field `native`) | reuses as is the install button, progress and events of the Python packs, without a Python environment |
| Worker engine | `engine/audio_runtime/engines/audiocpp_engine.py` | one `audiocpp_cli` call per text chunk; cancellation = stopping the process |
| Models | `engine/app/engines/audiocpp_specs.py` | four Qwen3-TTS variants, Chatterbox, Pocket TTS FR/EN and Qwen3-ASR (see below) |
| Transcription | `engine/app/transcription.py`, `audiocpp.run_transcribe` | chooses the model (weights **and** engine present, Whisper first) and launches Whisper or audio.cpp |
| Compatibility lookup | `engine/app/catalog.py` (`engine_for`, `engine_compat`) | the same rule serves the catalogue models and the Hugging Face search results |
| Periodic review | `scripts-local/review_components.py`, `docs/components/audiocpp-families.json` | new versions and families |

Where things live on disk: binaries in `<engines>/audiocpp/<variant>/` (variable `IMAGEGEN_AUDIOCPP_DIR`
to change it); weights in the Hugging Face cache, repository `audio-cpp/audio.cpp-gguf` (GGUF conversions published by
the project). `IMAGEGEN_AUDIOCPP_TAG` replaces the pinned version, `IMAGEGEN_AUDIOCPP_VARIANT` forces a build.

### Choice of build according to hardware

The table of builds and the order of preference are in `audiocpp.py` (`ASSETS`, `PREFERENCE`); do not copy them
here. Particularities to know: no upstream ROCm build (AMD goes through Vulkan); under Linux, the only published CUDA build
is a "colab" build that we do not use (NVIDIA goes through Vulkan); the CPU is the last fallback, accepted for
audio.

## Measurements (2026-10-13, MacBook M3 Max, Metal, Qwen3-TTS 0.6B Base Q8, French text)

| Measurement | Value |
|---|---|
| GGUF file | 1.99 GB |
| 4.2 s of audio generated (direct CLI, model loaded then freed at each call) | 2.4 s of wall time (1.7× real time) |
| Actual memory footprint (`phys_footprint`) | 3.1 GB (the announced RSS, 4.9 GB, counts shared mappings) |
| Via the application's engine, at steady state | 3.0 s per call (5 calls, ±0.1 s) for 4.1 s of audio, against 2.9 s direct through the CLI (including ≈ 0.8 s of start-up and loading): **no engine overhead** |
| First call of a freshly installed binary | ≈ 12 s instead of 3 s, of which ≈ 10 s before the generation (Metal initialisation, once per binary; `--list-devices` alone takes ≈ 8 s cold). The installer pays it at installation, because it calls this command to check the GPU |
| Isolated measurement of 8.1 s | seen only once, not reproduced; the machine was then very loaded (average load of 5 to 8 because of other projects). The same call also went from 2.9 s to 5.8 s when free memory dropped to 13 GB |

The catalogue's memory planner (`_pack_plan`) takes 1.6 × the size of the weights + 1.5 GB: consistent with the measurement.
The sound quality has not been assessed by ear; the test file stayed out of the repository.

## Known limits

- **Vulkan, CUDA and CPU have not been run**: only the Metal machine has been used. The upstream README says that CUDA is the
  optimised path and that Vulkan, Metal and HIP serve portability and tests, without per-model coverage. To be validated on a
  Windows or Linux machine before announcing "any GPU" without reservation.
- One process per text chunk: the model is reloaded at each call (memory freed between two, but repeated loading time). Optimisation lead:
  a persistent `audiocpp_server` (upstream options `--max-loaded-models`, `--idle-unload-ms`, `--min-free-memory-mb` to bound memory).
- Qwen3-TTS expects the language name (`french`), not the code; the table is in the engine.
- Young project (versions 0.x, a release every two to four weeks): strict pinning, no "latest".

## Integrated models

| Model | File | Licence | Upstream status |
|---|---|---|---|
| Qwen3-TTS · Cloning 0.6B (GGUF) | `Qwen3-TTS-12Hz-0.6B-Base-GGUF` (Q8_0) | Apache-2.0 | supported; **tested end to end** |
| Qwen3-TTS · Cloning 1.7B (GGUF) | `Qwen3-TTS-12Hz-1.7B-Base-GGUF` (Q8_0) | Apache-2.0 | supported; not tested |
| Qwen3-TTS · Voice & style 1.7B (GGUF) | `…-1.7B-CustomVoice-GGUF` (Q8_0) | Apache-2.0 | supported; **tested end to end** (2026-10-13): all nine voices of our list respond, style instruction accepted |
| Qwen3-TTS · Voice creation 1.7B (GGUF) | `…-1.7B-VoiceDesign-GGUF` (Q8_0) | Apache-2.0 | supported; not tested |
| Pocket TTS · FR / EN (GGUF) | `PocketTTS-GGUF/{french,english}/…-q8_0.gguf` (128 MB each) + voices `embeddings/` | CC-BY-4.0 | supported; **tested end to end** (fr, en, cloning) |
| Chatterbox · Expressive cloning (GGUF) | `Chatterbox-GGUF/chatterbox-q8_0.gguf` (2.09 GB) | MIT | supported; **tested end to end** (fr, en, de) |

**Qwen3-TTS · Voice & style (preset voices).** The names come from the model itself: the GGUF embeds the original `config.json` (`talker_config.spk_id`) with the nine voices `serena`, `vivian`, `uncle_fu`, `ryan`, `aiden`, `ono_anna`, `sohee`, `eric` (Sichuan dialect) and `dylan` (Beijing dialect), that is exactly our list. `--voice-id` ignores case, and refuses an unknown name with a clear message. Measured on Metal: footprint 3.6 GB (RSS 5.9 GB), ≈ 2.5× real time. Whether the style instruction really changes the rendering has not been verified by ear.

**Qwen3-ASR (transcription)** (Alibaba, Apache-2.0). Measured on 2026-10-13 on Metal with the French test sample (3.4 s, known text): **exact** text with the 0.6B (Q8, 1.15 GB; ≈ 10× real time, footprint 1.6 GB) and with the 1.7B (Q8, 2.47 GB; ≈ 8×, footprint 2.9 GB); first cold call ≈ 11 s through the application. A single easy sample: **accuracy on difficult excerpts (accent, noise) has not been measured**. The CLI has no `--language` option for ASR: the language hint goes through `--request-option language=fr`, and audio.cpp does not validate it (an invalid language is accepted without error). The text is only a suggestion: the voice editor always allows correcting it.

**Pocket TTS** (Kyutai). Measured on 2026-10-13: French on CPU at 6.5× real time, ≈ 0.6 GB; cloning at 4.4×; one GGUF model per language, chosen according to the language of the generation. The upstream v0.9.1 spec does not declare French (only the `main` branch does) but the v0.9.1 binary reads it: to re-check when a published version declares it. **Pitfall fixed**: audio.cpp resolves symbolic links; the Hugging Face cache stores the files as links to `blobs/`, so `--voice-id` was looking for the voices in the wrong place. The engine passes the path of the voice (`voice_embedding_path`) inside the snapshot.

**Chatterbox** (Resemble AI). Measured on 2026-10-13 on Metal: 5.1 s of audio in 5.4 s (≈ 0.95× real time), memory footprint 1.9 GB. Particularities: audio.cpp only exposes it as a **cloning** task (`clon`), so a voice sample is mandatory (no built-in voice; the Turbo variant has one but is only in English and "testing"); **19 languages** implemented on the audio.cpp side, whereas upstream announces 23 (Multilingual V3); the language is chosen at each generation; exposed settings: expressiveness (`exaggeration`), fidelity to the voice (`guidance_scale`, at 0 if the sample is not in the generated language, according to the upstream spec), variability. **Watermark: absent from the port.** The original implementation (Resemble AI, Python) applies an inaudible watermark (Perth) in `generate()`, after the decoder and independently of the weights; the 52 Chatterbox files of audio.cpp (sources, headers, spec) contain no trace of it (checked on 2026-10-13 by reading all the files, not only by GitHub code search). The outputs are therefore **not** watermarked, and nothing makes it possible to recognise them as synthetic: to keep in mind for a voice-cloning tool. Not tested empirically with the Perth detector.

## Candidates not integrated (snapshot `audiocpp-families.json`, v0.9.1)

Only the families with a permissive licence and "supported" status are listed as leads. Each one requires its own
tests (voice, parameters, memory) before being added.

**Speech synthesis**

| Family | Languages (excerpt) | Licence | Remark |
|---|---|---|---|
| VoxCPM2 | ~30 languages including French | Apache-2.0 | cloning and voice creation |
| MOSS-TTS Local / Nano | 31 / 19 languages including French | Apache-2.0 | cloning |
| CosyVoice3 | 10 languages including French | Apache-2.0 | cloning |
| Magpie TTS | including French | NVIDIA Open Model License | commercial use allowed, conditions to read |
| VibeVoice | en, zh | MIT | long-form voices, no French |
| Supertonic 3 | ~31 languages | BigScience OpenRAIL-M | usage restrictions to pass on |
| Pocket TTS (de, es, it, pt) | other languages | CC-BY-4.0 | GGUF available; only fr and en are integrated (Dutch does not exist in GGUF) |
| Kokoro | including fr-fr | Apache-2.0 | status "community" |

Excluded for licence (research or non-commercial): OmniVoice (CC-BY-NC), Fish Audio, Higgs Audio TTS, IndexTTS2
(conditional).

**Transcription** (limited to reference voice excerpts, see `transcription.py`): Qwen3-ASR is integrated. Leads: Cohere Transcribe (Apache-2.0, 14 languages including French, 2.4 GB in Q8, **not tested**), Canary (CC-BY-4.0), Voxtral Realtime (Apache-2.0), Parakeet TDT (CC-BY-4.0, community). Excluded: CrisperWhisper (non-commercial).

**Other uses** (no matching section in the application for now): track separation (HTDemucs, MIT),
music (ACE-Step, MIT), voice conversion (Seed-VC: **GPL-3.0**, to review before any integration into
an MIT application), end-of-turn detection (Smart Turn, BSD-2).

## To check at review

0. Above all: redo the [manual tests](audiocpp-tests-manuels.md) if the build or an integrated family changes.
1. `scripts-local/review_components.py`: new version, new families, changes of status or licence.
2. Upstream release notes: Vulkan fixes, per-model coverage, ROCm build, Linux CUDA build that is not "colab".
3. Has the persistent server (`audiocpp_server`) become stable enough to replace one process per chunk?
4. Has a "community" or "experimental" model moved to "supported" (Kokoro, Moonshine)?
5. Seed-VC: see "Licence policy" below before any integration.
6. Chatterbox: does the audio.cpp implementation cover the 23 upstream languages, does it have a built-in voice, has it added a watermark?
   Pocket TTS GGUF French: the v0.9.1 spec does not declare it but the binary reads it; check that a published version declares it.
7. Re-measure memory and speed of the reference model (table above) if the build changes.
8. Validate Vulkan, CUDA and CPU on a real machine (see limits) and note the result here.

## Licence policy

- **Download on demand only, never bundled.** The application redistributes no model; the audio.cpp
  binaries are downloaded from the official releases. If the installers ever bundle these binaries, first check
  which models the build compiles (upstream option `--model-set`): a copyleft family in the binary would impose
  redistribution obligations.
- **Seed-VC (voice conversion): GPL-3.0** for the code and the weights (Hugging Face tag), repository archived since
  2025-11-21. Decision: if we ever integrate it, it will be on-demand download only (like eSpeak-ng), never bundled,
  with the licence displayed in the model selector. Permissive alternatives: MeanVC2 (Apache-2.0), OpenVoice V2 (MIT).
  No integration has been done to date.
- The licences of each family come from audio.cpp's `docs/model_licenses.md` (copy in the JSON snapshot); the
  licence that prevails is that of the model's original repository.
