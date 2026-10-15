# Composants tiers intégrés — registre et procédure de revue

Ce dossier décrit **chaque composant externe que l'application installe ou pilote**, pour pouvoir les passer en revue de
temps en temps : une version corrigée, un modèle amélioré, une famille nouvelle, une licence qui change.

*Dernière vérification contre les sources : 2026-10-13 (épinglages et chemins relus après la migration : le moteur est dans `engine/`).*

Règle de ce dossier : **un fait, un seul endroit**. Les versions épinglées ne sont jamais recopiées ici, on cite le
fichier qui les porte (le code ne ment pas, une copie finit par mentir). Les licences des modèles sont dans
`THIRD_PARTY_LICENSES.md` (résumé) et dans la fiche du composant (détail et statut amont).

## Procédure de revue (toutes les 3 à 4 semaines, ou avant une release)

1. Lancer le rapport (réseau requis, ne modifie rien) :
   `engine/.venv/bin/python scripts-local/review_components.py`
   Il compare ce qui est épinglé à la dernière version amont (moteurs natifs, bibliothèques des packs audio, **pile web de
   `front/` et `back/`**, Tauri) et liste, pour audio.cpp, les familles nouvelles ou dont le statut ou la licence ont changé
   depuis le dernier instantané.
2. Pour chaque ligne « NOUVELLE VERSION » ou chaque famille nouvelle : lire les notes de version amont, puis la section
   « À vérifier à la revue » de la fiche du composant.
3. Si on met à jour un épinglage : changer la constante (fichier indiqué dans le registre), relancer les tests du composant
   **un fichier à la fois, jamais la suite complète d'un coup** (sur Mac, un débordement de mémoire unifiée redémarre la machine ; lancer sous surveillance de la mémoire libre), puis mettre à jour la fiche (date de revue, résultats).
4. Rafraîchir l'instantané des familles : `… review_components.py --snapshot`, puis commiter le JSON.
5. Noter la date dans la colonne « Dernière revue » ci-dessous.

## Registre

| Composant | Rôle | Où est l'épinglage | Licence | Fiche | Dernière revue |
|---|---|---|---|---|---|
| **audio.cpp** (ggml) | synthèse vocale GGUF sur Metal, CUDA, Vulkan ou CPU (puis transcription, voir fiche) | `engine/app/audiocpp.py` (`PINNED_TAG`) | Apache-2.0 | [audiocpp.md](audiocpp.md) ; tests à faire à la main : [audiocpp-tests-manuels.md](audiocpp-tests-manuels.md) | 2026-10-13 |
| **llama.cpp** (`llama-server`) | modèles de chat GGUF (Metal, CUDA, ROCm, Vulkan, CPU) | `engine/app/llamacpp.py` (`PINNED_TAG`) | MIT | [llamacpp.md](llamacpp.md) | 2026-10-15 |
| **Accélération PyTorch** (CUDA, ROCm, XPU, Vulkan) | quels GPU les packs audio PyTorch peuvent utiliser, et le marqueur « lent · processeur » | `engine/app/audio_packs.py` (`torch_acceleration`, `_torch_index`) | – | [pytorch-gpu.md](pytorch-gpu.md) | 2026-10-13 |
| **stable-diffusion.cpp** | images et vidéo GGUF (Metal, CUDA, ROCm, Vulkan, CPU) | `engine/app/engine_install.py` (`PINNED_TAG`) ; raison de l'épinglage dans le commentaire au-dessus | MIT | à écrire | – |
| **FFmpeg** (via PyAV) | encodage MP4 (H.264 + AAC), décodage des vidéos envoyées | `engine/pyproject.toml` (`av`) ; encodeurs H.264 : `H264_ENCODERS` (`engine/app/media.py`) | LGPL visée ; roue PyPI actuelle GPL de fait (x264, x265) | [ffmpeg.md](ffmpeg.md) | 2026-10-13 |
| **mflux / MLX** | images sur Apple Silicon | `engine/pyproject.toml` | MIT | à écrire | – |
| **PyTorch, diffusers, transformers, peft** | moteur torch (images, vidéo, packs) ; `peft` charge les LoRA SDXL | `engine/pyproject.toml`, `engine/app/audio_packs.py` | BSD-3 / Apache-2.0 | à écrire | – |
| **qwen-tts** | Qwen3-TTS en PyTorch | `engine/app/audio_packs.py` (pack `qwen3`) | Apache-2.0 | à écrire | – |
| **Kokoro, Pocket TTS, faster-whisper, mlx-whisper** | pack audio « speech » | `engine/app/audio_packs.py` (pack `speech`) | voir `THIRD_PARTY_LICENSES.md` | à écrire | – |
| **MUI, Emotion, TanStack Query, Zustand, polices Fontsource** | interface (composants et thème, cache des données, état, polices embarquées) | `front/package.json` (plages), `front/package.local.json` (écarts au gabarit) | MIT (MUI, Emotion, TanStack, Zustand), OFL-1.1 (polices) | à écrire | – |
| **NestJS, TypeORM, better-sqlite3** | serveur applicatif, accès aux données, base SQLite | `back/package.json` (plages), `back/package.local.json` | MIT | à écrire | – |
| **openapi-typescript** | types du contrat Nest ↔ moteur (`engine/openapi.json`) | `back/package.json` (`devDependencies`) | MIT | à écrire | – |
| **Tauri 2** | coquille de bureau | `desktop/src-tauri/Cargo.toml`, `desktop/package.json` | Apache-2.0 OR MIT | à écrire | – |

Les lignes « à écrire » n'ont pas encore de fiche détaillée : le script de revue les vérifie déjà (versions installées contre
la dernière version publiée), la fiche viendra quand on les revisitera. Pour la pile web, une montée de version majeure de MUI ou
de TypeORM se lit dans leurs notes de version avant d'élargir la plage de `package.json`. Ne pas recopier ici ce que `THIRD_PARTY_LICENSES.md` dit déjà.

## Ajouter un composant

1. Une fiche `docs/components/<nom>.md` sur le modèle d'`audiocpp.md` (pourquoi, ce qui est intégré, comment ça tourne,
   limites mesurées, candidats non intégrés, à vérifier à la revue).
2. Une ligne dans le registre ci-dessus et une dans `THIRD_PARTY_LICENSES.md`.
3. Si le composant a des versions ou un catalogue de modèles amont, l'ajouter à `scripts-local/review_components.py`.
