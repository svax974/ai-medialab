# Tests manuels — audio.cpp, transcription, marqueur « lent », recherche Hugging Face

À faire par vous : ce que je n'ai pas pu exécuter (pas de GPU Vulkan/CUDA/AMD/Intel ici, application non lancée).
Cochez chaque étape une fois faite : `[ ]` à faire · `[x]` OK · `[~]` OK avec réserve (noter laquelle) · `[!]` échec (noter l'erreur).
Fiche du composant : [audiocpp.md](audiocpp.md). Machine, système, GPU et date : à noter en tête de chaque passage.

Passage du ____ / ____ / ______ — machine : ______________________ — GPU : ______________________

## A. Installation du moteur (toute machine)

- [ ] **Ouvrir Modèles → Audio et repérer « Qwen3-TTS · Clonage 0.6B (GGUF) »**
  - Attendu : badge « audio.cpp (ggml) », texte « Programme autonome : le moteur audio.cpp précompilé… », bouton pour installer le moteur (≈ 30 à 60 Mo selon la machine), aucun message sur Python/uv.
- [ ] **Installer le moteur**
  - Attendu : progression, puis « Installé ». Le fichier `VERSION.json` du dossier `<engines>/audiocpp/<variante>/` indique la version épinglée.
  - Variante installée attendue : Mac Apple Silicon → `metal` · Windows NVIDIA → `cuda` · Windows/Linux AMD ou Intel → `vulkan` · sinon `cpu`. Noter la variante obtenue : ________
- [ ] **Vérifier que le GPU est vu** : lancer `<engines>/audiocpp/<variante>/audiocpp_cli --list-devices`
  - Attendu : une ligne `[GPU]` (par exemple `Vulkan0 "AMD Radeon…" [GPU]`). Si seulement `[CPU]` : noter, c'est le repli.

## B. Synthèse vocale GGUF (sur votre GPU)

Pour chaque modèle, télécharger puis générer une phrase de 2 à 3 lignes. Noter le temps et si la voix est correcte.

- [ ] **Pocket TTS · FR / EN (GGUF)** (≈ 0,4 Go) : voix « Estelle » en français puis « Alba » en anglais, puis un clonage.
  - Attendu : la langue choisie est respectée, voix intelligible, bien plus rapide que le temps réel. Temps : ________
- [ ] **Chatterbox · Clonage expressif (GGUF)** (≈ 2,1 Go) : choisir une voix de la bibliothèque, générer en **français**, puis en **anglais** et en **allemand** sans changer de voix.
  - Attendu : la langue suit le sélecteur ; sans voix choisie, le modèle demande une voix de référence. Régler « Expressivité » à 0,5 puis 0,9 : la diction change. Noter l'accent résiduel de l'échantillon : ________
  - Question ouverte : l'audio généré contient-il le filigrane de l'éditeur ? (non vérifiable à l'oreille ; laisser vide si inconnu)
- [ ] **Qwen3-TTS · Clonage 0.6B (GGUF)** : cloner une voix en français.
  - Attendu : voix proche de l'échantillon ; avec la transcription de l'échantillon renseignée, la fidélité est meilleure.
- [ ] **Qwen3-TTS 1.7B (GGUF) : Voix & style, Création de voix, Clonage** (≈ 2,7 à 2,8 Go chacun)
  - Voix & style : essayer au moins « Vivian », « Ryan » et une consigne de style (« chuchoté »). Noter les voix qui échouent : ________
  - Création de voix : « femme de 30 ans, voix grave et rassurante ».
- [ ] **Surveiller la mémoire** pendant ces essais : sur un GPU Vulkan, la mémoire vidéo et la RAM ne doivent pas saturer. Noter le pic : ________

## C. Transcription

- [ ] **Voix → Nouvelle voix : enregistrer ou importer un extrait de 10 à 20 s en français, sans rien installer d'autre que « Qwen3-ASR 0.6B (GGUF) »**
  - Attendu : le bouton « Transcrire automatiquement » est disponible, le texte proposé correspond à l'extrait, **le champ reste modifiable** : corriger un mot, enregistrer la voix, rouvrir avec le crayon « Modifier » : la correction est conservée.
- [ ] **Avec Whisper ET Qwen3-ASR installés** : la transcription utilise Whisper (par défaut).
- [ ] **Whisper téléchargé mais son moteur « Voix légères » non installé, Qwen3-ASR installé** : la transcription fonctionne quand même (elle bascule sur Qwen3-ASR).
- [ ] **Extrait difficile (accent marqué ou bruit de fond)** : comparer Qwen3-ASR 0.6B, 1.7B et Whisper. Noter lequel se trompe le moins : ________

## D. Marqueur « lent · processeur » (machine AMD ou Intel sous Windows, ou sans GPU)

- [ ] **Modèles → Audio : repérer « Qwen3-TTS · Clonage 1.7B » (version PyTorch)**
  - Attendu sur AMD/Intel Windows : pastille « lent · processeur », message en orange qui nomme l'alternative GGUF. Sur NVIDIA ou Mac : aucune pastille.
- [ ] **Kokoro, Pocket TTS, Whisper** : jamais de pastille.
- [ ] **Modèle recommandé par défaut** : ce n'est pas un modèle marqué lent.

## E. Recherche Hugging Face et mémoire

- [ ] **Modèles → Ajouter depuis Hugging Face : chercher un dépôt GGUF d'image** (par exemple « Z-Image Turbo GGUF »), ouvrir un résultat.
  - Attendu : la quantification présélectionnée est une qui tient dans la mémoire ; celles qui ne tiennent pas sont barrées (info-bulle avec les chiffres) et, si on en sélectionne une, un message orange apparaît et « Ajouter et télécharger » est grisé.
  - Sur une machine confortable, aucune variante barrée : noter la RAM/VRAM : ________
- [ ] **Chercher un modèle PyTorch (Stable Diffusion) sur une machine sans CUDA/ROCm/Metal**
  - Attendu : résultat grisé « incompatible avec cette machine », raison affichée, ajout impossible.

## F. Vulkan / CUDA / CPU (à faire au moins une fois par type de GPU disponible)

- [ ] **Forcer chaque build installé** (variable `IMAGEGEN_AUDIOCPP_VARIANT=vulkan`, `cuda` ou `cpu`) et générer avec Pocket FR puis Chatterbox.
  - Attendu : même résultat qu'en B ; noter les erreurs éventuelles et la vitesse par build : ________
- [ ] **Noter le résultat dans la section « À vérifier à la revue » d'`audiocpp.md`** (point « Valider Vulkan, CUDA et CPU »).
