"""Contrat commun des moteurs de génération.

Un modèle = une `ModelSpec` (métadonnées, capacités, paramètres exposés à l'interface)
+ une classe `Engine` (chargement et génération, exécutée dans le processus worker).

Pour ajouter un modèle : créer un module dans `app/engines/`, y définir une spec et un moteur,
puis l'inscrire dans `app/engines/__init__.py`.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from PIL import Image

ReferenceMode = Literal["none", "init", "multi"]


@dataclass
class ParamSpec:
    key: str
    label: str
    type: Literal["int", "float", "text"]
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    help: str = ""
    advanced: bool = False
    # Paramètre affiché seulement quand des images de référence sont jointes.
    requires_references: bool = False


Backend = Literal["mlx", "torch", "sdcpp", "pack", "demo"]
Kind = Literal["image", "audio"]


@dataclass
class PresetVoice:
    """Voix intégrée à un modèle de synthèse vocale."""

    id: str
    name: str
    language: str  # code (« fr », « en »…) ; "*" = toutes les langues du modèle
    gender: Literal["f", "m", "n"] = "n"
    description: str = ""


@dataclass
class Language:
    code: str
    label: str


@dataclass
class AudioCaps:
    """Capacités d'un modèle audio (synthèse vocale) : ce que l'interface peut proposer."""

    task: Literal["tts", "stt"] = "tts"
    languages: list[Language] = field(default_factory=list)
    voices: list[PresetVoice] = field(default_factory=list)
    # Clonage depuis un extrait : "none", "optional" (la transcription améliore) ou "required".
    clone: Literal["none", "optional", "required"] = "none"
    # Consigne de style en langage naturel (« ton chaleureux, voix posée… »).
    instruct: bool = False
    instruct_help: str = ""
    # Création d'une voix à partir d'une description (la description EST la voix).
    design: bool = False
    speed: bool = False
    # Balises à insérer dans le texte (« [rire] »…).
    tags: list[str] = field(default_factory=list)
    max_chars: int = 600
    sample_rate: int = 24000


@dataclass
class HfSource:
    """Un dépôt Hugging Face (ou une partie) dont dépend un modèle."""

    repo: str
    patterns: list[str] | None = None  # fichiers à télécharger (fnmatch) ; None = tout le dépôt
    check_files: list[str] = field(default_factory=list)  # motifs requis pour être « installé »
    size_gb: float | None = None  # taille approximative, pour la progression globale


@dataclass
class Variant:
    """Une quantification d'un même modèle : seuls les fichiers de poids changent, pas le modèle.

    Choisir une variante ne télécharge que celle-là (aucune copie inutile) ; `sources` et `options` remplacent ceux
    du modèle, le reste (paramètres, références, encodeurs communs) reste identique."""

    key: str
    label: str  # « Q4_K », « 4 bits »…
    size_gb: float
    sources: list["HfSource"]
    options: dict[str, Any] = field(default_factory=dict)  # fusionnées dans ModelSpec.options
    weights_gb: float | None = None
    largest_component_gb: float | None = None


@dataclass
class ModelSpec:
    id: str
    name: str
    family: str
    description: str
    engine: str  # "module:Classe", importé paresseusement dans le worker
    # Moteur d'inférence requis : "mlx" (Metal natif, Mac), "torch" (CUDA / ROCm / MPS), "demo".
    backend: Backend = "mlx"
    # Références : "none" (texte seul), "init" (1 image de départ, img2img), "multi" (édition multi-images)
    reference_mode: ReferenceMode = "none"
    max_references: int = 0
    requires_references: bool = False
    text_to_image: bool = True
    params: list[ParamSpec] = field(default_factory=list)
    size_multiple: int = 16
    min_side: int = 256
    max_side: int = 2048
    default_megapixels: float = 1.0
    quantize_options: list[int] = field(default_factory=lambda: [3, 4, 5, 6, 8])
    default_quantize: int | None = 8
    # --- Téléchargement (Hugging Face) ---
    hf_repo: str | None = None
    # Fichiers à télécharger (motifs fnmatch, relatifs à la racine du dépôt) ; None = tout le dépôt.
    hf_patterns: list[str] | None = None
    # Motifs qui doivent tous correspondre à au moins un fichier pour que le modèle soit « installé ».
    check_files: list[str] = field(default_factory=list)
    download_size_gb: float | None = None
    license: str = ""
    gated: bool = False
    # --- Mémoire ---
    weights_gb: float | None = None  # poids chargés en pleine précision
    largest_component_gb: float | None = None
    memory_hint: str = ""
    tags: list[str] = field(default_factory=list)
    # Précision des poids affichée (« Q4_K », « bf16 »…) ; vide = déduite (voir catalog.precision_of).
    precision: str = ""
    # Modèle ajouté par l'utilisateur depuis Hugging Face (voir engines/custom.py).
    custom: bool = False
    # Nature du modèle : "image" (génération d'images) ou "audio" (synthèse vocale, transcription).
    kind: Kind = "image"
    audio: AudioCaps | None = None
    # Options propres au moteur (classe de pipeline, noms d'arguments…).
    options: dict[str, Any] = field(default_factory=dict)
    # Modèles composés de plusieurs dépôts (ex. GGUF + encodeur + VAE) : prime sur hf_repo.
    sources: list[HfSource] = field(default_factory=list)
    # Quantifications disponibles. `sources`/`options` ci-dessus décrivent la variante par défaut.
    variants: list[Variant] = field(default_factory=list)
    default_variant: str = ""
    variant: str = ""  # variante effectivement sélectionnée (renseignée par `with_variant`)

    def all_sources(self) -> list[HfSource]:
        if self.sources:
            return self.sources
        if self.hf_repo:
            return [HfSource(self.hf_repo, self.hf_patterns, self.check_files, self.download_size_gb)]
        return []

    def default_params(self) -> dict[str, Any]:
        return {p.key: p.default for p in self.params}

    def to_public(self) -> dict[str, Any]:
        d = asdict(self)
        d["variants"] = [{"key": v.key, "label": v.label, "size_gb": v.size_gb} for v in self.variants]
        d.pop("engine")
        d.pop("options")
        d.pop("hf_patterns")
        d.pop("check_files")
        d.pop("sources")
        return d


def with_variant(spec: ModelSpec, key: str | None) -> ModelSpec:
    """La spec telle qu'elle doit être utilisée pour la quantification `key` (défaut si inconnue)."""
    import copy

    if not spec.variants:
        return spec
    chosen = next((v for v in spec.variants if v.key == key), None) or \
        next((v for v in spec.variants if v.key == spec.default_variant), spec.variants[0])
    out = copy.copy(spec)
    out.variant = chosen.key
    out.sources = list(chosen.sources)
    out.options = {**spec.options, **chosen.options}
    out.download_size_gb = chosen.size_gb
    out.precision = chosen.label
    if chosen.weights_gb is not None:
        out.weights_gb = chosen.weights_gb
    if chosen.largest_component_gb is not None:
        out.largest_component_gb = chosen.largest_component_gb
    return out


