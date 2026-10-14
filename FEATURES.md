# Fonctionnalités d'AI MediaLab

Inventaire de ce qui est **construit** (pas un journal des changements), par module. Chaque section est mise à jour dans le
même commit que la fonctionnalité. Le détail d'un module (fichiers, endpoints, tests) est dans son README, la forme générale dans
`ARCHITECTURE.md` (carte de la documentation), le guide des modèles pour l'utilisateur dans `README.md`.

*Dernière vérification contre les sources : 2026-10-13. Ce qui n'a jamais été exécuté pour de vrai est signalé « non vérifié ».*

## Studios (interface, `front/src/modules/`)

### `studio-shell` : coquille
- Barre latérale (masquable) : commutateur de mode image / audio / vidéo, pages du mode, recherche, conversations épinglées et
  groupées par période, carte du moteur, accès aux modèles et aux réglages, langue (français, anglais), thème sombre ou clair.
- Routes : `/`, `/c/:id`, `/galerie`, `/audio`, `/audio/voix`, `/audio/bibliotheque`, `/video`, `/video/bibliotheque` ;
  raccourcis ⌘B, ⌘⇧O, ⌘K, `/`.
- Abonnement au flux d'événements et traduction en mises à jour du cache (TanStack Query) ; repli sur le rechargement quand le
  flux est coupé.
- Thème « chambre noire » (`front/src/themes/chambre-noire/`) : sombre « noir chaud / rouge inactinique » par défaut, clair
  « papier », bordures fines, grain de film, polices embarquées. Parité visuelle avec l'ancienne interface : **à valider à l'œil**.

### `studio-core` : fil de conversation (commun aux trois studios)
- Conversation ouverte : titre modifiable, compteur, défilement ; messages de l'utilisateur et générations de l'assistant.
- Progression en direct (chargement du modèle, étapes, temps restant, position dans la file, aperçus intermédiaires), relance,
  « varier », reprise des réglages, annulation, suppression, vignettes, visionneuse plein écran, carte d'état du moteur.
- Réglages d'un modèle et graine (`GenerationParams`), communs aux trois composeurs.

### `image-studio`
- Accueil (premier lancement, composeur « héros », prompts de départ, derniers tirages) ; composeur : prompt, images de référence
  (clic, collage, dépôt sur la fenêtre, glisser depuis une vignette ; réordonnables, la première donne le format et la résolution
  « Référence », conservée pour les images suivantes une fois les références retirées), modèle, proportions et définition, nombre d'images (1 à 4),
  étapes, guidance, prompt négatif, force, graine ; galerie des images (`/galerie`).

### `audio-studio`
- Composeur : texte ou dialogue avec distribution des voix (`Alice : …`), voix, langue, consigne de style ou description d'une
  voix, réglages du modèle, graine, nombre de prises, lecture automatique.
- Prises avec lecteur partagé, forme d'onde, repères des personnages, vitesse, favori, export WAV ; bibliothèque audio
  (`/audio/bibliotheque`).

### `voices`
- Bibliothèque de voix (`/audio/voix`) : enregistrement au micro avec texte de lecture, import d'un fichier, nom, langue,
  **transcription suggérée puis modifiable**, aperçu, modification, suppression ; création d'une voix par description ;
  « garder comme voix de référence » depuis n'importe quelle prise. Micro et écoute : **à valider par l'utilisateur**.

### `video-studio`
- Composeur à trois emplacements (vidéo source, image de départ, image de fin), durée, format et définition, réglages, graine,
  nombre de clips (1 à 2), avis de licence et d'accès restreint ; clips avec lecteur natif et actions (varier, relancer,
  utiliser comme vidéo source, **dernière image comme départ**, favori, téléchargement) ; dépôt d'images et de vidéos ;
  bibliothèque vidéo.

### `media-library` (front)
- Galerie générique (filtres, pagination par curseur, favoris, mise à jour en direct), liste de la visionneuse, voile de dépôt de
  fichiers et règles de dépôt par mode.

### `model-catalog`
- Dialogue « Modèles » : catalogue par type, installé / incomplet / incompatible avec la raison (planificateur mémoire),
  téléchargement avec progression, débit, temps restant, reprise, annulation, suppression, variantes (quantifications) ;
  sélecteur de modèle réutilisable (description en retrait sous le titre) ; recherche Hugging Face avec quantifications
  proposées par résultat, tenue en mémoire et marqueurs de compatibilité, ajout et retrait de modèles personnalisés, dont
  des LoRA SDXL.

