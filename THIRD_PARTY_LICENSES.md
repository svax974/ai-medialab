# Licences tierces

AI MediaLab est publiée sous licence MIT (voir `LICENSE`). Elle ne redistribue aucun modèle : les
modèles et les moteurs sont téléchargés ou installés à la demande, et **gardent leur propre licence**,
que l'application affiche dans le sélecteur de modèles. Vérifiez-la avant tout usage commercial.

## Moteurs et bibliothèques (installés à la demande)

| Composant | Licence | Remarque |
|---|---|---|
| stable-diffusion.cpp | MIT | moteur GGUF (images, vidéo) |
| audio.cpp | Apache-2.0 | moteur GGUF audio (Metal, CUDA, Vulkan, CPU) ; ses modèles gardent leur licence d'origine, voir `docs/components/audiocpp.md` |
| MLX / mflux | MIT | moteur Apple Silicon |
| PyTorch, diffusers, transformers | BSD-3 / Apache-2.0 | moteur torch |
| kokoro, misaki | Apache-2.0 | pack audio « speech » |
| **eSpeak-ng** | **GPL-3.0** | phonémiseur de Kokoro, installé dans un environnement séparé ; à isoler ou à accompagner de ses sources si une distribution l'embarque |
| pocket-tts | MIT (code) | voir modèle ci-dessous |
| qwen-tts | Apache-2.0 | pack audio « qwen3 » |
| faster-whisper | MIT | transcription des voix de référence |

## Moteur Python embarqué (`engine/pyproject.toml`)

Installé par `uv` (développement) ou embarqué dans l'application de bureau (`scripts-local/build_runtime.py`). Licences lues dans
les métadonnées des paquets de `engine/.venv` (version installée le 2026-10-13).

| Composant | Licence | Remarque |
|---|---|---|
| FastAPI, python-multipart | MIT, Apache-2.0 | interface interne `/engine/v1` ; `python-multipart` n'est plus utilisé depuis H6 (plus d'envoi de fichier au moteur) |
| Uvicorn, Starlette | BSD-3-Clause | serveur et socle ASGI |
| Pillow | MIT-CMU (HPND) | vignettes, décodage des images |
| huggingface_hub | Apache-2.0 | téléchargement et recherche de modèles |
| psutil | BSD-3-Clause | mémoire, processus |
| NumPy, SoundFile | BSD-3-Clause | audio, tableaux |
| PyAV (`av`) | BSD-3-Clause | encodage et décodage vidéo ; la roue PyPI embarque un **FFmpeg lié à libx264 et libx265 (GPL)** : à remplacer par un build LGPL avant toute distribution, voir `docs/components/ffmpeg.md` |
| diffusers, transformers, accelerate | Apache-2.0 | moteur torch (extra `torch`) |
| PyTorch, torchvision | BSD-3-Clause (et licences des composants embarqués, voir le paquet) | extra `torch` |
| gguf, safetensors, sentencepiece, protobuf | MIT, Apache-2.0, Apache-2.0, BSD-3-Clause | formats de modèles |

## Serveur et interface (npm : `back/package.json`, `front/package.json`)

Licences lues le 2026-10-13 dans `node_modules/<paquet>/package.json` (dépendances directes ; `back/` et `front/` partent du
gabarit vx-public, dont certaines dépendances ne sont pas utilisées par ai-medialab : elles sont listées parce qu'elles sont
installées et, pour le serveur, empaquetées dans l'application de bureau).

| Composant | Licence | Rôle dans ai-medialab |
|---|---|---|
| React, React DOM | MIT | interface |
| **MUI** (`@mui/material`, `@mui/icons-material`) | MIT | composants et thème « chambre noire » |
| **Emotion** (`@emotion/react`, `@emotion/styled`) | MIT | moteur de style de MUI |
| **TanStack Query** | MIT | cache des données alimenté par le flux d'événements |
| **Zustand** | MIT | état local de l'interface |
| **Fontsource** : Hanken Grotesk, JetBrains Mono, Instrument Serif | OFL-1.1 (paquets) | polices embarquées (pas de requête vers Google Fonts) ; la licence OFL accompagne les fichiers de police |
| React Router, React Toastify | MIT | routes, notifications |
| Vite, Vitest, ESLint, typescript-eslint | MIT | outillage |
| TypeScript | Apache-2.0 | compilateur |
| **NestJS** (`@nestjs/*`), RxJS, `reflect-metadata` | MIT, Apache-2.0 | serveur applicatif |
| **TypeORM**, `@nestjs/typeorm` | MIT | accès aux données |
| **better-sqlite3** | MIT | base SQLite de Nest, lecture de l'ancienne base |
| `class-validator`, `class-transformer`, Helmet, compression | MIT | validation et en-têtes |
| openapi-typescript (dev) | MIT | types du contrat Nest ↔ moteur |
| Jest, ts-jest, supertest | MIT | tests |
| Tauri (`tauri`, `tauri-build`, `tauri-plugin-single-instance`, `@tauri-apps/cli`) | Apache-2.0 OR MIT | coque de bureau (`desktop/`) |
| Dépendances du gabarit non utilisées par l'interface d'ai-medialab : TipTap, Chart.js, lightweight-charts, react-markdown, react-datepicker, html-to-image, **DOMPurify** (MPL-2.0 OR Apache-2.0), **Pyodide** (MPL-2.0) | MIT, Apache-2.0, MPL-2.0 | présentes dans `front/package.json` (aucun import dans `front/src/` d'ai-medialab) ; MPL-2.0 est un copyleft faible au niveau du fichier. Non vérifié : ce que `vite build` en embarque réellement |
| Serveur : Stripe, AWS SDK S3, ioredis, pg, nodemailer, pdfkit, elliptic, bs58, prom-client, `@base-org/account` | MIT, MIT-0, Apache-2.0 | dépendances du gabarit de serveur, non sollicitées par les modules d'ai-medialab |

Les dépendances transitives (plusieurs milliers de paquets) ne sont pas énumérées ici : `npx license-checker --production`
dans `back/` et `front/` (outil non installé dans ce dépôt) en donnerait la liste complète avant une distribution publique.

## Modèles (téléchargés depuis Hugging Face)

| Modèle | Licence |
|---|---|
| Kokoro 82M | Apache-2.0 |
| Pocket TTS (Kyutai) | CC-BY-4.0 (attribution requise) |
| Qwen3-TTS (0.6B / 1.7B), y compris les conversions GGUF d'audio.cpp | Apache-2.0 |
| Chatterbox (Resemble AI), conversion GGUF d'audio.cpp | MIT (l'implémentation d'origine filigrane ses sorties, pas le portage audio.cpp) |
| Whisper (small, large-v3-turbo) | MIT |
| Modèles d'image | variables : voir la licence indiquée par modèle (certains sont non commerciaux, p. ex. Qwen Image 2.1 « Research ») |

Ce document est informatif et n'a pas valeur de conseil juridique.
