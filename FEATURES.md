# Fonctionnalités d'AI MediaLab

Inventaire de ce qui est **construit** (pas un journal des changements), par module. Chaque section est mise à jour dans le
même commit que la fonctionnalité. Le détail d'un module (fichiers, endpoints, tests) est dans son README, la forme générale dans
`ARCHITECTURE.md` (carte de la documentation), le guide des modèles pour l'utilisateur dans `README.md`.

*Dernière vérification contre les sources : 2026-10-19. Ce qui n'a jamais été exécuté pour de vrai est signalé « non vérifié ». Aucun vrai `llama-server`, modèle de chat ni navigateur n'a servi à vérifier le mode Chat, le mode Diagrammes, le mode privé et le conseiller de mises à jour : tout a été testé avec de faux serveurs.*

## Studios (interface, `front/src/modules/`)

### `studio-shell` : coquille
- Barre latérale (masquable) : commutateur de mode chat / image / audio / vidéo / diagrammes, bouton « Génération privée », pages du mode, recherche, conversations épinglées et
  groupées par période (mode « Sélectionner » : suppression de plusieurs conversations d'un coup), carte du moteur, accès aux modèles et aux réglages, « Vérifier les mises à jour » (modale : moteurs installés puis modèles installés, mise à jour par ligne, par section ou globale, avec barres de progression ; filtre image / audio / vidéo ; rien n'est mis à jour sans clic), thème sombre ou clair.
- Routes : `/`, `/c/:id`, `/galerie`, `/audio`, `/audio/voix`, `/audio/bibliotheque`, `/video`, `/video/bibliotheque`,
  `/chat`, `/diagrammes` ; raccourcis ⌘B, ⌘⇧O, ⌘K, `/`.
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
  étapes, guidance, prompt négatif (ligne « À éviter » sous le prompt), force, graine ; galerie des images (`/galerie`).

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
- Composeur à trois emplacements (vidéo source, image de départ, image de fin), durée (jusqu'à 20 s sur les modèles GGUF
  image → vidéo : passages enchaînés dont la longueur suit la mémoire mesurée sur la machine ; voir le README), format et définition, réglages, graine,
  nombre de clips (1 à 2), avis de licence et d'accès restreint ; clips avec lecteur natif et actions (varier, relancer,
  utiliser comme vidéo source, **dernière image comme départ**, favori, téléchargement) ; dépôt d'images et de vidéos ;
  bibliothèque vidéo.

