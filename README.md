# Chambre noire

Studio local de création et d'édition d'images, sous forme de chat. Les modèles ouverts tournent sur la
machine — Metal (Apple Silicon), NVIDIA (CUDA) ou AMD (ROCm) — sans service externe. L'application embarque
le serveur d'inférence et le gestionnaire de téléchargement des modèles (Hugging Face).

- Conversations : historique, recherche, épinglage, renommage, suppression.
- Composer : prompt, images de référence (bouton, glisser-déposer, coller), choix du modèle,
  format/définition, nombre d'images (1–4), étapes, graine fixe ou aléatoire, prompt négatif…
- Génération en temps réel : file d'attente, chargement du modèle, étapes, temps restant, aperçus
  intermédiaires qui « se révèlent », annulation.
- Résultats : varier (nouvelles graines), relancer à l'identique, reprendre les réglages, utiliser une
  image comme référence pour l'itération suivante, favoris, téléchargement, visionneuse plein écran.
- Galerie de toutes les images, filtrable (prompt, favoris).
- Interface sombre par défaut (thème clair en option).
- Gestionnaire de modèles : détection de la machine (GPU, mémoire, disque), téléchargement avec progression,
  reprise et annulation, suppression, compatibilité mémoire par modèle.

## Démarrer (développement)

```sh
./start.sh            # installe, compile l'interface, sert sur http://127.0.0.1:8000
```

