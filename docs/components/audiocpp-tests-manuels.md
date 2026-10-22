# Manual tests: audio.cpp, transcription, "slow" marker, Hugging Face search

To be done by you: what I could not run (no Vulkan/CUDA/AMD/Intel GPU here, application not launched).
Tick each step once done: `[ ]` to do · `[x]` OK · `[~]` OK with a reservation (note which one) · `[!]` failure (note the error).
Component sheet: [audiocpp.md](audiocpp.md). Machine, system, GPU and date: to note at the top of each pass.

*Last verified against source: 2026-10-13 (no reference to a stale path or route after the migration).*

Pass of ____ / ____ / ______ — machine: ______________________ — GPU: ______________________

## A. Engine installation (any machine)

- [ ] **Open Models → Audio and locate "Qwen3-TTS · Clonage 0.6B (GGUF)"**
  - Expected: badge "audio.cpp (ggml)", text "Standalone program: the precompiled audio.cpp engine…", button to install the engine (≈ 30 to 60 MB depending on the machine), no message about Python/uv.
- [ ] **Install the engine**
  - Expected: progress, then "Installed". The `VERSION.json` file of the folder `<engines>/audiocpp/<variant>/` gives the pinned version.
  - Expected installed variant: Mac Apple Silicon → `metal` · Windows NVIDIA → `cuda` · Windows/Linux AMD or Intel → `vulkan` · otherwise `cpu`. Note the variant obtained: ________
- [ ] **Check that the GPU is seen**: run `<engines>/audiocpp/<variant>/audiocpp_cli --list-devices`
  - Expected: a `[GPU]` line (for example `Vulkan0 "AMD Radeon…" [GPU]`). If only `[CPU]`: note it, this is the fallback.

## B. GGUF speech synthesis (on your GPU)

For each model, download then generate a sentence of 2 to 3 lines. Note the time and whether the voice is correct.

- [ ] **Pocket TTS · FR / EN (GGUF)** (≈ 0.4 GB): voice "Estelle" in French then "Alba" in English, then a cloning.
  - Expected: the chosen language is respected, voice intelligible, much faster than real time. Time: ________
- [ ] **Chatterbox · Clonage expressif (GGUF)** (≈ 2.1 GB): choose a voice from the library, generate in **French**, then in **English** and in **German** without changing voice.
  - Expected: the language follows the selector; without a chosen voice, the model asks for a reference voice. Set "Expressivité" to 0.5 then 0.9: the diction changes. Note the residual accent of the sample: ________
  - The port does not add the publisher's watermark (checked in the code, see audiocpp.md): nothing to check here.
- [ ] **Qwen3-TTS · Clonage 0.6B (GGUF)**: clone a voice in French.
  - Expected: voice close to the sample; with the transcription of the sample filled in, fidelity is better.
- [ ] **Qwen3-TTS 1.7B (GGUF): Voix & style, Création de voix, Clonage** (≈ 2.7 to 2.8 GB each)
  - Voice & style: try at least "Vivian", "Ryan" and a style instruction ("whispered"). Note the voices that fail: ________
  - Voice creation: "woman of 30, deep and reassuring voice".
- [ ] **Monitor the memory** during these tests: on a Vulkan GPU, video memory and RAM must not saturate. Note the peak: ________

## C. Transcription

- [ ] **Voice → New voice: record or import an extract of 10 to 20 s in French, installing nothing else than "Qwen3-ASR 0.6B (GGUF)"**
  - Expected: the "Transcrire automatiquement" button is available, the proposed text matches the extract, **the field remains editable**: correct a word, save the voice, reopen with the "Modifier" pencil: the correction is kept.
- [ ] **With Whisper AND Qwen3-ASR installed**: the transcription uses Whisper (by default).
- [ ] **Whisper downloaded but its "Voix légères" engine not installed, Qwen3-ASR installed**: the transcription still works (it switches to Qwen3-ASR).
- [ ] **Difficult extract (marked accent or background noise)**: compare Qwen3-ASR 0.6B, 1.7B and Whisper. Note which one makes the fewest mistakes: ________

## D. "Slow · processor" marker (AMD or Intel machine under Windows, or without GPU)

- [ ] **Models → Audio: locate "Qwen3-TTS · Clonage 1.7B" (PyTorch version)**
  - Expected on AMD/Intel Windows: "slow · processor" chip, orange message naming the GGUF alternative. On NVIDIA or Mac: no chip.
- [ ] **Kokoro, Pocket TTS, Whisper**: never a chip.
- [ ] **Recommended default model**: it is not a model marked slow.

## E. Hugging Face search and memory

- [ ] **Models → Add from Hugging Face: search for an image GGUF repository** (for example "Z-Image Turbo GGUF"), open a result.
  - Expected: the preselected quantization is one that fits in the memory; those that do not fit are struck through (tooltip with the figures) and, if one is selected, an orange message appears and "Ajouter et télécharger" is greyed out.
  - On a comfortable machine, no struck-through variant: note the RAM/VRAM: ________
- [ ] **Search for a PyTorch model (Stable Diffusion) on a machine without CUDA/ROCm/Metal**
  - Expected: result greyed out "incompatible with this machine", reason displayed, addition impossible.

## F. Vulkan / CUDA / CPU (to do at least once per available GPU type)

- [ ] **Force each installed build** (variable `IMAGEGEN_AUDIOCPP_VARIANT=vulkan`, `cuda` or `cpu`) and generate with Pocket FR then Chatterbox.
  - Expected: same result as in B; note any errors and the speed per build: ________
- [ ] **Note the result in the section "To check at review" of `audiocpp.md`** (point "Validate Vulkan, CUDA and CPU").
</content>