### `engines`
- Cartes « Moteurs » : installation en un clic de stable-diffusion.cpp (SHA-256 vérifiée) et des packs audio et vidéo
  (environnements Python isolés), annulation, désinstallation ; installation guidée au premier lancement (« Tout installer »).

### `settings` et `hardware`
- Dialogue « Réglages » : délai de déchargement du modèle, aperçus, économie de mémoire, jeton Hugging Face facultatif, rappel
  des raccourcis ; chaque réglage a une info-bulle. Carte « Cette machine » (puce ou GPU, mémoire, disque des modèles, GPU
  inutilisables).

## Serveur (`back/src/modules/`)

| Module | Construit |
|---|---|
| `engine` | Client HTTP typé du moteur (types générés depuis `engine/openapi.json`), relais du flux d'événements du moteur avec reconnexion, relais des médias `/api/media`, sonde de santé (`degraded` si le moteur ne répond pas) |
| `studio-core` | Conversations et messages (trois modes), file FIFO des générations (une à la fois), machine d'état des messages, relance, annulation, suppression avec purge des fichiers, reprise au démarrage, événements `studio.*`, file publiée |
| `media-library` | Assets (envois et sorties), favoris, liste paginée, ingestion et purge des fichiers par le moteur, limite d'événement relevée à 256 Ko |
| `audio-studio` | Voix (clone, design), clip de référence préparé par le moteur, transcription suggérée, voix passées aux jobs audio |
| `settings` | Réglages du studio (configuration de module, jeton Hugging Face chiffré), poussés au moteur à chaque (re)connexion |
| `hardware` | État de la machine, du moteur, déchargement du modèle (délégué au moteur) |
| `model-catalog` | Catalogue, téléchargements, modèles personnalisés, recherche Hugging Face (délégués au moteur) |
| `engines` | Installateurs de moteurs et de packs (délégués au moteur) |
| `legacy-import` | Import idempotent de l'ancienne base du moteur au premier démarrage, puis renommage en `.imported` |

Socle (gabarit vx-public, non détaillé ici) : SQLite, mode local de confiance (`LOCAL_TRUST`), flux d'événements, locales fr et en,
migrations TypeORM.

## Moteur (`engine/`)

- **Images** : MLX (Apple Silicon), PyTorch + diffusers (CUDA, ROCm, MPS), GGUF par stable-diffusion.cpp (Metal, CUDA, ROCm,
  Vulkan) ; texte vers image, image vers image, édition par instruction ; modèle « Démo » sans GPU (`IMAGEGEN_DEMO=1`).
- **SDXL spécialisés** : LoRA chargées sur SDXL (force réglable, mots déclencheurs ajoutés au prompt), dont deux de pixel art
  avec post-traitement « Pixels nets » ; modèles affinés RealVisXL, Juggernaut XL, DreamShaper XL Turbo, Animagine XL avec
  leur planificateur conseillé. **Non vérifié** : aucune génération réelle.
- **Audio** : synthèse vocale, clonage, création de voix par description, dialogue, transcription (Whisper, Qwen3-ASR) ; packs
  isolés et moteur natif audio.cpp ; Kokoro, Pocket TTS, Qwen3-TTS, Chatterbox, Whisper.
- **Vidéo** : texte vers vidéo, image vers vidéo, édition de vidéo ; Wan 2.2, LTX, HunyuanVideo 1.5, CogVideoX, Kiwi-Edit,
  Bernini-R. **Seul un essai réel** (Wan 2.2 TI2V 5B texte vers vidéo, M3 Max) a été fait : le reste est **non vérifié** (voir
  `README.md`).
- Planificateur mémoire (refus argumenté d'un modèle qui ne tient pas), un modèle chargé à la fois, déchargement après
  inactivité, annulation immédiate, téléchargements dans un processus dédié (reprise, annulation).
- Modèles personnalisés Hugging Face (recettes dans `engine-state.json`), vignettes et sondage des médias.

## Bureau (`desktop/`)

- Coquille Tauri du gabarit : processus annexe `engine` (Python embarqué) puis Nest, jeton partagé, page d'attente « chambre
  noire », dossier de données de l'OS, reprise de l'ancien dossier `app.chambrenoire.studio`.
- Profils d'exécution : macOS Apple Silicon (assemblé avec l'ancienne coquille) ; Windows et Linux (CUDA, ROCm) scriptés,
  **non vérifiés**. Aucune application n'a été construite avec la coquille du gabarit.
