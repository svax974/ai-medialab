# Licences tierces

AI MediaLab est publiée sous licence MIT (voir `LICENSE`). Elle ne redistribue aucun modèle : les
modèles et les moteurs sont téléchargés ou installés à la demande, et **gardent leur propre licence**,
que l'application affiche dans le sélecteur de modèles. Vérifiez-la avant tout usage commercial.

## Moteurs et bibliothèques (installés à la demande)

| Composant | Licence | Remarque |
|---|---|---|
| stable-diffusion.cpp | MIT | moteur GGUF |
| MLX / mflux | MIT | moteur Apple Silicon |
| PyTorch, diffusers, transformers | BSD-3 / Apache-2.0 | moteur torch |
| kokoro, misaki | Apache-2.0 | pack audio « speech » |
| **eSpeak-ng** | **GPL-3.0** | phonémiseur de Kokoro, installé dans un environnement séparé ; à isoler ou à accompagner de ses sources si une distribution l'embarque |
| pocket-tts | MIT (code) | voir modèle ci-dessous |
| qwen-tts | Apache-2.0 | pack audio « qwen3 » |
| faster-whisper | MIT | transcription des voix de référence |

## Modèles (téléchargés depuis Hugging Face)

| Modèle | Licence |
|---|---|
| Kokoro 82M | Apache-2.0 |
| Pocket TTS (Kyutai) | CC-BY-4.0 (attribution requise) |
| Qwen3-TTS (0.6B / 1.7B) | Apache-2.0 |
| Whisper (small, large-v3-turbo) | MIT |
| Modèles d'image | variables : voir la licence indiquée par modèle (certains sont non commerciaux, p. ex. Qwen Image 2.1 « Research ») |

Ce document est informatif et n'a pas valeur de conseil juridique.
