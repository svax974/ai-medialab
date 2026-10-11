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


Backend = Literal["mlx", "torch", "demo"]


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
    # Options propres au moteur (classe de pipeline, noms d'arguments…).
    options: dict[str, Any] = field(default_factory=dict)

    def default_params(self) -> dict[str, Any]:
        return {p.key: p.default for p in self.params}

    def to_public(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("engine")
        d.pop("options")
        d.pop("hf_patterns")
        d.pop("check_files")
        return d


def hf_hub_dir() -> Path:
    from huggingface_hub import constants

    return Path(constants.HF_HUB_CACHE)


def repo_cache_dir(repo: str) -> Path:
    return hf_hub_dir() / f"models--{repo.replace('/', '--')}"


def _matches(rel: str, patterns: list[str]) -> bool:
    from fnmatch import fnmatch

    return any(fnmatch(rel, p) for p in patterns)


def installation_status(spec: ModelSpec) -> dict[str, Any]:
    """État d'installation d'un modèle d'après le cache Hugging Face.

    state : "installed" | "partial" (certains fichiers requis manquent ou un téléchargement est
    interrompu) | "missing". Le cache est partagé avec mflux et diffusers : un modèle déjà
    téléchargé par un autre outil est reconnu tel quel.
    """
    if not spec.hf_repo:
        return {"state": "installed", "size_gb": 0.0}
    root = repo_cache_dir(spec.hf_repo)
    snapshots = root / "snapshots"
    best: tuple[int, Path] | None = None
    if snapshots.is_dir():
        for snap in snapshots.iterdir():
            if not snap.is_dir():
                continue
            files = [p.relative_to(snap).as_posix() for p in snap.rglob("*") if p.is_file() or p.is_symlink()]
            if spec.check_files:
                ok = sum(1 for pat in spec.check_files if any(_matches(f, [pat]) for f in files))
            else:
                ok = 1 if any(f.endswith(".safetensors") for f in files) else 0
            if best is None or ok > best[0]:
                best = (ok, snap)
    needed = len(spec.check_files) or 1
    size = 0
    if best:
        snap = best[1]
        for p in snap.rglob("*"):
            rel = p.relative_to(snap).as_posix()
            if (spec.hf_patterns is None or _matches(rel, spec.hf_patterns)) and (p.is_file() or p.is_symlink()):
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
    return {"state": state, "size_gb": round(size / 1024**3, 2)}


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
