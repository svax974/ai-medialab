# AI MediaLab

Studio local de création d'images, d'audio (synthèse vocale, clonage de voix) et de vidéo (génération et édition), sous forme de chat. Les modèles ouverts tournent sur la
machine — Metal (Apple Silicon), NVIDIA (CUDA) ou AMD (ROCm) — sans service externe. L'application embarque
le serveur d'inférence et le gestionnaire de téléchargement des modèles (Hugging Face).

Trois studios (image, audio, vidéo) partagent conversations, file d'attente, téléchargements et mémoire : l'inventaire de ce qui
est construit est dans [FEATURES.md](FEATURES.md), la forme de l'application (processus, contrat, flux, données) dans
[ARCHITECTURE.md](ARCHITECTURE.md), qui porte aussi la carte de toute la documentation.

## Démarrer (développement)

L'application est construite sur le gabarit vx-public : un serveur **NestJS** (`back/`), une interface **React + MUI** (`front/`)
et le **moteur Python** (`engine/`) qui fait tourner les modèles. Un seul lanceur démarre les trois :

```sh
git submodule update --init                # sous-modules du gabarit (une fois)
(cd back && npm install) && (cd front && npm install)
./scripts/run.sh dev                       # Nest (3000) + Vite (5173) + moteur (127.0.0.1:8000), Ctrl+C arrête tout
```

