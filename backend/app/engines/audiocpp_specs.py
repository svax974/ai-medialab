# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Audio models run by audio.cpp (GGUF, ggml): Metal, CUDA, Vulkan or CPU, without PyTorch.

Same models and controls as their PyTorch counterparts in `audio_specs.py`; these are the alternative that runs on
any GPU (AMD, Intel, NVIDIA through Vulkan). The engine itself is the `audiocpp` pack (`audio_packs.py`,
`audiocpp.py`), the worker side is `audio_runtime/engines/audiocpp_engine.py`. Every integrated family is
documented in `docs/components/audiocpp.md` (licence, upstream status, last review).

Weights come from the upstream conversion repo, `audio-cpp/audio.cpp-gguf`.
"""

from __future__ import annotations

from .audio_specs import (_POCKET_BASE, _QWEN_SPEAKERS, _QWEN_STYLE, _QWEN_TEMPERATURE, EN, F, FR, QWEN_LANGS, _langs,
                          _pocket_voices)
from .base import AudioCaps, HfSource, Language, ModelSpec, ParamSpec, PresetVoice

REPO = "audio-cpp/audio.cpp-gguf"
ENGINE = "audiocpp_engine:AudioCppEngine"


def _qwen(id: str, name: str, folder: str, file: str, gb: float, mode: str, caps: AudioCaps, description: str,
          tags: list[str]) -> ModelSpec:
    path = f"{folder}/{file}"
    return ModelSpec(
        id=id, name=name, family="Qwen3-TTS", kind="audio", description=description, engine=ENGINE, backend="pack",
        options={"pack": "audiocpp", "family": "qwen3_tts", "repo": REPO, "file": path, "mode": mode,
                 "language": "names", "request": ["seed", "temperature"], "max_chars": 400},
        text_to_image=False, params=[_QWEN_TEMPERATURE], sources=[HfSource(REPO, [path], [path], gb)],
        download_size_gb=gb, weights_gb=gb, license="Apache-2.0", tags=["GGUF", "tout GPU", *tags], audio=caps,
        precision="Q8_0",
    )


QWEN_GGUF_CUSTOM = _qwen(
    "qwen3-tts-gguf-custom", "Qwen3-TTS · Voix & style 1.7B (GGUF)", "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF",
    "qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf", 2.82, "preset",
    AudioCaps(languages=QWEN_LANGS, voices=_QWEN_SPEAKERS, clone="none", instruct=True, instruct_help=_QWEN_STYLE,
              max_chars=400),
    "Les neuf voix premium de Qwen3-TTS, pilotables par une consigne de style, en version GGUF : tourne sur toute "
    "carte graphique (Metal, CUDA, Vulkan) ou sur processeur, sans PyTorch.",
    ["style", "multilingue"])
QWEN_GGUF_DESIGN = _qwen(
    "qwen3-tts-gguf-design", "Qwen3-TTS · Création de voix 1.7B (GGUF)", "Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF",
    "qwen3-tts-12hz-1.7b-voicedesign-q8_0.gguf", 2.82, "design",
    AudioCaps(languages=QWEN_LANGS, voices=[], clone="none", instruct=True, design=True,
              instruct_help="Décrivez la voix : « femme de 30 ans, voix grave et rassurante, légèrement rauque »…",
              max_chars=400),
    "Inventez une voix à partir d'une description, en version GGUF (toute carte graphique ou processeur).",
    ["voice design", "multilingue"])
QWEN_GGUF_CLONE = _qwen(
    "qwen3-tts-gguf-clone", "Qwen3-TTS · Clonage 1.7B (GGUF)", "Qwen3-TTS-12Hz-1.7B-Base-GGUF",
    "qwen3-tts-12hz-1.7b-base-q8_0_v2.gguf", 2.70, "clone",
    AudioCaps(languages=QWEN_LANGS, voices=[], clone="optional", max_chars=400),
    "Clonage de voix multilingue à partir de quelques secondes d'enregistrement, en version GGUF.",
    ["clonage", "multilingue"])
QWEN_GGUF_CLONE_SMALL = _qwen(
    "qwen3-tts-gguf-clone-small", "Qwen3-TTS · Clonage 0.6B (GGUF)", "Qwen3-TTS-12Hz-0.6B-Base-GGUF",
    "qwen3-tts-12hz-0.6b-base-q8_0.gguf", 1.99, "clone",
    AudioCaps(languages=QWEN_LANGS, voices=[], clone="optional", max_chars=400),
    "Clonage de voix multilingue, version compacte en GGUF.", ["clonage", "multilingue", "léger"])

# Chatterbox (Resemble AI, MIT): expressive multilingual cloning. audio.cpp exposes it as a cloning task only: a
# reference voice is required. Languages are the ones audio.cpp implements (upstream announces more).
CHATTERBOX_LANGS = [Language(c, l) for c, l in [
    ("ar", "العربية"), ("da", "Dansk"), ("de", "Deutsch"), ("el", "Ελληνικά"), ("en", "English"), ("es", "Español"),
    ("fi", "Suomi"), ("fr", "Français"), ("hi", "हिन्दी"), ("it", "Italiano"), ("ko", "한국어"), ("ms", "Bahasa Melayu"),
    ("nl", "Nederlands"), ("no", "Norsk"), ("pl", "Polski"), ("pt", "Português"), ("sv", "Svenska"),
    ("sw", "Kiswahili"), ("tr", "Türkçe")]]
_CB_EXAGGERATION = ParamSpec("exaggeration", "Expressivité", "float", 0.5, 0.25, 1.5, 0.05,
                             "0,5 = neutre. Vers 0,7 et plus : voix plus dramatique, qui tend aussi à parler plus vite.")
_CB_CFG = ParamSpec("guidance_scale", "Fidélité à la voix", "float", 0.5, 0.0, 1.0, 0.05,
                    "Autour de 0,3 pour une voix de référence rapide ou une diction expressive. 0 si la langue de "
                    "l'échantillon diffère de la langue générée (sinon l'accent de l'échantillon se reporte).",
                    advanced=True)
_CB_TEMPERATURE = ParamSpec("temperature", "Variabilité", "float", 0.8, 0.3, 1.4, 0.05,
                            "Plus haut = intonations plus variées, moins stables.", advanced=True)
CHATTERBOX_GGUF = ModelSpec(
    id="chatterbox-gguf", name="Chatterbox · Clonage expressif (GGUF)", family="Chatterbox", kind="audio",
    description="Clonage de voix expressif en 19 langues (français inclus), avec réglage de l'expressivité. Exige un "
                "échantillon de voix (une dizaine de secondes, dans la langue visée de préférence). Tourne sur toute "
                "carte graphique ou sur processeur. Contrairement à l'implémentation d'origine de l'éditeur, ce portage n'ajoute pas de filigrane inaudible aux sorties : à vous de signaler qu'une voix est synthétique.",
    engine=ENGINE, backend="pack",
    options={"pack": "audiocpp", "family": "chatterbox", "repo": REPO, "file": "Chatterbox-GGUF/chatterbox-q8_0.gguf",
             "mode": "clone", "task": "clon", "request": ["seed", "temperature", "exaggeration", "guidance_scale"],
             "max_chars": 300},
    text_to_image=False, params=[_CB_EXAGGERATION, _CB_CFG, _CB_TEMPERATURE],
    sources=[HfSource(REPO, ["Chatterbox-GGUF/chatterbox-q8_0.gguf"], ["Chatterbox-GGUF/chatterbox-q8_0.gguf"], 2.09)],
    download_size_gb=2.09, weights_gb=2.09, license="MIT", tags=["GGUF", "tout GPU", "clonage", "multilingue", "expressif"],
    audio=AudioCaps(languages=CHATTERBOX_LANGS, voices=[], clone="required", max_chars=300), precision="Q8_0",
)

# Pocket TTS (Kyutai, CC-BY-4.0): one small GGUF per language, preset voices are `embeddings/<voice>.safetensors` next to
# the model (audio.cpp reads them there), so the voices offered are downloaded with it. French and English, like the
# PyTorch version. audio.cpp's French package is declared on its `main` branch only (not in the v0.9.1 spec files);
# the v0.9.1 binary reads it all the same (checked 2026-10-13, see docs/components/audiocpp.md).
_POCKET_DIR = {"fr": "french", "en": "english"}
_POCKET_VOICES = [*_POCKET_BASE, "estelle"]


def _pocket_files(variant: str) -> dict[str, str]:
    return {l: f"PocketTTS-GGUF/{d}/pocket-tts-{d}-{variant}.gguf" for l, d in _POCKET_DIR.items()}


_POCKET_PATTERNS = [*_pocket_files("q8_0").values()] + [
    f"PocketTTS-GGUF/{d}/embeddings/{v}.safetensors" for d in _POCKET_DIR.values() for v in _POCKET_VOICES]
POCKET_GGUF = ModelSpec(
    id="pocket-tts-gguf", name="Pocket TTS · FR / EN (GGUF)", family="Pocket TTS", kind="audio",
    description="Le modèle Kyutai de 100 M de paramètres en GGUF : très rapide sur simple processeur, et sur toute carte "
                "graphique (Metal, CUDA, Vulkan), avec clonage de voix. La langue se choisit à chaque génération.",
    engine=ENGINE, backend="pack",
    options={"pack": "audiocpp", "family": "pocket_tts", "repo": REPO, "files": _pocket_files("q8_0"), "mode": "preset",
             "clone": True, "voice_embeddings": "embeddings", "request": ["seed", "temperature"], "max_chars": 320},
    text_to_image=False, params=[],
    sources=[HfSource(REPO, _POCKET_PATTERNS, [*_pocket_files("q8_0").values(), "PocketTTS-GGUF/french/embeddings/alba.safetensors"], 0.4)],
    download_size_gb=0.4, weights_gb=0.3, license="CC-BY-4.0", tags=["GGUF", "tout GPU", "clonage", "rapide", "CPU"],
    audio=AudioCaps(languages=_langs(FR, EN),
                    voices=[*_pocket_voices("en"), *_pocket_voices("fr", [PresetVoice("estelle", "Estelle", "fr", F, "Voix d'assistante")])],
                    clone="optional", max_chars=320),
    precision="Q8_0",
)

# Transcription of the reference sample of a voice to clone (`transcription.py`). Qwen3-ASR (Alibaba, Apache-2.0):
# 31 languages, French included; with a language hint the result is the same as in auto mode on the French sample
# used for the checks (the hint is never validated by audio.cpp, a wrong one is silently accepted).
def _qwen_asr(id: str, name: str, folder: str, file: str, gb: float, description: str, tags: list[str]) -> ModelSpec:
    path = f"{folder}/{file}"
    return ModelSpec(
        id=id, name=name, family="Qwen3-ASR", kind="audio", description=description, engine="", backend="pack",
        options={"pack": "audiocpp", "family": "qwen3_asr", "repo": REPO, "file": path, "language_option": True},
        text_to_image=False, sources=[HfSource(REPO, [path], [path], gb)], download_size_gb=gb, weights_gb=gb,
        license="Apache-2.0", tags=["transcription", "GGUF", "tout GPU", *tags], precision="Q8_0",
        audio=AudioCaps(task="stt", languages=[]),
    )


QWEN_ASR_SMALL = _qwen_asr(
    "qwen3-asr-gguf-small", "Qwen3-ASR 0.6B (GGUF)", "Qwen3-ASR-0.6B-GGUF", "qwen3-asr-0.6b-q8_0.gguf", 1.15,
    "Transcrit l'extrait d'une voix à cloner (la transcription améliore la fidélité), en 31 langues. Léger et très "
    "rapide ; tourne sur toute carte graphique ou sur processeur, sans PyTorch.", ["léger"])
QWEN_ASR = _qwen_asr(
    "qwen3-asr-gguf", "Qwen3-ASR 1.7B (GGUF)", "Qwen3-ASR-1.7B-GGUF", "qwen3-asr-1.7b-q8_0.gguf", 2.47,
    "Version plus précise de Qwen3-ASR, pour les extraits difficiles (accent, bruit). Toute carte graphique ou processeur.",
    [])

SPECS: list[ModelSpec] = [QWEN_ASR_SMALL, QWEN_ASR, POCKET_GGUF, CHATTERBOX_GGUF, QWEN_GGUF_CUSTOM, QWEN_GGUF_DESIGN, QWEN_GGUF_CLONE, QWEN_GGUF_CLONE_SMALL]