### `chat`
- Mode **Chat** (onglet à côté d'image, audio et vidéo) sur des modèles de langage locaux (llama.cpp) : fil avec réponses en streaming,
  Markdown sûr (images distantes bloquées), code coloré avec copie, formules LaTeX (chargées à la demande), bloc « Réflexion » repliable,
  appels d'outils affichés (requêtes envoyées, sources), statistiques par réponse (jetons, tokens/s) et jauge de contexte.
- Conversations **en arbre** : navigateur de branches, modification d'un message (nouvelle branche), régénération, comparaison côte à côte de
  deux modèles (l'un après l'autre), suppression ; instruction système avec personas ; réglages (température, top-p, top-k, min-p,
  pénalités, longueur, graine, contexte, raisonnement) avec préréglages ; avis quand changer le contexte recharge le modèle ; pièces jointes
  (images pour les modèles de vision, fichiers texte) ; recherche web optionnelle par conversation (DuckDuckGo, ou Brave avec une clé) ; **outils de création** (actifs par défaut) : le modèle de chat lance une image, une vidéo ou un son avec le modèle sélectionné de chaque studio (paramètres par défaut, ce que chaque modèle accepte seulement), le résultat s'affiche dans la réponse et dans la médiathèque, « Ouvrir dans le studio » ; cartes de choix (durée d'une vidéo, voix d'un modèle qui en exige une, voix par défaut du chat dans les réglages) ; commandes `/image`, `/video [5s]`, `/audio [voix :]` sans le modèle de chat (absents de la session privée) ;
  titre automatique ; export Markdown / JSON ; recherche plein texte ; brouillon par conversation ; indicateur du modèle chargé avec
  « Décharger ».
- **Envoyer vers Image / Vidéo / Audio / Diagrammes** depuis une réponse (sélection ou texte entier, sans balisage) et bouton **✨ Améliorer le prompt** dans
  les trois compositeurs de médias (rétablissement possible). **Non vérifié** : rendu réel, vrai modèle.

### `diagram-studio`
- Organigrammes, flowcharts, séquences, architectures (groupées en blocs), diagrammes d'états, cartes mentales : un modèle de
  langage local (les mêmes fichiers GGUF que l'onglet Chat, catalogue séparé, aucun téléchargement dupliqué) répond en JSON
  contraint par schéma (jamais de syntaxe Mermaid libre à parser), converti en Mermaid et rendu côté navigateur avec un thème
  au choix (clair, sombre, coloré, minimal — appliqué sans redemander au modèle). Le rendu (PNG) rejoint la galerie et le fil
  comme une image normale ; la source Mermaid reste jointe pour re-styler plus tard.
- Accueil (première installation, composeur « héros », quatre prompts de départ, un par type), composeur : prompt, modèle,
  type de diagramme, thème. Pas de file de jobs : une génération est un appel ponctuel (texte, puis rendu), comme le bouton
  « Améliorer le prompt » du chat. **Non vérifié** : rendu réel, vrai modèle.

### `private` : génération privée
- Bouton « Génération privée » (cadenas, bandeau et cadre violets) : session éphémère pour image, audio, vidéo **et chat** sans historique, résultat ni
  prompt conservés (aucune ligne en base, fichiers dans un dossier de session effacé à la sortie, après 30 min d'inactivité, à l'arrêt et au
  balayage du démarrage ; médias sans cache ; brouillons et compteurs d'usage non écrits ; journaux sans contenu ; mesures vidéo non enregistrées ; prompts
  de `sd-cli` passés par fichier quand le binaire le permet). Limites annoncées dans l'interface : mémoire et fichier d'échange de l'OS,
  sauvegardes, effacement non sécurisé sur SSD, captures d'écran, texte d'`audio.cpp` encore en ligne de commande. Recharger la page efface la session.

### `updates` : vérifier les mises à jour
- Modale « Vérifier les mises à jour » : moteurs installés (stable-diffusion.cpp, audio.cpp, packs Python) puis modèles installés ; mise à jour par
  ligne, par section ou globale, barres de progression, filtre par type, version épinglée recommandée ou **dernière version amont non testée**
  (avertissement + confirmation ; régressions connues citées), retour à la version testée.
- **Conseiller** : un petit modèle local résume des sources structurées (notes de version, issues et commits GitHub ; commits, discussions et fiche
  Hugging Face) ; chaque constat doit citer un extrait retrouvé dans la source, sinon il est rejeté ; le verdict est calculé par le code ; avis
  consultatif, jamais bloquant, **enregistré** (`update_advisories`) et restitué à l'ouverture ; analyse automatique facultative. **Non vérifié** : qualité
  des constats d'un petit modèle, vraies requêtes GitHub / Hugging Face.

### `media-library` (front)
- Galerie générique (filtres, pagination par curseur, favoris, mise à jour en direct), liste de la visionneuse, voile de dépôt de
  fichiers et règles de dépôt par mode.

### `model-catalog`
- Dialogue « Modèles » : catalogue par type, installé / incomplet / incompatible avec la raison (planificateur mémoire),
  téléchargement avec progression, débit, temps restant, reprise, annulation, suppression, variantes (quantifications) ;
  sélecteur de modèle réutilisable (description en retrait sous le titre ; les plus utilisés d'abord, puis les autres
  installés, puis le reste ; modèles trop lourds pour la machine masqués par défaut ; le modèle présélectionné est, à défaut de choix mémorisé,
  l'installé le plus utilisé) ; recherche Hugging Face avec quantifications
  proposées par résultat, tenue en mémoire et marqueurs de compatibilité, ajout et retrait de modèles personnalisés, dont
  des LoRA SDXL.
- Bouton **« Nouveautés »** (« What's new ? ») dans les composeurs : modèles récents (90 jours par défaut) et populaires de Hugging Face, ajoutables par
  l'app et compatibles avec la machine, sans LLM ; onglet « Modèles de chat » (badges vision / outils / raisonnement / MoE, contexte) et recherche
  Hugging Face « LLM ».

### `engines`
- **Installation à la première sélection d'un modèle** : une fenêtre de confirmation liste ce qui sera téléchargé (« Données de base »
  partagées : PyTorch, FFmpeg ; « Moteur d'exécution » ; « Modèle »), avec les tailles et le total ; une seule exécution côté moteur,
  progression, annulation qui supprime ce qui est partiel ; un élément déjà installé n'est jamais retéléchargé.
- Cartes « Moteurs » : installation de stable-diffusion.cpp (SHA-256 vérifiée) et des packs audio et vidéo
  (environnements Python isolés), annulation ; carte llama.cpp (moteur de chat) ;
  **invitation au lancement** (fenêtre à fermer, case « Ne plus me le proposer », rappelée dans les Réglages) tant que llama.cpp manque : chat, mises à jour
  analysées, prompts améliorés, option du modèle conseillé.

### Langue (français, anglais)
- Choix dans Réglages > Général ; au premier lancement, la langue du système (français, sinon anglais). L'interface, les messages d'erreur de Nest, les textes du moteur
  (descriptions et notes des modèles, paramètres, progression, erreurs) et les avis de mise à jour suivent ce choix. Formats de dates et de nombres selon la langue.
  Flux et règles : `ARCHITECTURE.md`, section « Langue de l'interface ».

### `settings` et `hardware`
- Dialogue « Réglages » en trois onglets. **Moteurs** : tous les composants téléchargeables (données de base, moteurs) avec leur état,
  l'espace occupé, et la suppression (qui supprime aussi les modèles installés qui en dépendent, nommés dans la confirmation). **Modèles** :
  le catalogue par catégorie (chat, audio, image, vidéo) avec l'état et la suppression. **Général** : langue de l'interface (français ou anglais ; au premier lancement, celle du système, anglais à défaut), délai de déchargement du modèle, aperçus, économie de mémoire, jeton Hugging Face et clé Brave Search facultatifs, voix par défaut du chat, invitation « IA locale au lancement », rappel
  des raccourcis ; chaque réglage a une info-bulle. Carte « Cette machine » (puce ou GPU, mémoire, disque des modèles, GPU
  inutilisables).

## Serveur (`back/src/modules/`)

| Module | Construit |
|---|---|
| `engine` | Client HTTP typé du moteur (types générés depuis `engine/openapi.json`), relais du flux d'événements du moteur avec reconnexion, relais des médias `/api/media`, sonde de santé (`degraded` si le moteur ne répond pas) |
| `studio-core` | Conversations et messages (modes image, audio, vidéo et chat ; une conversation de chat peut recevoir des générations : outils de création), file FIFO des générations (une à la fois), machine d'état des messages, relance, annulation, suppression avec purge des fichiers, reprise au démarrage, événements `studio.*`, file publiée |
| `media-library` | Assets (envois et sorties), favoris, liste paginée, ingestion et purge des fichiers par le moteur, limite d'événement relevée à 256 Ko |
| `audio-studio` | Voix (clone, design), clip de référence préparé par le moteur, transcription suggérée, voix passées aux jobs audio |
| `settings` | Réglages du studio (configuration de module, jeton Hugging Face chiffré), poussés au moteur à chaque (re)connexion |
| `hardware` | État de la machine, du moteur, déchargement du modèle (délégué au moteur) |
| `model-catalog` | Catalogue, téléchargements, modèles personnalisés, recherche Hugging Face (délégués au moteur) |
| `engines` | Installateurs de moteurs et de packs (délégués au moteur) |
| `chat` | Arbre de messages (`chat_messages`, réglages par conversation), flux SSE de réponse vers le moteur LLM, outils web (DuckDuckGo / Brave, garde contre les adresses internes), titre automatique, amélioration de prompt, export, recherche, pièces jointes, déchargement et frères d'un message ; jauge d'occupation partagée avec la file des générations |
| `diagrams` | Génération de diagrammes par appel LLM ponctuel (JSON contraint par schéma → Mermaid, jamais de job), messages génériques de `studio-core` (mode `diagram`), rendu PNG attaché comme asset généré une fois reçu du front |
| `private` | Session privée en mémoire (conversations et messages sans base), dossier de session, file partagée, chat privé sans état, nettoyage (fin de session, délai, démarrage) |
| `updates` | Détection des mises à jour (moteurs, modèles), lancement, version non testée, conseiller et avis enregistrés (`update_advisories`) |
| `legacy-import` | Import idempotent de l'ancienne base du moteur au premier démarrage, puis renommage en `.imported` |

Socle (gabarit vx-public, non détaillé ici) : SQLite, mode local de confiance (`LOCAL_TRUST`), flux d'événements, locales fr et en,
migrations TypeORM.

## Moteur (`engine/`)

- **Images** : MLX (Apple Silicon), PyTorch + diffusers (CUDA, ROCm, MPS ; installés à la demande par le pack « torch », hors de
  l'installateur), GGUF par stable-diffusion.cpp (Metal, CUDA, ROCm,
  Vulkan) ; texte vers image, image vers image, édition par instruction ; modèle « Démo » sans GPU (`IMAGEGEN_DEMO=1`).
- **SDXL spécialisés** : LoRA chargées sur SDXL (force réglable, mots déclencheurs ajoutés au prompt), dont deux de pixel art
  avec post-traitement « Pixels nets », dont « Pixel Art XL · Visage » qui suit le visage d'une photo (IP-Adapter, image de
  départ facultative) ; modèles affinés RealVisXL, Juggernaut XL, DreamShaper XL Turbo, Animagine XL avec
  leur planificateur conseillé. **Non vérifié** : aucune génération réelle.
- **Audio** : synthèse vocale, clonage, création de voix par description, dialogue, transcription (Whisper, Qwen3-ASR) ; packs
  isolés et moteur natif audio.cpp ; Kokoro, Pocket TTS, Qwen3-TTS, Chatterbox, Whisper.
- **Vidéo** : texte vers vidéo, image vers vidéo, édition de vidéo ; Wan 2.2, LTX, HunyuanVideo 1.5, CogVideoX, Kiwi-Edit,
  Bernini-R. **Seul un essai réel** (Wan 2.2 TI2V 5B texte vers vidéo, M3 Max) a été fait : le reste est **non vérifié** (voir
  `README.md`).
- **Chat (LLM)** : moteur llama.cpp installé depuis l'application (`llama-server`, GGUF, 127.0.0.1 seulement, clé d'API par lancement), 11 modèles
  vérifiés sur Hugging Face (de 0,7 à 17,7 Go : Qwen3, Gemma 4, Ministral 3, gpt-oss, LFM2.5…), recherche Hugging Face « LLM », flux SSE normalisé
  (réflexion, appels d'outils, statistiques), un seul modèle en mémoire avec les générations, cache de prompt borné à 1 Go. **Non vérifié** : aucun vrai
  `llama-server`.
- **Diagrammes** : réutilise les mêmes modèles et fichiers GGUF que le Chat sous un catalogue séparé (`diagram_models.py`,
  `kind="diagram"`), via `/engine/v1/llm/chat` (JSON contraint par schéma, pas de job de diffusion) ; aucune recherche
  Hugging Face ni rubrique « Nouveautés » dédiée (ce sont les mêmes modèles). **Non vérifié** : aucun vrai `llama-server`.
- Nouveautés Hugging Face (`hf_trending.py`), conseiller de mises à jour (`update_advisor.py`), session privée des jobs (`private_session.py`).
- Planificateur mémoire (refus argumenté d'un modèle qui ne tient pas), garde mémoire (refus de charger quand la mémoire libre
  manque, arrêt du modèle avant saturation de la machine, relevé par job : `ARCHITECTURE.md`), un modèle chargé à la fois, déchargement après
  inactivité, annulation immédiate, téléchargements dans un processus dédié (reprise, annulation).
- Modèles personnalisés Hugging Face (recettes dans `engine-state.json`), vignettes et sondage des médias.

## Bureau (`desktop/`)

- Coquille Tauri du gabarit : processus annexe `engine` (Python embarqué) puis Nest, jeton partagé, page d'attente « chambre
  noire », dossier de données de l'OS, reprise de l'ancien dossier `app.chambrenoire.studio`.
- Installateur léger : runtime Python + `uv` + Metal/Vulkan seulement ; PyTorch + diffusers (et MLX), les builds CUDA/ROCm de
  stable-diffusion.cpp et les modèles se téléchargent au premier besoin. Publication : `scripts-local/publish.sh` (release GitHub).
- Profils d'exécution : macOS Apple Silicon (runtime léger construit, démarrage vérifié ; assemblé en version complète avec l'ancienne
  coquille) ; Windows et Linux (universel, CUDA, ROCm) scriptés, **non vérifiés**. Aucune application n'a été construite avec la coquille du gabarit.