Puis http://localhost:5173. `scripts/` est le lien du gabarit vers `front/.libs/apptemplate/scripts` ; le moteur est lancé par le
crochet `scripts-local/dev-services.sh` (journal : `logs/dev-services.log`). Prérequis : Node.js ≥ 22, [uv](https://docs.astral.sh/uv/) ; le
premier lancement installe les dépendances Python dans `engine/.venv` (MLX et PyTorch sur Mac Apple Silicon). Pour une application
autonome (aucun prérequis), voir « Application de bureau » plus bas.

Variables de `back/.env.dev` (non versionné ; modèle : `back/.env.example`, section « ai-medialab ») :

| Variable | Rôle |
|---|---|
| `ENGINE_TOKEN` | Secret partagé entre Nest et le moteur (`openssl rand -hex 32`), obligatoire pour le crochet. Le moteur exige l'en-tête `X-Engine-Token` sur toutes les routes `/engine/v1/*` sauf `/engine/v1/status` ; non défini côté moteur seul : aucune vérification |
| `ENGINE_PORT` | Port du moteur sur `127.0.0.1` (défaut 8000) ; Nest l'appelle sur `ENGINE_URL` (défaut : ce port) |
| `APP_DATA_DIR` | Dossier de données commun (`<dépôt>/data` par défaut en développement). Le moteur le lit sous le nom `IMAGEGEN_DATA_DIR`, posé par `dev-services.sh` |
| `DB_PATH` | Base de Nest (`app.db`, relative à `APP_DATA_DIR`) |
| `IMAGEGEN_DEMO=1` | Ajoute un modèle « Démo » instantané, sans GPU, pour tester l'interface (à mettre dans `back/.env.dev`) |
| `HF_HOME` / `HF_HUB_CACHE` | Emplacement des modèles (défaut `~/.cache/huggingface/hub`, partagé avec mflux/diffusers) |
| `ENGINE_RELOAD=0` | Désactive le rechargement automatique du moteur |
| `LEGACY_IMPORT=false` | Désactive l'import de l'ancienne base au démarrage de Nest |

Sans le lanceur : `cd back && npm run start:dev`, `cd front && npm run dev` et `ENGINE_TOKEN=… scripts-local/dev-services.sh`.
Les variables propres au moteur et à Nest sont décrites dans le README de leurs modules (`back/src/modules/engine/README.md`).

**Données existantes.** Une installation d'avant la migration (ancienne base `ai-medialab.db`, ancien dossier de bureau) est reprise
automatiquement au premier démarrage, rien n'est supprimé : voir `ARCHITECTURE.md`, section « Données et migrations ».

## Tests

Règle critique : **un fichier de test à la fois**, jamais la suite complète, jamais un modèle réel (un débordement de mémoire unifiée a
déjà fait redémarrer le Mac ; `CLAUDE.md`, section « Mémoire unifiée »). Chaque commande lourde passe par la garde mémoire
`docs/migration/tools/guarded_run.sh <plafond_go> <commande>` (plafond conseillé : 3 Go, 5 Go pour un build).

```sh
cd engine && .venv/bin/python -m pytest -q -x -p no:cacheprovider tests/test_core.py      # un fichier à la fois (aucun ne charge de modèle)
cd back   && npx jest --runInBand src/modules/engine/services/EngineClient.spec.ts         # un fichier à la fois
cd back   && npx tsc --noEmit -p tsconfig.json && npm run build                             # types et compilation
cd front  && npx tsc -p tsconfig.app.json && npx vitest run <fichier.spec.ts>              # types, un fichier Vitest à la fois
cd front  && npm run i18n:check && npx eslint src                                          # locales fr/en, lint
```

Bout en bout sans modèle : `back/src/modules/studio-core/e2e/studioEngine.e2e.spec.ts` lance le moteur en sous-processus en mode
démonstration (`IMAGEGEN_DEMO=1`) et une génération complète (plafond conseillé : 2 Go). Les modèles d'image, d'audio et de vidéo
réels ne sont jamais lancés par les tests.

## Premier lancement : rien à chercher ni à compiler

L'application vérifie elle-même ce qu'il faut pour générer, et propose d'installer tout ce qui manque, en un clic,
avec progression, annulation et messages d'erreur lisibles :

- **Moteur GGUF** : si la build de stable-diffusion.cpp adaptée à votre GPU n'est pas présente, l'application la
  télécharge depuis la version officielle (CUDA sur NVIDIA, ROCm sur AMD, Metal sur Apple, Vulkan sinon ; ≈ 30 Mo à
  0,9 Go), vérifie sa somme SHA-256, l'installe dans `<données>/engines/` (sans droits administrateur) et contrôle
  qu'elle voit bien un GPU — sinon elle essaie la suivante (repli sur Vulkan).
- **Modèle** : l'écran d'accueil recommande le modèle le plus adapté à la machine et l'installe avec le moteur
  (« Tout installer ») ; le sélecteur de modèle et la fenêtre « Modèles » proposent le téléchargement partout où un
  modèle manque.
- **Espace disque et mémoire** : vérifiés avant tout téléchargement ; les modèles qui ne tiennent pas sont signalés
  avec la raison.

Les versions packagées de l'application embarquent déjà les moteurs de leur profil ; l'installation à la demande
sert aux versions de développement et en secours.

## Moteurs et modèles

Trois moteurs d'inférence, choisis selon la machine et le modèle :

| Moteur | Matériel | Remarque |
|---|---|---|
| **MLX** (mflux) | Apple Silicon (Metal natif) | Modèles quantifiés 4/6/8 bits : le plus économe en mémoire sur Mac |
| **PyTorch + diffusers** | NVIDIA (CUDA), AMD (ROCm), Apple (MPS) | Pleine précision bf16 ; déchargement CPU automatique si la VRAM est insuffisante |
| **GGUF** ([stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)) | Apple (Metal), NVIDIA (CUDA), AMD (ROCm), tout GPU Vulkan (NVIDIA, AMD, Intel) | Poids quantifiés : 3 à 5 fois moins de mémoire que PyTorch ; binaire de 30 à 340 Mo, sans PyTorch |

Le moteur GGUF pilote le programme `sd-cli` (un processus par génération : annulation immédiate, mémoire intégralement
rendue). Le backend est choisi d'après le GPU détecté — CUDA sur NVIDIA, ROCm sur AMD, Metal sur Apple, Vulkan sinon
(`IMAGEGEN_SDCPP_VARIANT=vulkan` impose un backend, utile pour comparer les vitesses). Les binaires officiels se
récupèrent avec `python3 scripts-local/fetch_sdcpp.py --variant metal|vulkan|cuda|rocm [--os windows|linux]` (somme SHA-256
vérifiée) dans `engines/sdcpp/<variant>/` ; l'application de bureau les embarque.

| Modèle | Moteur | Usage | Références | Téléchargement |
|---|---|---|---|---|
| **Qwen Image 2.1** | MLX | Texte → image, img2img | 1 image de départ | 9,6 Go (4 bits) ou 24 Go (8 bits) |
| **Qwen Image 2.1** | **GGUF** | Texte → image, **édition** par instruction | jusqu'à 4 images | **11 Go** |
| **Qwen Image 2.1** | PyTorch | Texte → image, **édition**, RGBA | jusqu'à 10 images | 33 Go (32 Go de poids bf16) |
| **Z-Image Turbo** (Apache 2.0) | **GGUF** | Texte → image rapide (8 étapes) | — | **6,7 Go** |
| **Z-Image Turbo** (Apache 2.0) | PyTorch | idem, pleine précision | — | 33 Go |
| **Stable Diffusion XL** | PyTorch | Texte → image, img2img ; tient sur 8 Go | 1 image de départ | 6,5 Go |
| **Pixel Art XL**, **Pixel Art Redmond** (LoRA sur SDXL) | PyTorch | Pixel art, « Pixels nets » | 1 image de départ | SDXL + 0,16 Go |
| **Pixel Art XL · Visage** (LoRA + IP-Adapter sur SDXL) | PyTorch | Portrait pixel art d'après une photo | visage + départ facultatif | SDXL + 3,3 Go |
| **RealVisXL V5**, **Juggernaut XL v9** (SDXL affinés) | PyTorch | Photoréalisme | 1 image de départ | 6,5 Go chacun |
| **DreamShaper XL Turbo** (SDXL affiné) | PyTorch | Illustration, fantasy, 6 étapes | 1 image de départ | 6,5 Go |
| **Animagine XL 4.0** (SDXL affiné) | PyTorch | Anime, manga (prompt en étiquettes) | 1 image de départ | 6,5 Go |
| **Qwen Image Edit** (Apache 2.0) | **GGUF** | Édition par instruction, composition | 1 à 3 images | **19 Go** |
| **Qwen Image Edit** | MLX | Édition par instruction | 1 à 3 images | 58 Go |

Mesuré sur un M3 Max (36 Go) en Metal, poids Q4_K : Z-Image Turbo, 3,2 s par étape à 512×512 (45 s par image de
560×560, chargement compris) ; Qwen Image 2.1, 5,8 s par étape à 576×576 (129 s pour 20 étapes, texte rendu
correctement dans l'image) et 149 s en édition avec guidance 1 — qui ne suit pas bien l'instruction : l'application
applique donc une guidance de 4 en édition (338 s, instruction suivie). Aucune mesure Vulkan/CUDA/ROCm n'a pu être
faite ici.

Qwen Image Edit GGUF (Q4_K_M, Metal, 576×576) : 935 s en 20 étapes, **479 s en 12 étapes** (qualité équivalente, valeur
par défaut), soit environ 40 s par étape — 3 à 4 fois plus lent que Qwen Image 2.1 (modèle de 20 milliards de
paramètres contre 7). Mémoire : ≈ 18 Go pour `sd-cli`, en édition avec une ou deux références ; ne pas lancer d'autre
calcul lourd en parallèle sur une machine de 36 Go. Avec deux références (384×384, 12 étapes : ≈ 320 s), le modèle lit bien
les deux images (il reproduit fidèlement la seconde sur demande), mais une consigne de composition (« ajoute le phare de
l'image 2 dans l'image 1 ») n'a pas abouti dans mon essai à cette définition : à valider avec plus d'étapes.

**Modèles spécialisés SDXL (ajoutés le 2026-10-14, non vérifiés : aucune génération réelle faite).** Les modèles affinés
téléchargent seulement leurs composants diffusers en fp16 (jamais le gros fichier unique posé à côté) et utilisent le
planificateur conseillé par leurs auteurs (DPM++ 2M Karras pour RealVisXL et Juggernaut, Euler a pour Animagine). Une
**LoRA** est un petit fichier (≈ 160 Mo) appliqué à Stable Diffusion XL, téléchargé une fois pour toutes les LoRA ; sa
« Force du style » se règle (0 = SDXL seul, 1 = valeur prévue par l'auteur) et ses mots déclencheurs (« pixel art »…)
sont ajoutés au prompt quand il ne les contient pas. Les LoRA de pixel art ont l'option **« Pixels nets »** (cochée par
défaut) : l'image est réduite 8 fois puis agrandie sans lissage, ce qui la pose sur une vraie grille de pixels, comme le
conseillent les auteurs de Pixel Art XL. Les modèles de pixel art en Stable Diffusion 1.5 (All-In-One-Pixel-Model,
SD_PixelArt_SpriteSheet_Generator) ne sont pas proposés : ils n'existent qu'aux formats `.ckpt` / `.bin`, qui peuvent
exécuter du code au chargement, alors que l'application n'accepte que le format safetensors. D'autres LoRA SDXL s'ajoutent
par la recherche Hugging Face (famille « LoRA SDXL »). **Pixel Art XL · Visage** y ajoute l'IP-Adapter « plus face » de
`h94/IP-Adapter` (Apache 2.0, ≈ 3 Go avec son encodeur d'image) : l'image 1 donne le visage à suivre (« Ressemblance du
visage », 0,6 par défaut), l'image 2, facultative, sert d'image de départ et donne le format. La ressemblance n'est pas
garantie. Avec une image de départ, celle-ci est ramenée à la taille demandée avant d'être redessinée (même règle pour
tous les modèles PyTorch qui partent d'une image).

Seuls des dépôts sans accès restreint sont proposés (aucun compte Hugging Face requis ; un jeton facultatif se
renseigne dans Modèles). Chaque modèle affiche s'il est installé, incomplet ou incompatible avec la machine
(planificateur mémoire : tout sur le GPU, composants chargés un à un, couche par couche, ou refus avec explication).
La recherche Hugging Face applique la même règle de moteur : les résultats que la machine ne peut pas exécuter
(par exemple un modèle PyTorch sans GPU CUDA, ROCm ou Metal) sont listés après les autres, marqués
« incompatible avec cette machine », avec la raison, et ne peuvent pas être ajoutés. À l'ouverture d'un résultat, chaque variante
(quantification) est aussi testée contre la mémoire de la machine, avec la même règle que les modèles de la liste : celles qui
ne tiennent pas sont barrées avec les chiffres, la présélection est une variante qui tient, et le serveur refuse l'ajout d'une
variante qui ne tient pas.

Un seul modèle est chargé à la fois ; il reste en mémoire entre deux générations puis est déchargé après un délai
réglable (Réglages → Mémoire) ou à la demande (indicateur en bas de la barre latérale).

**Économie de mémoire (MLX, activée par défaut).** L'encodeur de texte de Qwen Image 2.1 (≈ 15 Go) n'est chargé que
le temps d'encoder le prompt, puis libéré ; le décodage VAE se fait par tuiles. Mesuré sur un Mac 36 Go : ≈ 9 Go
résidents (pic transitoire ≈ 24 Go pendant l'encodage d'un nouveau prompt), contre ≈ 31 Go sans ces mesures — ce qui
fait swapper la machine. À désactiver dans Réglages sur une machine très dotée en mémoire.

### Ajouter un modèle

- **Modèle diffusers** (le plus courant) : ajouter une `ModelSpec` dans `engine/app/engines/torch_models.py`
  — dépôt Hugging Face, motifs de fichiers à télécharger, classe de pipeline, paramètres exposés. Aucun code de
  moteur à écrire : les arguments inconnus du pipeline sont ignorés.
- **Autre moteur** : une classe `Engine` (`load()` + `generate()`) dans `engine/app/engines/`, voir `qwen21.py`
  pour MLX. Puis l'inscrire dans `engine/app/engines/__init__.py`.

L'interface s'adapte seule : sélecteur, curseurs, règles sur les images de référence, état d'installation.

## Audio : synthèse vocale, clonage, scénarios

Le commutateur **Image / Audio** (en haut du panneau de gauche) bascule l'application entre les deux studios ; conversations,
téléchargements, file d'attente et mémoire sont partagés (un seul modèle chargé à la fois).

- **Voix** : voix intégrées par modèle, **clonage** à partir d'un enregistrement (micro du navigateur ou fichier), **création
  de voix par description** (Qwen3-TTS VoiceDesign). Les voix se gardent dans *Mes voix* ; n'importe quelle prise générée peut
  y être ajoutée (« Garder comme voix de référence »).
- **Transcription automatique** (Whisper, optionnelle) de l'extrait de référence : elle améliore la fidélité du clonage.
- **Scénarios** : `Alice : …` / `Marc : …` — chaque personnage reçoit sa voix, assemblage avec repères cliquables sur l'onde.
- **Longs textes** découpés par phrases (progression par morceau), plusieurs prises (graines) par demande, lecteur avec
  forme d'onde, vitesse, favoris, export WAV.

| Modèle | Clonage | Langues | Poids | Licence | Vérifié (M3 Max) |
|---|---|---|---|---|---|
| Kokoro 82M | non (54 voix) | fr, en, es, it, pt | 0,4 Go | Apache-2.0 | oui, ≈ 4× le temps réel sur CPU |
| Pocket TTS (FR/EN, + DE/ES/IT/PT/NL) | oui | 7 | 0,6 / 1,5 Go | CC-BY-4.0 | oui, ≈ 7× le temps réel sur CPU |
| Qwen3-TTS Voix & style 1.7B / 0.6B | non (9 voix + consigne de style) | 10 | 4,5 / 2,5 Go | Apache-2.0 | 0.6B oui (MPS, bfloat16) |
| Qwen3-TTS Création de voix 1.7B | voix décrite | 10 | 4,5 Go | Apache-2.0 | oui |
| Qwen3-TTS Clonage 1.7B / 0.6B | oui | 10 | 4,5 / 2,5 Go | Apache-2.0 | 0.6B oui |
| Whisper Small / Large v3 Turbo | — (transcription) | multi | 0,5 / 1,6 Go | MIT | Small oui (Metal via mlx-whisper sur Mac ; faster-whisper sur CPU ailleurs) |

Les sorties ont été vérifiées en les retranscrivant avec Whisper. Non testés : CUDA / ROCm / Vulkan pour l'audio
(les installations de PyTorch ciblent `cu128` / `rocm6.4` / CPU, jamais exécutées ici), Windows et Linux.

**Packs de moteurs.** Les bibliothèques audio épinglent des versions incompatibles entre elles (Qwen3-TTS exige
`transformers==4.57.3`, le moteur image `>=5.17`). Chaque famille tourne donc dans son **propre environnement Python**, créé
à la demande depuis l'application (`uv` si présent, sinon `venv` + `pip` en Python 3.12) sous `<données>/engines/audio/<pack>/`,
et piloté par `engine/audio_runtime/worker.py` (protocole JSON ligne à ligne). Ajouter un modèle = une classe dans
`audio_runtime/engines/` + une spec dans `app/engines/audio_specs.py` (+ un pack si les dépendances diffèrent).
**Pack natif audio.cpp.** Un pack peut aussi être un programme précompilé sans Python : `audiocpp` installe le build d'audio.cpp
adapté à la machine (Metal, CUDA, Vulkan ou processeur, vérifié par somme de contrôle) et fait tourner des modèles GGUF sur
**n'importe quel GPU**, y compris AMD et Intel. Les modèles correspondants s'affichent à côté de leurs équivalents PyTorch.
Détails, mesures, limites et candidats : `docs/components/audiocpp.md`. Le registre de tous les composants tiers et la
procédure de revue périodique sont dans `docs/components/README.md`.

Piège rencontré : eSpeak-ng (phonémiseur de Kokoro) tronque son chemin de données à 160 caractères ; le moteur copie les
données sous un chemin court quand le venv est profond.

## Vidéo : génération et édition

Le commutateur **Image / Audio / Vidéo** ouvre le studio vidéo, construit comme le studio image : conversations, file
d'attente, progression et annulation, galerie, téléchargements et mémoire partagés (un seul modèle chargé à la fois).

- **Composer** : prompt, image de départ (et image de fin pour les modèles qui la gèrent), vidéo source à modifier,
  durée, format, définition, étapes, graine, nombre de clips (1–2). Le nombre d'images est arrondi à ce que le modèle accepte.
- **Résultats** : lecteur intégré (avec le son quand le modèle en produit), varier, relancer, reprendre les réglages,
  utiliser un clip comme vidéo source, **dernière image comme départ** pour enchaîner un plan, favoris, téléchargement MP4.
- **Modèles Hugging Face** : la recherche du gestionnaire de modèles propose aussi les dépôts vidéo au format
  diffusers (Wan, CogVideoX, HunyuanVideo 1.5, LTX-2) et les quantifications GGUF de Wan 2.2 TI2V 5B.

| Modèle | Spécialité | Moteur | Téléchargement | Licence |
|---|---|---|---|---|
| **Wan 2.2 TI2V 5B** | Polyvalent, la meilleure qualité ouverte (texte → vidéo, image → vidéo) | **GGUF** (Metal, CUDA, ROCm, Vulkan) ou PyTorch | 8,5 Go (Q4_K_M) / 34 Go (PyTorch) | Apache 2.0 |
| **Wan 2.2 14B** (T2V, I2V) | Qualité maximale, début et fin au choix (I2V) ; lent | GGUF (deux experts) | 21 Go (Q4_K_S) | Apache 2.0 |
| **LTX-2.3 Distilled 1.1** | Rapide, haute définition, son synchronisé | GGUF | 24,5 Go (Q4_K_S ; Q3_K_M : 22 Go) | licence LTX-2 (gratuite sous 10 M$ de CA) |
| **LTX-2.5 Distilled** | Dernière version de LTX : encodeur Gemma 4, son synchronisé | GGUF | 25,5 Go | licence LTX-2 ; **dépôts à accès restreint** (jeton Hugging Face requis) |
| **HunyuanVideo 1.5** (T2V, I2V) | Réalisme et mouvement soignés, 480p | GGUF ou PyTorch | 12,7 Go (Q4_K_M) | Tencent Hunyuan : **exclue dans l'UE, au Royaume-Uni et en Corée du Sud** (avertissement dans l'interface) |
| **CogVideoX 2B** (5B, 5B I2V) | Léger, clips courts 480p | PyTorch | 14 Go (5B : 22 Go) | Apache 2.0 (5B : licence CogVideoX) |
| **Kiwi-Edit 5B** | Édition de vidéo par instruction (+ image de référence) | pack isolé, NVIDIA | 20 Go | MIT (code) ; poids sans licence déclarée |
| **Bernini-R 1.3B** | Génération et édition de vidéo (rendu seul, sans planificateur) | pack isolé, NVIDIA | 29 Go | Apache 2.0 |

Chaque modèle est pris dans sa **dernière version ouverte** (vérifié le 12/10/2026) : pas de Wan 2.5+ ouvert, LTX-2.5 est la
plus récente de sa famille (LTX-2.3 `distilled-1.1` reste disponible sans compte), Bernini v2 complet (planificateur + rendu,
≈ 48 Go même en int4) est trop lourd, on garde le rendu seul.

**Moteurs.** La vidéo passe de préférence par le moteur **GGUF** (`sd-cli -M vid_gen`, stable-diffusion.cpp, version épinglée
`master-956`), donc sur Metal, CUDA, ROCm et Vulkan avec des poids quantifiés en 4 bits ; `sd-cli` ne produit pas de MP4, l'application
convertit sa sortie (et le son de LTX) en MP4 H.264 + AAC avec FFmpeg (PyAV ; sur Mac, encodeur matériel VideoToolbox ; build et
licence : `docs/components/ffmpeg.md`). Sur Mac, une build de `sd-cli` antérieure à `master-745` est refusée (Wan n'y fonctionnait pas).
Les versions PyTorch + diffusers restent en alternative (CogVideoX n'existe que là). **Kiwi-Edit et Bernini** ont besoin du code
officiel et de dépendances épinglées : ils tournent dans un **environnement Python isolé** (« pack », créé à la demande dans
`<données>/engines/video/`) et exigent une carte NVIDIA (ou AMD sous Linux) ; sinon ils sont listés comme incompatibles avec la raison.

Le planificateur mémoire refuse un modèle qui ne tient pas (sur Mac, GPU et processeur partagent la même mémoire : pas de
déchargement « gratuit »). Sur une machine de 36 Go : Wan 5B (Q4 ou Q8), HunyuanVideo 1.5 480p et CogVideoX passent ; Wan 14B, LTX et
LTX-2.5 demandent 48 Go ou plus (LTX-2.3 en Q3_K_M passe de justesse).

**Mesuré sur un M3 Max (36 Go), seul essai réel à ce jour** : Wan 2.2 TI2V 5B Q4_K_M via `sd-cli` (Metal), texte → vidéo, 480×832.
9 images, 20 étapes : échantillonnage ≈ 6 s par étape, 7 Go de mémoire résidente, MP4 H.264 valide, image cohérente. 33 images :
≈ 20 s par étape et la mémoire libre du système est tombée sous 6 Go (essai interrompu par le garde-fou) ; les clips sont donc limités
à 1 s par défaut (2 s au plus) sur ces modèles. À 384×256 le modèle ne produit que du bruit abstrait : rien sous 480p n'est proposé.
Le décodage du VAE complet est le goulot sur Metal (150 à 170 s même pour 9 images, tuilage sans effet) : l'option **« Décodage
rapide »** (TAEHV, 23 Mo téléchargés au premier usage, vérifiés par SHA-256, activée par défaut sur Mac) le ramène à moins d'une seconde.

**Non vérifié.** Tout le reste n'a jamais tourné pour de vrai : image → vidéo, Wan 14B, LTX, HunyuanVideo, CogVideoX, les deux
packs, le démuxage du `.webm` de `sd-cli`. Ils reposent sur la lecture du code amont et sur des tests avec un faux `sd-cli`.
Tailles issues de l'API Hugging Face ; besoins en mémoire estimés. Points précis : les réglages « distillé » de LTX (8 étapes, sigmas
de diffusers) sont une inférence ; le GGUF Gemma 4 de LTX-2.5 n'est pas confirmé chargeable par `sd-cli` (sinon le convertir avec
`sd-cli -M convert`) ; l'I2V de HunyuanVideo n'est pas documenté côté `sd-cli` ; l'effet de `--offload-to-cpu` sur Metal est inconnu
(`IMAGEGEN_SDCPP_OFFLOAD=on|off`). LTX-2.3 en PyTorch utilise la copie bf16 de Gemma 3
`Lightricks/gemma-3-12b-it-qat-q4_0-unquantized` (mêmes 1065 tenseurs, valeurs échantillonnées identiques). Les packs ont été relus contre le
code amont (confiance estimée : Kiwi-Edit ≈ 75 %, Bernini ≈ 65 %).

**À essayer en vrai, du plus petit au plus gros** (surveiller la pression mémoire à chaque étape) : Wan 5B image → vidéo (le texte → vidéo est fait) ; Wan 5B en 720p ; HunyuanVideo 480p ; LTX-2.3 Q3_K_M ; sur 48 Go ou plus seulement, Wan 14B et LTX-2.5.

## Structure du dépôt

```
engine/     moteur Python (FastAPI) : modèles, téléchargements, jobs, médias ; openapi.json = contrat avec Nest (généré)
back/       serveur NestJS (gabarit vx-public, SQLite, mode local de confiance) : modules `engine`, `studio-core`, `media-library`,
            `audio-studio`, `settings`, `hardware`, `model-catalog`, `engines`, `legacy-import`
front/      interface React + MUI (gabarit vx-public) : modules `studio-shell`, `studio-core`, `image-studio`, `audio-studio`, `voices`,
            `video-studio`, `media-library`, `model-catalog`, `engines`, `settings`, `hardware` ; thème `chambre-noire`
desktop/    application de bureau (coquille Tauri du gabarit)
scripts/    lien vers les scripts du gabarit (lanceur `run.sh`) ; scripts-local/ : scripts propres au projet (crochet de dev du moteur,
            empaquetage du moteur, export OpenAPI, revue des composants, récupération de stable-diffusion.cpp)
docs/       components/ (registre des composants tiers), migration/ (plan de migration)
data/       dossier de données du développement (créé au démarrage, non versionné)
```

Les sous-modules du gabarit (`back/.libs/vx-public`, `front/.libs/vx-public`, `front/.libs/apptemplate`) sont à initialiser après un
clone (`git submodule update --init`). Le plan du moteur, le contrat Nest ↔ moteur (régénération de `engine/openapi.json` et des types :
`engine/.venv/bin/python scripts-local/export_engine_openapi.py` puis `cd back && npm run engine:types`) et le flux d'événements sont
dans [ARCHITECTURE.md](ARCHITECTURE.md). Règles de travail (mémoire unifiée, commandes sous garde) : [CLAUDE.md](CLAUDE.md).

## Application de bureau

Application autonome : coque [Tauri](https://tauri.app) v2 **du gabarit** (`desktop/`, documentée dans `desktop/README.md`),
qui supervise **deux processus** : le moteur Python (processus annexe `engine`, interpréteur et dépendances **embarqués**)
et le serveur Nest (Node embarqué), qui sert aussi le front. Aucune installation de Python, Node ou uv n'est nécessaire
pour l'utiliser ; interface en thème sombre.

Tout ce qui est propre à ai-medialab tient dans `desktop/desktop.config.json` :

| Processus | Commande | Santé | Variables |
|---|---|---|---|
| `engine` (démarré **avant** Nest) | `engine-runtime/python` : `-m uvicorn app.main:app --host 127.0.0.1 --port {port}` | `/engine/v1/status` (240 s max) | `ENGINE_TOKEN` (jeton du lancement), `IMAGEGEN_DATA_DIR={dataDir}`, `IMAGEGEN_ENGINES_DIR={resources}/engines`, `IMAGEGEN_LEGACY_DATA_DIRS`, `PYTHONPATH` |
| `server` (Nest) | `runtime/node/node dist/main.js` | `/api/v1/health` | `ENGINE_URL=http://127.0.0.1:{port:engine}`, `ENGINE_TOKEN` (même valeur), puis tout ce que la coque injecte (`APP_DATA_DIR`, `DB_PATH=<données>/app.db`, `SERVE_FRONT_DIR`, `LOCAL_TRUST`, etc.) |

La coque ouvre la page d'attente (thème « chambre noire » : `desktop/splash/`), alloue deux ports libres, génère le
jeton, démarre le moteur, attend `/engine/v1/status`, démarre Nest, attend sa santé (qui inclut celle du moteur), puis
navigue vers `http://127.0.0.1:<port>/`. À la fermeture elle arrête les deux groupes de processus (moteur, worker de
génération, Nest) ; un sentinelle les arrête aussi si la coque meurt brutalement.

Profils d'exécution (un installateur = un profil ; le build de PyTorch dépend du GPU), dans `desktop/runtime/profiles.json` :

| Profil | Cible | État |
|---|---|---|
| `mac-arm64` | macOS Apple Silicon — Metal (MLX) et PyTorch/MPS | assemblé et testé avec l'ancienne coque ; **la chaîne de la coque du gabarit n'a pas été reconstruite** |
| `win-cuda` | Windows + NVIDIA (CUDA 12.8) | scripté, **non vérifié** |
| `linux-cuda` | Linux + NVIDIA (CUDA 12.8) | scripté, **non vérifié** |
| `linux-rocm` | Linux + AMD (ROCm 7.2) | scripté, **non vérifié** |
| `win-rocm` | Windows + AMD Radeon (ROCm 7.2.1, préversion AMD) | scripté, **expérimental, non vérifié** |

### Construire et lancer

Prérequis : [uv](https://docs.astral.sh/uv/), Node.js ≥ 22, Rust (`rustup`), Xcode Command Line Tools, accès réseau (Python
standalone, wheels, Node officiel, binaires de better-sqlite3 et de stable-diffusion.cpp). Espace disque : ~15 Go pour la
cible macOS, autant par cible Windows ou Linux.

```sh
./scripts/app.sh                  # construit l'app pour cette machine et l'ouvre (--no-run, --no-build, --clean)
./scripts/bundle.sh               # paquets dans desktop/dist/ : .dmg + zip win-x64 + tar.gz linux-x64
./scripts/bundle.sh --targets darwin-arm64        # le .dmg seul
```

Les deux scripts viennent du gabarit (`desktop/README.md`, section « Build and package scripts ») : build du back et du front,
crochet du projet, assemblage (`scripts/desktop/build-desktop.mjs`), `tauri build`. `cd back && npm run desktop:build` =
`app.sh --no-run`. Le crochet `scripts-local/desktop-prepare.sh <cible>` construit le moteur embarqué
(`scripts-local/build_runtime.py`, dans `desktop/build/engine-bundle/` = `engine/`, `engine-runtime/{python,site-packages}`,
`engines/sdcpp/<variante>`) avec le profil de la cible : `darwin-arm64` → `mac-arm64`, `win-x64` → `win-cuda`, `linux-x64` →
`linux-cuda` ; `DESKTOP_PROFILE=win-rocm|linux-rocm` en choisit un autre. Il ne refait que la copie du code du moteur
(`--refresh-app`, quelques secondes) tant que le profil, `engine/pyproject.toml`, `engine/uv.lock` et `profiles.json` n'ont pas
changé ; changer de profil (donc de cible) reconstruit tout.

Résultats : `app.sh` ouvre `desktop/src-tauri/target/release/bundle/macos/AI MediaLab.app` (journaux dans
`~/Library/Application Support/app.aimedialab.studio/logs`) ; `bundle.sh` copie `AI MediaLab_<version>_aarch64.dmg` et les archives
portables dans `desktop/dist/`. Windows depuis le Mac demande `brew install mingw-w64` ; Linux, Docker démarré ; sinon la cible est
ignorée avec la raison. Les paquets Windows et Linux sont cross-construits et **non vérifiés** sur leur matériel. Le workflow
`.github/workflows/build-desktop.yml` (jamais exécuté) fait la même chaîne sur chaque OS.

Itérer sans empaqueter : `cd back && npm run desktop:dev` (la racine du dépôt sert de ressources : `back/dist`, `front/dist`,
`engine/.venv` créé par `uv sync`, Node du système ; `DESKTOP_RESOURCES`).

### Données et premier lancement

- Dossier de données = dossier local de l'OS de l'identifiant `app.aimedialab.studio` (macOS :
  `~/Library/Application Support/app.aimedialab.studio/`), **le même que celui de l'ancienne application** : la coque l'exporte
  en `APP_DATA_DIR` à Nest et le moteur le lit en `IMAGEGEN_DATA_DIR` (`{dataDir}`). Contenu, propriétaire de chaque élément,
  reprise de l'ancien dossier « Chambre noire » (`app.chambrenoire.studio`) et import de l'ancienne base au premier lancement :
  `ARCHITECTURE.md`, section « Données et migrations » (rien à faire pour l'utilisateur, rien n'est supprimé). Journaux :
  `logs/` (`shell.log`, `engine.log`, `server.log`, `*.previous.log`). Les modèles restent dans le cache Hugging Face habituel.
- Signature **ad hoc** uniquement : une application téléchargée est mise en quarantaine par Gatekeeper (clic droit, Ouvrir, ou
  `xattr -dr com.apple.quarantine "/Applications/AI MediaLab.app"`). Distribution publique : Developer ID et notarisation
  (décrit dans `desktop/README.md`, non automatisé).
- Nettoyage (≈ 10 Go) : `rm -rf desktop/build desktop/src-tauri/target`.
- Mémoire au repos : `ARCHITECTURE.md`, section « Mémoire au repos ».

## Quantifications

Chaque modèle MLX et GGUF propose plusieurs quantifications (*Modèles → carte du modèle → Quantification*) : seule celle
qu'on choisit est téléchargée, jamais la version pleine précision. Qwen Image 2.1 MLX : 4 bits (défaut, ≈ 10 Go de pic
mémoire mesuré à 1024²) ou 8 bits. GGUF : de Q2_K à Q8_0. Les modèles PyTorch n'ont qu'une précision (bf16 / fp16).

## Ajouter un modèle depuis Hugging Face

*Modèles → Chercher sur Hugging Face* (ou « Chercher un modèle… » en bas du sélecteur de modèle) : la recherche ne
propose que des formats que l'application sait exécuter, et relit le dépôt avant de l'ajouter.

| Famille | Ce qui est accepté | Exécuté par |
|---|---|---|
| Image · GGUF | autres quantifications ou fine-tunes de Z-Image Turbo, Qwen Image 2.1, Qwen Image Edit (au choix : Q2_K … Q8_0) | stable-diffusion.cpp |
| Image · diffusers | Stable Diffusion 1.x et XL en safetensors (fp16 de préférence) | PyTorch |
| Audio · Qwen3-TTS | variantes bf16 voix & style, création de voix, clonage | pack `qwen3` |
| Audio · Whisper | modèles faster-whisper (CTranslate2) | pack `speech` |

Refusés avec une explication : dépôts à accès restreint, formats `.bin`/`.ckpt`, modèles quantifiés non chargeables
(GGUF/MLX/ONNX de Qwen3-TTS), architectures non gérées (Flux, SD3…). Une « recette » (dépôt, fichier, famille) est
enregistrée dans l'état propre du moteur (`engine-state.json`, dossier de données) ; le modèle apparaît dans les listes avec la mention *Hugging Face* et peut être retiré.
La **précision** affichée (Q4_K, bf16, fp16…) vient du nom du fichier GGUF ou de l'en-tête safetensors, lu à distance
sans télécharger le fichier.

## Licence

Code sous [licence MIT](LICENSE). Les modèles téléchargés gardent leur propre licence : voir [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
