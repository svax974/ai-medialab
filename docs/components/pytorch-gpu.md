# PyTorch : quels GPU les moteurs audio peuvent-ils utiliser ?

*Dernière vérification : 2026-10-13, contre les index de wheels de pytorch.org, la documentation PyTorch et AMD.*
Registre et procédure de revue : [README.md](README.md).

Les packs audio PyTorch (Qwen3-TTS, Kokoro, Pocket TTS, Whisper) et le pack « torch » du moteur principal (images et vidéos, installé à la
demande) installent leur **propre** PyTorch (`_torch_index` dans
`engine/app/audio_packs.py`). La règle « ce GPU est-il utilisable ? » est `torch_acceleration()` dans le même fichier ; le
marqueur « lent · processeur » du catalogue (`_degraded` dans `engine/app/catalog.py`) en découle.

## Ce qui est vérifié

| Matériel | Utilisable par les packs ? | Preuve |
|---|---|---|
| NVIDIA (Windows, Linux) | oui, wheels CUDA | index `cu128` : Windows et Linux |
| Apple Silicon | oui, Metal (MPS) | wheels PyPI macOS |
| AMD sous **Linux** | oui, wheels ROCm | index `rocm6.4` à `rocm7.14` de pytorch.org : **uniquement `manylinux` x86_64** |
| AMD sous **Windows** | **non intégré** | aucun wheel ROCm Windows sur pytorch.org (index `rocm6.4`, `7.0`, `7.1`, `7.2`, `7.14` : 0 fichier `win_amd64`). AMD publie une préversion à part (PyTorch 2.9.1 + ROCm 7.2.1, Python 3.12, wheels directs sur `repo.radeon.com`, cartes Radeon RX 7000/9000 et quelques Ryzen AI ; RX 6000 exclues). Le profil `win-rocm` de `desktop/runtime/profiles.json` l'utilise pour le moteur principal, pas pour les packs |
| Intel (Arc A/B, Core Ultra à GPU Arc intégré) | **non intégré** | backend `xpu` de PyTorch (≥ 2.5), wheels sur l'index `xpu` pour **Windows 11 et Linux** (doc officielle « Getting Started on Intel GPU ») ; les moteurs choisissent seulement entre cuda, mps et cpu (`pick_device`) |
| Tout GPU « Vulkan seulement » | **non** | le backend Vulkan de PyTorch est signalé comme **non maintenu** dans son tutoriel, absent des builds par défaut (option `USE_VULKAN`), né pour le mobile et limité aux calculs flottants 32 bits dans la doc d'origine ; l'équivalent actuel est le délégué Vulkan d'ExecuTorch, qui exécute des modèles exportés, pas notre code PyTorch |
| torch-directml (Windows, AMD/Intel) | **non** | en mode maintenance, bloqué autour de PyTorch 2.2 |

## Décision

Il n'existe pas de solution complète : AMD hors Linux, Intel et les GPU Vulkan-seulement n'ont pas de chemin PyTorch
fiable et testé ici. Le marqueur « lent · processeur » reste donc, avec le **jumeau GGUF** (audio.cpp, Vulkan) proposé
quand il existe (`twin` dans les options des modèles, voir `audio_specs.py`). Les modèles taggés « CPU » (Kokoro,
Pocket, Whisper) et les moteurs natifs ne sont jamais marqués.

## Pistes pour retirer le marqueur sur une partie des machines (non faites : aucune ne peut être testée sur Mac)

1. **Intel XPU** : index `xpu` dans `_torch_index`, `torch.xpu` dans `pick_device` et dans les moteurs des packs, puis valider
   Qwen3-TTS (dtype, mémoire) sur une machine Arc ou Core Ultra.
2. **AMD Windows (RDNA 3/4)** : réutiliser les wheels du profil `win-rocm` pour les packs, valider sur une Radeon RX 7000/9000.
3. Étendre ensuite `torch_acceleration()` et son test (`TestDegradedMarker`) en même temps.

## À vérifier à la revue

`scripts-local/review_components.py` affiche, pour l'index ROCm le plus récent et pour `xpu`, la dernière version par système.
Si **ROCm apparaît pour Windows sur pytorch.org**, ou si la version `xpu` Windows rattrape celle de Linux, revoir
`torch_acceleration()`. Noter aussi : un index `rocm7.14` existe alors que le profil `linux-rocm` épingle `rocm7.2`.