Prérequis : [uv](https://docs.astral.sh/uv/), Node.js ≥ 20. Sur Mac Apple Silicon `start.sh` installe MLX et PyTorch ;
le premier lancement installe les dépendances dans `backend/.venv`. Pour une application autonome (aucun prérequis),
voir « Application de bureau » plus bas.

Variables utiles :

| Variable | Rôle |
|---|---|
| `PORT`, `HOST` | Adresse d'écoute (défaut `127.0.0.1:8000`) |
| `IMAGEGEN_DATA_DIR` | Dossier des données (défaut `./data` : base SQLite, images) |
| `HF_HOME` / `HF_HUB_CACHE` | Emplacement des modèles (défaut `~/.cache/huggingface/hub`, partagé avec mflux/diffusers) |
| `IMAGEGEN_DEMO=1` | Ajoute un modèle « Démo » instantané, sans GPU, pour tester l'interface |

Développement (rechargement à chaud) : `./dev.sh` puis http://localhost:5173.

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
récupèrent avec `python3 scripts/fetch_sdcpp.py --variant metal|vulkan|cuda|rocm [--os windows|linux]` (somme SHA-256
vérifiée) dans `engines/sdcpp/<variant>/` ; l'application de bureau les embarque.

| Modèle | Moteur | Usage | Références | Téléchargement |
|---|---|---|---|---|
| **Qwen Image 2.1** | MLX | Texte → image, img2img | 1 image de départ | 33 Go |
| **Qwen Image 2.1** | **GGUF** | Texte → image, **édition** par instruction | jusqu'à 4 images | **11 Go** |
| **Qwen Image 2.1** | PyTorch | Texte → image, **édition**, RGBA | jusqu'à 10 images | 33 Go (32 Go de poids bf16) |
| **Z-Image Turbo** (Apache 2.0) | **GGUF** | Texte → image rapide (8 étapes) | — | **6,7 Go** |
| **Z-Image Turbo** (Apache 2.0) | PyTorch | idem, pleine précision | — | 33 Go |
| **Stable Diffusion XL** | PyTorch | Texte → image, img2img ; tient sur 8 Go | 1 image de départ | 7 Go |
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

Seuls des dépôts sans accès restreint sont proposés (aucun compte Hugging Face requis ; un jeton facultatif se
renseigne dans Modèles). Chaque modèle affiche s'il est installé, incomplet ou incompatible avec la machine
(planificateur mémoire : tout sur le GPU, composants chargés un à un, couche par couche, ou refus avec explication).

Un seul modèle est chargé à la fois ; il reste en mémoire entre deux générations puis est déchargé après un délai
réglable (Réglages → Mémoire) ou à la demande (indicateur en bas de la barre latérale).

**Économie de mémoire (MLX, activée par défaut).** L'encodeur de texte de Qwen Image 2.1 (≈ 15 Go) n'est chargé que
le temps d'encoder le prompt, puis libéré ; le décodage VAE se fait par tuiles. Mesuré sur un Mac 36 Go : ≈ 9 Go
résidents (pic transitoire ≈ 24 Go pendant l'encodage d'un nouveau prompt), contre ≈ 31 Go sans ces mesures — ce qui
fait swapper la machine. À désactiver dans Réglages sur une machine très dotée en mémoire.

### Ajouter un modèle

- **Modèle diffusers** (le plus courant) : ajouter une `ModelSpec` dans `backend/app/engines/torch_models.py`
  — dépôt Hugging Face, motifs de fichiers à télécharger, classe de pipeline, paramètres exposés. Aucun code de
  moteur à écrire : les arguments inconnus du pipeline sont ignorés.
- **Autre moteur** : une classe `Engine` (`load()` + `generate()`) dans `backend/app/engines/`, voir `qwen21.py`
  pour MLX. Puis l'inscrire dans `backend/app/engines/__init__.py`.

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
| Whisper Small / Large v3 Turbo | — (transcription) | multi | 0,5 / 1,6 Go | MIT | Small oui |

Les sorties ont été vérifiées en les retranscrivant avec Whisper. Non testés : CUDA / ROCm / Vulkan pour l'audio
(les installations de PyTorch ciblent `cu128` / `rocm6.4` / CPU, jamais exécutées ici), Windows et Linux.

**Packs de moteurs.** Les bibliothèques audio épinglent des versions incompatibles entre elles (Qwen3-TTS exige
`transformers==4.57.3`, le moteur image `>=5.17`). Chaque famille tourne donc dans son **propre environnement Python**, créé
à la demande depuis l'application (`uv` si présent, sinon `venv` + `pip` en Python 3.12) sous `<données>/engines/audio/<pack>/`,
et piloté par `backend/audio_runtime/worker.py` (protocole JSON ligne à ligne). Ajouter un modèle = une classe dans
`audio_runtime/engines/` + une spec dans `app/engines/audio_specs.py` (+ un pack si les dépendances diffèrent).
Piège rencontré : eSpeak-ng (phonémiseur de Kokoro) tronque son chemin de données à 160 caractères ; le moteur copie les
données sous un chemin court quand le venv est profond.

## Architecture

```
backend/   FastAPI · SQLite · worker MLX dans un processus séparé
  app/main.py        application, fichiers statiques, interface compilée
  app/api/routes.py  API REST + flux SSE (/api/events)
  app/jobs.py        file d'attente, cycle de vie du worker, progression
  app/worker.py      processus qui charge le modèle et génère
  app/engines/       registre, moteurs MLX et diffusers, catalogue des modèles
  app/downloads.py   téléchargement des modèles (processus dédié, reprise, annulation)
  app/system.py      détection GPU / mémoire / disque, planificateur mémoire
frontend/  React 19 · TypeScript · Vite · Tailwind 4 · TanStack Query · Zustand · Radix
data/      base SQLite, références importées, images générées, vignettes (créé au démarrage)
```

Le worker tourne dans son propre processus : le serveur reste réactif pendant le calcul, décharger un
modèle libère vraiment la mémoire, et un plantage (mémoire insuffisante…) n'emporte pas l'application.

## Application de bureau

Application autonome (coque [Tauri](https://tauri.app) v2 + interpréteur Python et dépendances **embarqués** + serveur + interface).
Aucune installation de Python, Node ou uv n'est nécessaire pour l'utiliser ; interface en thème sombre.

| Profil | Cible | État |
|---|---|---|
| `mac-arm64` | macOS Apple Silicon — Metal (MLX) et PyTorch/MPS | **construit et testé** |
| `win-cuda` | Windows + NVIDIA (CUDA 12.8) | scripté, **non vérifié** |
| `linux-cuda` | Linux + NVIDIA (CUDA 12.8) | scripté, **non vérifié** |
| `linux-rocm` | Linux + AMD (ROCm 7.2) | scripté, **non vérifié** |
| `win-rocm` | Windows + AMD Radeon (ROCm 7.2.1, préversion AMD) | scripté, **expérimental, non vérifié** |

Un installateur = un profil (le build de PyTorch dépend du GPU). Les profils (index pip, versions) sont dans
`desktop/runtime/profiles.json` ; le workflow `.github/workflows/build-desktop.yml` (jamais exécuté) les construit sur
macOS, Windows et Linux — **un profil ne se construit que sur son propre OS**.

### Construire (macOS Apple Silicon)

Prérequis : [uv](https://docs.astral.sh/uv/), Node.js ≥ 20, Rust (`rustup`), Xcode Command Line Tools. ~6 Go d'espace libre.

```sh
cd frontend && npm install && npm run build && cd ..        # interface (si dist/ absent)
python3 scripts/build_runtime.py --profile mac-arm64        # → desktop/build/resources (Python + dépendances, ~1,3 Go)
cd desktop && npm install && npx tauri build --bundles app,dmg
# → desktop/src-tauri/target/release/bundle/macos/Chambre noire.app
# → desktop/src-tauri/target/release/bundle/dmg/Chambre noire_0.1.0_aarch64.dmg
```

Après une modification du backend ou de l'interface, `python3 scripts/build_runtime.py --profile mac-arm64 --refresh-app`
ne recopie que `backend/` et `frontend/dist` (quelques secondes), puis `npx tauri build` régénère l'application.

### Fonctionnement

- Au lancement, la coque choisit un port local libre, démarre le serveur avec le Python embarqué, affiche un écran de
  démarrage, puis charge l'interface. À la fermeture elle arrête le serveur **et** le worker de génération.
- Données (base, images, journaux) : `~/Library/Application Support/app.chambrenoire.studio/`
  (journal du serveur : `logs/backend.log`). Les modèles restent dans le cache Hugging Face habituel (`~/.cache/huggingface`).
- Signature **ad hoc** uniquement (pas de compte développeur Apple) : une application téléchargée est mise en quarantaine
  par Gatekeeper. Pour l'ouvrir : clic droit → Ouvrir, ou `xattr -dr com.apple.quarantine "/Applications/Chambre noire.app"`.
  Une distribution publique demande un certificat « Developer ID » et la notarisation.
- Itérer sans réassembler le bundle : `CHAMBRE_NOIRE_RESOURCES=$PWD/desktop/build/resources desktop/src-tauri/target/release/chambre-noire`
  (la coque utilise alors ces ressources au lieu de celles du `.app`).
- Nettoyage (≈ 5 Go) : `rm -rf desktop/build desktop/src-tauri/target`.

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
enregistrée dans les réglages ; le modèle apparaît dans les listes avec la mention *Hugging Face* et peut être retiré.
La **précision** affichée (Q4_K, bf16, fp16…) vient du nom du fichier GGUF ou de l'en-tête safetensors, lu à distance
sans télécharger le fichier.

## Licence

Code sous [licence MIT](LICENSE). Les modèles téléchargés gardent leur propre licence : voir [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
