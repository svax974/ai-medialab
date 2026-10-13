# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Audio models (TTS, transcription).

Each model belongs to a "pack": an isolated Python environment installed on demand (see
`audio_packs.py`) that runs `audio_runtime/worker.py`. `engine` is a "module:Class" inside that
runtime, not in the server.
"""

from __future__ import annotations

import platform
import sys

from .base import AudioCaps, HfSource, Language, ModelSpec, ParamSpec, PresetVoice

F, M = "f", "m"


def _langs(*pairs: tuple[str, str]) -> list[Language]:
    return [Language(c, l) for c, l in pairs]


FR, EN, DE, ES, IT, PT, NL = ("fr", "Français"), ("en", "English"), ("de", "Deutsch"), ("es", "Español"), \
    ("it", "Italiano"), ("pt", "Português"), ("nl", "Nederlands")

SPEED = ParamSpec("speed", "Vitesse de parole", "float", 1.0, 0.6, 1.5, 0.05, "1 = vitesse naturelle. Les valeurs extrêmes sonnent moins naturelles.")

# Kokoro

_KOKORO_VOICES = [
    PresetVoice("ff_siwis", "Siwis", "fr", F, "Voix française naturelle, claire"),
    *[PresetVoice(i, n, "en", F, d) for i, n, d in [
        ("af_heart", "Heart", "Américaine · chaleureuse (la plus naturelle)"), ("af_bella", "Bella", "Américaine · expressive"),
        ("af_nicole", "Nicole", "Américaine · douce, proche du micro"), ("af_sarah", "Sarah", "Américaine · posée"),
        ("af_sky", "Sky", "Américaine · légère"), ("af_nova", "Nova", "Américaine · dynamique"),
        ("af_aoede", "Aoede", "Américaine · claire"), ("af_kore", "Kore", "Américaine · assurée"),
        ("af_jessica", "Jessica", "Américaine · décontractée"), ("af_river", "River", "Américaine · calme"),
        ("af_alloy", "Alloy", "Américaine · neutre"),
    ]],
    *[PresetVoice(i, n, "en", M, d) for i, n, d in [
        ("am_michael", "Michael", "Américain · grave, posé"), ("am_fenrir", "Fenrir", "Américain · puissant"),
        ("am_puck", "Puck", "Américain · espiègle"), ("am_adam", "Adam", "Américain · neutre"),
        ("am_echo", "Echo", "Américain · net"), ("am_eric", "Eric", "Américain · franc"),
        ("am_liam", "Liam", "Américain · jeune"), ("am_onyx", "Onyx", "Américain · profond"),
    ]],
    *[PresetVoice(i, n, "en", F, d) for i, n, d in [
        ("bf_emma", "Emma", "Britannique · élégante"), ("bf_isabella", "Isabella", "Britannique · douce"),
        ("bf_alice", "Alice", "Britannique · claire"), ("bf_lily", "Lily", "Britannique · légère"),
    ]],
    *[PresetVoice(i, n, "en", M, d) for i, n, d in [
        ("bm_george", "George", "Britannique · distingué"), ("bm_fable", "Fable", "Britannique · conteur"),
        ("bm_lewis", "Lewis", "Britannique · posé"), ("bm_daniel", "Daniel", "Britannique · grave"),
    ]],
    PresetVoice("ef_dora", "Dora", "es", F), PresetVoice("em_alex", "Alex", "es", M),
    PresetVoice("if_sara", "Sara", "it", F), PresetVoice("im_nicola", "Nicola", "it", M),
    PresetVoice("pf_dora", "Dora", "pt", F), PresetVoice("pm_alex", "Alex", "pt", M),
]

KOKORO = ModelSpec(
    id="kokoro-82m",
    name="Kokoro 82M",
    family="Kokoro",
    kind="audio",
    description="Très léger et quasi instantané, même sans GPU. Voix intégrées de bonne qualité (pas de clonage). "
                "Idéal pour des lectures longues et des essais rapides.",
    engine="kokoro_engine:KokoroEngine",
    backend="pack",
    options={"pack": "speech"},
    text_to_image=False,
    params=[SPEED],
    sources=[HfSource("hexgrad/Kokoro-82M", ["config.json", "kokoro-v1_0.pth", "voices/*.pt"],
                      ["config.json", "kokoro-v1_0.pth", "voices/ff_siwis.pt", "voices/af_heart.pt", "voices/am_michael.pt",
                       "voices/bf_emma.pt"], 0.37)],
    download_size_gb=0.37,
    weights_gb=0.4,
    license="Apache-2.0",
    tags=["rapide", "léger", "CPU"],
    precision="fp32",
    audio=AudioCaps(
        languages=_langs(FR, EN, ES, IT, PT),
        voices=_KOKORO_VOICES,
        clone="none",
        speed=True,
        max_chars=500,
    ),
)

# Pocket TTS (Kyutai)

_POCKET_FEMALE = {"alba": "Alba", "cosette": "Cosette", "eponine": "Éponine", "fantine": "Fantine", "jane": "Jane"}
_POCKET_MALE = {"jean": "Jean", "marius": "Marius", "javert": "Javert", "charles": "Charles", "paul": "Paul",
                "michael": "Michael"}
_POCKET_BASE = [*_POCKET_FEMALE, *_POCKET_MALE]


def _pocket_voices(lang: str, extra: list[PresetVoice] = ()) -> list[PresetVoice]:
    out = [PresetVoice(k, v, lang, F) for k, v in _POCKET_FEMALE.items()]
    out += [PresetVoice(k, v, lang, M) for k, v in _POCKET_MALE.items()]
    return [*out, *extra]


def _pocket_sources(models_langs: list[str], voices: list[str]) -> list[HfSource]:
    model_patterns = [f"languages/{l}/model.safetensors" for l in models_langs]
    aux: list[str] = []
    for l in models_langs:
        aux += [f"languages/{l}/tokenizer.*"] + [f"languages/{l}/embeddings/{v}.safetensors" for v in voices]
    check = [f"languages/{models_langs[0]}/tokenizer.json", f"languages/{models_langs[0]}/embeddings/{voices[0]}.safetensors"]
    return [
        HfSource("kyutai/pocket-tts", model_patterns, model_patterns, 0.22 * len(models_langs)),
        HfSource("kyutai/pocket-tts-without-voice-cloning", aux, check, 0.07 * len(models_langs)),
    ]


POCKET = ModelSpec(
    id="pocket-tts",
    name="Pocket TTS · FR / EN",
    family="Pocket TTS",
    kind="audio",
    description="Modèle Kyutai de 100 M de paramètres : plus rapide que le temps réel sur simple processeur, "
                "avec clonage de voix à partir de quelques secondes d'enregistrement.",
    engine="pocket_engine:PocketEngine",
    backend="pack",
    options={"pack": "speech", "language": "fr"},
    text_to_image=False,
    sources=_pocket_sources(["english", "french"], _POCKET_BASE + ["estelle"]),
    download_size_gb=0.65,
    weights_gb=0.6,
    license="CC-BY-4.0",
    tags=["clonage", "rapide", "CPU"],
    precision="bf16",
    audio=AudioCaps(
        languages=_langs(FR, EN),
        voices=[*_pocket_voices("en"), *_pocket_voices("fr", [PresetVoice("estelle", "Estelle", "fr", F, "Voix d'assistante")])],
        clone="optional",
        max_chars=320,
    ),
)
# Same engine, other languages (one 220 MB model per language).
POCKET_INTL = ModelSpec(
    id="pocket-tts-intl",
    name="Pocket TTS · DE / ES / IT / PT / NL",
    family="Pocket TTS",
    kind="audio",
    description="Pocket TTS pour l'allemand, l'espagnol, l'italien, le portugais et le néerlandais (clonage inclus).",
    engine="pocket_engine:PocketEngine",
    backend="pack",
    options={"pack": "speech", "language": "de"},
    text_to_image=False,
    sources=_pocket_sources(["german", "spanish", "italian", "portuguese", "dutch"], _POCKET_BASE),
    download_size_gb=1.45,
    weights_gb=0.6,
    license="CC-BY-4.0",
    tags=["clonage", "multilingue", "CPU"],
    precision="bf16",
    audio=AudioCaps(
        languages=_langs(DE, ES, IT, PT, NL),
        voices=[v for l in ("de", "es", "it", "pt", "nl") for v in _pocket_voices(l)],
        clone="optional",
        max_chars=320,
    ),
)

# Qwen3-TTS

QWEN_LANGS = _langs(("zh", "中文"), EN, ("ja", "日本語"), ("ko", "한국어"), DE, FR, ("ru", "Русский"), PT, ES, IT)

_QWEN_SPEAKERS = [
    PresetVoice("Vivian", "Vivian", "*", F, "Jeune femme, voix claire et un peu mordante (chinois)"),
    PresetVoice("Serena", "Serena", "*", F, "Jeune femme douce et chaleureuse (chinois)"),
    PresetVoice("Ono_Anna", "Ono Anna", "*", F, "Japonaise enjouée, timbre léger"),
    PresetVoice("Sohee", "Sohee", "*", F, "Coréenne chaleureuse, riche en émotion"),
    PresetVoice("Ryan", "Ryan", "*", M, "Américain dynamique, rythme marqué"),
    PresetVoice("Aiden", "Aiden", "*", M, "Américain solaire, médium clair"),
    PresetVoice("Eric", "Eric", "*", M, "Chengdu : voix vive et légèrement rauque"),
    PresetVoice("Dylan", "Dylan", "*", M, "Pékinois jeune, naturel"),
    PresetVoice("Uncle_Fu", "Uncle Fu", "*", M, "Homme mûr, timbre grave et velouté"),
]


def _qwen_sources(name: str, gb: float) -> list[HfSource]:
    return [HfSource(f"Qwen/Qwen3-TTS-12Hz-{name}", None,
                     ["config.json", "model.safetensors", "speech_tokenizer/model.safetensors"], gb)]


def _qwen(id: str, name: str, repo: str, gb: float, caps: AudioCaps, description: str, tags: list[str],
          params: list[ParamSpec] | None = None, twin: str = "") -> ModelSpec:
    # `twin`: the same model in GGUF for audio.cpp (any GPU), suggested when this one would run on the CPU.
    return ModelSpec(
        id=id, name=name, family="Qwen3-TTS", kind="audio", description=description,
        engine="qwen3_engine:Qwen3Engine", backend="pack",
        options={"pack": "qwen3", "variant": repo.split("-")[-1].lower(), "repo": f"Qwen/Qwen3-TTS-12Hz-{repo}",
                 "twin": twin},
        text_to_image=False, params=params or [], sources=_qwen_sources(repo, gb),
        download_size_gb=gb, weights_gb=gb, license="Apache-2.0", tags=tags, audio=caps, precision="bf16",
    )


_QWEN_TEMPERATURE = ParamSpec("temperature", "Variabilité", "float", 0.9, 0.3, 1.4, 0.05,
                              "Plus haut = intonations plus variées, moins stables.", advanced=True)
_QWEN_STYLE = "Décrivez le ton : « chuchoté », « voix chaleureuse et posée, débit lent », « enthousiaste »…"

QWEN_CUSTOM = _qwen(
    "qwen3-tts-custom", "Qwen3-TTS · Voix & style 1.7B", "1.7B-CustomVoice", 4.52,
    AudioCaps(languages=QWEN_LANGS, voices=_QWEN_SPEAKERS, clone="none", instruct=True, instruct_help=_QWEN_STYLE,
              max_chars=400),
    "Neuf voix premium multilingues, pilotables par une consigne de style en langage naturel (émotion, débit, ton).",
    ["style", "multilingue", "GPU"], [_QWEN_TEMPERATURE],
    twin="qwen3-tts-gguf-custom",
)
QWEN_CUSTOM_SMALL = _qwen(
    "qwen3-tts-custom-small", "Qwen3-TTS · Voix & style 0.6B", "0.6B-CustomVoice", 2.52,
    AudioCaps(languages=QWEN_LANGS, voices=_QWEN_SPEAKERS, clone="none", instruct=False, max_chars=400),
    "Version compacte de Qwen3-TTS : mêmes neuf voix multilingues, deux fois plus légère (sans consigne de style).",
    ["multilingue", "léger"], [_QWEN_TEMPERATURE],
)
QWEN_DESIGN = _qwen(
    "qwen3-tts-design", "Qwen3-TTS · Création de voix 1.7B", "1.7B-VoiceDesign", 4.52,
    AudioCaps(languages=QWEN_LANGS, voices=[], clone="none", instruct=True, design=True,
              instruct_help="Décrivez la voix : « femme de 30 ans, voix grave et rassurante, légèrement rauque »…",
              max_chars=400),
    "Inventez une voix à partir d'une simple description (âge, timbre, caractère, émotion). Enregistrez celles que "
    "vous aimez dans votre bibliothèque.",
    ["voice design", "multilingue", "GPU"], [_QWEN_TEMPERATURE],
    twin="qwen3-tts-gguf-design",
)
QWEN_CLONE = _qwen(
    "qwen3-tts-clone", "Qwen3-TTS · Clonage 1.7B", "1.7B-Base", 4.54,
    AudioCaps(languages=QWEN_LANGS, voices=[], clone="optional", max_chars=400),
    "Clonage de voix multilingue à partir de quelques secondes d'enregistrement ; la transcription de l'extrait "
    "améliore la fidélité.",
    ["clonage", "multilingue", "GPU"], [_QWEN_TEMPERATURE],
    twin="qwen3-tts-gguf-clone",
)
QWEN_CLONE_SMALL = _qwen(
    "qwen3-tts-clone-small", "Qwen3-TTS · Clonage 0.6B", "0.6B-Base", 2.52,
    AudioCaps(languages=QWEN_LANGS, voices=[], clone="optional", max_chars=400),
    "Clonage de voix multilingue, version compacte.",
    ["clonage", "multilingue", "léger"], [_QWEN_TEMPERATURE],
    twin="qwen3-tts-gguf-clone-small",
)

# Transcription (of a reference voice sample)

# On Apple Silicon Whisper runs on Metal through mlx-whisper (mlx-community conversions); elsewhere
# through faster-whisper / CTranslate2 on the CPU.
_APPLE = sys.platform == "darwin" and platform.machine() == "arm64"
_WHISPER_REPOS = {
    "whisper-small": ("mlx-community/whisper-small-mlx", ["weights.npz", "config.json"], 0.48)
    if _APPLE else ("Systran/faster-whisper-small", ["model.bin", "config.json", "tokenizer.json"], 0.49),
    "whisper-large-v3-turbo": ("mlx-community/whisper-large-v3-turbo", ["weights.safetensors", "config.json"], 1.61)
    if _APPLE else ("deepdml/faster-whisper-large-v3-turbo-ct2", ["model.bin", "config.json", "tokenizer.json"], 1.62),
}


def _whisper(id: str, name: str, description: str, weights_gb: float, tags: list[str]) -> ModelSpec:
    repo, check, size = _WHISPER_REPOS[id]
    return ModelSpec(
        id=id, name=name, family="Whisper", kind="audio", description=description,
        engine="", backend="pack", options={"pack": "speech", "repo": repo}, text_to_image=False,
        sources=[HfSource(repo, None, check, size)],
        download_size_gb=size, weights_gb=weights_gb, license="MIT",
        tags=tags + (["Metal"] if _APPLE else []), precision="fp16",
        audio=AudioCaps(task="stt", languages=[]),
    )


WHISPER_SMALL = _whisper(
    "whisper-small", "Whisper Small",
    "Transcrit l'extrait d'une voix à cloner (la transcription améliore la fidélité du clonage). "
    "Rapide, multilingue.", 0.5, ["transcription"] + ([] if _APPLE else ["CPU"]))
WHISPER_TURBO = _whisper(
    "whisper-large-v3-turbo", "Whisper Large v3 Turbo",
    "Transcription de haute précision, plus lente et plus gourmande que Whisper Small.", 1.7, ["transcription"])

SPECS: list[ModelSpec] = [
    KOKORO, POCKET, POCKET_INTL, QWEN_CUSTOM, QWEN_DESIGN, QWEN_CLONE, QWEN_CUSTOM_SMALL, QWEN_CLONE_SMALL,
    WHISPER_SMALL, WHISPER_TURBO,
]