def hf_hub_dir() -> Path:
    from huggingface_hub import constants

    return Path(constants.HF_HUB_CACHE)


def repo_cache_dir(repo: str) -> Path:
    return hf_hub_dir() / f"models--{repo.replace('/', '--')}"


def _matches(rel: str, patterns: list[str]) -> bool:
    from fnmatch import fnmatch

    return any(fnmatch(rel, p) for p in patterns)


def _source_status(src: HfSource) -> dict[str, Any]:
    root = repo_cache_dir(src.repo)
    snapshots = root / "snapshots"
    best: tuple[int, Path] | None = None
    if snapshots.is_dir():
        for snap in snapshots.iterdir():
            if not snap.is_dir():
                continue
            files = [p.relative_to(snap).as_posix() for p in snap.rglob("*") if p.is_file() or p.is_symlink()]
            if src.check_files:
                ok = sum(1 for pat in src.check_files if any(_matches(f, [pat]) for f in files))
            else:
                ok = 1 if any(f.endswith((".safetensors", ".gguf")) for f in files) else 0
            if best is None or ok > best[0]:
                best = (ok, snap)
    needed = len(src.check_files) or 1
    size = 0
    if best:
        snap = best[1]
        for p in snap.rglob("*"):
            rel = p.relative_to(snap).as_posix()
            if (src.patterns is None or _matches(rel, src.patterns)) and (p.is_file() or p.is_symlink()):
                try:
                    size += p.stat().st_size
                except OSError:
                    pass
    incomplete = (root / "blobs").is_dir() and any((root / "blobs").glob("*.incomplete"))
    if best and best[0] >= needed:
        state = "installed"  # des .incomplete résiduels (téléchargements annulés) ne changent rien
    elif (best and best[0] > 0) or incomplete:
        state = "partial"
    else:
        state = "missing"
    return {"state": state, "size": size}


def installation_status(spec: ModelSpec) -> dict[str, Any]:
    """État d'installation d'un modèle d'après le cache Hugging Face (partagé avec mflux et diffusers).

    state : "installed" | "partial" (fichiers requis manquants ou téléchargement interrompu) | "missing".
    Un modèle composé de plusieurs dépôts n'est « installé » que si chacun l'est.
    """
    sources = spec.all_sources()
    if not sources:
        return {"state": "installed", "size_gb": 0.0}
    parts = [_source_status(src) for src in sources]
    states = {p["state"] for p in parts}
    if states == {"installed"}:
        state = "installed"
    elif states == {"missing"}:
        state = "missing"
    else:
        state = "partial"
    return {"state": state, "size_gb": round(sum(p["size"] for p in parts) / 1024**3, 2)}


@dataclass
class GenerationRequest:
    prompt: str
    width: int
    height: int
    steps: int
    seed: int
    guidance: float | None = None
    negative_prompt: str | None = None
    references: list[str] = field(default_factory=list)
    strength: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class GenerationCancelled(Exception):
    pass


@dataclass
class Hooks:
    """Fonctions fournies par le worker au moteur pendant une génération."""

    on_step: Callable[[int, int], None]
    on_preview: Callable[[Image.Image], None]
    is_cancelled: Callable[[], bool]
    preview_every: int = 0  # 0 = pas d'aperçu intermédiaire


class Engine:
    """Classe de base. Exécutée uniquement dans le processus worker."""

    def __init__(self, spec: ModelSpec, quantize: int | None, options: dict[str, Any] | None = None):
        self.spec = spec
        self.quantize = quantize
        self.options = options or {}

    def load(self) -> None:
        raise NotImplementedError

    def generate(self, req: GenerationRequest, hooks: Hooks) -> Image.Image:
        """Retourne l'image finale (PIL). Doit lever GenerationCancelled si annulé."""
        raise NotImplementedError

    def save(self, result: Any, path: Path) -> None:
        result.save(path)
