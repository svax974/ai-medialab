# llama.cpp — moteur des modèles de chat (GGUF)

*Dernière vérification contre le code et l'amont : 2026-10-15.* Registre et procédure de revue : [README.md](README.md).

## Pourquoi

Le mode « Chat » fait tourner des modèles de langage locaux. llama.cpp (<https://github.com/ggml-org/llama.cpp>, MIT)
est la référence pour les lire au format GGUF : binaires précompilés pour Metal, CUDA, ROCm, Vulkan et CPU, serveur HTTP
(`llama-server`) compatible OpenAI avec flux de réponse, appels de fonctions (`--jinja`), modèles de vision
(`--mmproj`) et raisonnement. C'est le même principe que stable-diffusion.cpp et audio.cpp : un petit programme
autonome, installé à la demande, sans Python.

## Ce qui est intégré

| Élément | Où | Rôle |
|---|---|---|
| Installation et choix du build | `engine/app/llamacpp.py` | télécharge la version épinglée (`PINNED_TAG`), vérifie le SHA-256 publié par GitHub, extrait sans sortir du dossier cible, vérifie que le programme tourne (et voit un GPU pour un build GPU), sinon essaie le build suivant jusqu'au CPU |
| Serveur et arbitre mémoire | `engine/app/llm.py` | un `llama-server` à la fois, sur `127.0.0.1`, clé d'API aléatoire dans l'environnement ; flux d'événements normalisé ; surveillance mémoire ; déchargement après inactivité |
| Routes | `engine/app/api/llm.py` | `/engine/v1/llm/*` (statut, chat en flux, déchargement, comptage de tokens) et `/engine/v1/engines/llamacpp/*` (installation) ; le détail du flux est dans l'en-tête du fichier |
| Modèles | `engine/app/engines/llm_models.py` | liste prédéfinie, estimation du cache de contexte et besoin mémoire |
| Modèles de Hugging Face | `engine/app/hf_search.py`, `engine/app/engines/custom.py` (famille `llm-gguf`) | recherche, choix de la quantification, fichiers découpés en tranches, projecteur de vision |

Sur disque : binaires dans `<engines>/llamacpp/<variante>/` (`IMAGEGEN_LLAMACPP_DIR` pour le changer) ; poids dans le cache
Hugging Face. `IMAGEGEN_LLAMACPP_TAG` remplace la version épinglée (`latest` ou un tag), `IMAGEGEN_LLAMACPP_VARIANT` force un build.

### Épinglage

La dernière release publiée depuis au moins 14 jours au moment de l'épinglage (le 2026-10-15 à 09 h 42 UTC : la release du
2026-10-01 à 09 h 32 UTC), dont les 35 fichiers ont un SHA-256 publié et dont les noms attendus (table `ASSETS`) existent, vérifiés par
l'API GitHub. Une release voisine (`b11311`) n'a que 25 fichiers : une publication partielle, à écarter si on remonte la liste à la main. Les builds
sortent plusieurs fois par jour : une montée de version se décide à la revue, pas automatiquement.

### Drapeaux de `llama-server` utilisés

Source : `tools/server/README.md` de la release `b11317` (`https://github.com/ggml-org/llama.cpp/blob/b11317/tools/server/README.md`),
lue le 2026-10-15 (identique à celle de `b11312`, qui a servi à la première lecture) ; **aucun binaire n'a été lancé** pour les confirmer.

| Drapeau | Pourquoi |
|---|---|
| `--model`, `--alias`, `--host 127.0.0.1`, `--port` | chargement du fichier, nom du modèle dans l'API, écoute locale seulement |
| `--ctx-size`, `--parallel 1` | contexte demandé (le cache est payé au chargement) ; une réponse à la fois |
| `--jinja` | gabarits de conversation et appels de fonctions (actif par défaut, explicite ici) |
| `--no-webui`, `--no-slots` | pas d'interface web ni de point de surveillance des emplacements |
| `--cache-ram 1024` | cache des états de prompt en RAM borné à 1 Gio (8 Gio par défaut, trop pour une mémoire unifiée partagée avec le modèle) |
| `--reasoning-format deepseek` | la réflexion du modèle arrive dans `reasoning_content`, séparée de la réponse |
| `--mmproj` | projecteur de vision, seulement pour un modèle qui lit les images |
| `-ngl all` | tout sur le GPU quand le planificateur dit que ça tient ; sinon le défaut (`--fit`, actif par défaut) place les couches |
| variable `LLAMA_API_KEY` | clé d'API, hors de la ligne de commande (visible dans `ps`) |

Côté requête (`/v1/chat/completions`) : `stream_options.include_usage`, `cache_prompt`, les paramètres d'échantillonnage,
`tools`, `reasoning_effort` (`none` coupe la réflexion), `parallel_tool_calls: false`. Les images ne sont jamais données par adresse :
le moteur lit le fichier du dossier de données (ou une data URL) et envoie une data URL, donc le serveur ne lit ni ne télécharge rien
(`--media-path` n'est pas utilisé).

## Mémoire

Un seul modèle en mémoire pour toute l'application (`ARCHITECTURE.md`, « Filets de sécurité mémoire ») : le worker de génération
part avant un modèle de chat, le serveur de chat part avant un worker. Le besoin d'un chat = poids (modèle et projecteur) + cache
de contexte + 0,6 Go de tampons (`llm_models.memory_need_gb`). Le cache vient de l'architecture de chaque modèle (couches à cache complet,
couches à fenêtre glissante, têtes, dimension, lues dans le `config.json` du modèle) avec une marge de 10 % ; pour un modèle ajouté
depuis Hugging Face, dont l'architecture est inconnue, il est deviné à partir de la taille des poids (0,03 Mo par token et par Go de poids,
calé sur Qwen3 8B : surestimé pour la plupart).

## À vérifier à la revue

- Que les archives ont bien la structure attendue : le programme est cherché là où l'archive le met (`find_binary_dir`) et les
  bibliothèques CUDA sont copiées à côté, mais **aucune archive réelle n'a été téléchargée** pour le confirmer.
- Le format de `llama-server --list-devices` (lu par `_DEVICE`) : une sortie illisible est acceptée par bénéfice du doute.
- Le build `macos-x64` : classé « cpu » faute d'avoir vérifié qu'il active Metal.
- Les capacités des modèles prédéfinis (`outils`, `raisonnement`, `vision`) : lues dans les cartes des modèles de base, jamais
  essayées en vrai avec ce serveur.
- Les licences (`THIRD_PARTY_LICENSES.md`) : la section 5 de la LFM Open License n'a pas été relue.
