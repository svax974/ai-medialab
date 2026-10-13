# audio.cpp — moteur audio GGUF (ggml)

*Dernière vérification contre le code et l'amont : 2026-10-13.* Registre et procédure de revue : [README.md](README.md).

## Pourquoi

Les moteurs audio PyTorch ne couvrent que CUDA, ROCm (Linux) et Metal ; sur un GPU AMD ou Intel sous Windows, ou sur un
NVIDIA sans pilote CUDA exploitable, ils retombent sur le processeur. audio.cpp (<https://github.com/0xShug0/audio.cpp>,
Apache-2.0) fait tourner plus de cent modèles audio au format GGUF sur Metal, CUDA, **Vulkan** (tout GPU) ou CPU, avec
des binaires précompilés. C'est le même principe que stable-diffusion.cpp pour les images et la vidéo.

Pas de cas par cas par modèle : un seul binaire, une CLI commune (`--family`, `--model`, `--backend`), et chaque modèle
supplémentaire se réduit à une fiche dans `backend/app/engines/audiocpp_specs.py`.

## Ce qui est intégré

| Élément | Où | Rôle |
|---|---|---|
| Installation et choix du build | `backend/app/audiocpp.py` | télécharge la version épinglée (`PINNED_TAG`), vérifie le SHA-256 publié par GitHub, extrait sans sortir du dossier cible, vérifie qu'un GPU est vu, sinon essaie le build suivant jusqu'au CPU |
| Pack « natif » | `backend/app/audio_packs.py` (pack `audiocpp`, champ `native`) | réutilise tel quel le bouton d'installation, la progression et les événements des packs Python, sans environnement Python |
| Moteur du worker | `backend/audio_runtime/engines/audiocpp_engine.py` | un appel `audiocpp_cli` par morceau de texte ; annulation = arrêt du processus |
| Modèles | `backend/app/engines/audiocpp_specs.py` | quatre variantes Qwen3-TTS, Chatterbox, Pocket TTS FR/EN et Qwen3-ASR (voir plus bas) |
| Transcription | `backend/app/transcription.py`, `audiocpp.run_transcribe` | choisit le modèle (poids **et** moteur présents, Whisper d'abord) et lance Whisper ou audio.cpp |
| Recherche de compatibilité | `backend/app/catalog.py` (`engine_for`, `engine_compat`) | la même règle sert aux modèles du catalogue et aux résultats de recherche Hugging Face |
| Revue périodique | `scripts/review_components.py`, `docs/components/audiocpp-families.json` | nouvelles versions et familles |

Où vivent les choses sur disque : binaires dans `<engines>/audiocpp/<variante>/` (variable `IMAGEGEN_AUDIOCPP_DIR`
pour la changer) ; poids dans le cache Hugging Face, dépôt `audio-cpp/audio.cpp-gguf` (conversions GGUF publiées par
le projet). `IMAGEGEN_AUDIOCPP_TAG` remplace la version épinglée, `IMAGEGEN_AUDIOCPP_VARIANT` force un build.

### Choix du build selon le matériel

La table des builds et l'ordre de préférence sont dans `audiocpp.py` (`ASSETS`, `PREFERENCE`) ; ne pas les recopier
ici. Particularités à connaître : pas de build ROCm amont (AMD passe par Vulkan) ; sous Linux, le seul build CUDA publié
est un build « colab » que l'on n'utilise pas (NVIDIA passe par Vulkan) ; le CPU est le dernier repli, accepté pour
l'audio.

## Mesures (2026-10-13, MacBook M3 Max, Metal, Qwen3-TTS 0.6B Base Q8, texte français)

| Mesure | Valeur |
|---|---|
| Fichier GGUF | 1,99 Go |
| 4,2 s d'audio générées (CLI directe, modèle chargé puis libéré à chaque appel) | 2,4 s de temps mural (1,7× le temps réel) |
| Empreinte mémoire réelle (`phys_footprint`) | 3,1 Go (le RSS annoncé, 4,9 Go, compte des mappages partagés) |
| Via le moteur de l'application, en régime établi | 3,0 s par appel (5 appels, ±0,1 s) pour 4,1 s d'audio, contre 2,9 s en direct par la CLI (dont ≈ 0,8 s de démarrage et de chargement) : **pas de surcoût du moteur** |
| Premier appel d'un binaire fraîchement installé | ≈ 12 s au lieu de 3 s, dont ≈ 10 s avant la génération (initialisation de Metal, une fois par binaire ; `--list-devices` prend à lui seul ≈ 8 s à froid). L'installateur le paie à l'installation, car il appelle cette commande pour vérifier le GPU |
| Mesure isolée de 8,1 s | vue une seule fois, non reproduite ; la machine était alors très chargée (charge moyenne de 5 à 8 à cause d'autres projets). Un même appel est aussi passé de 2,9 s à 5,8 s quand la mémoire libre est tombée à 13 Go |

Le planificateur de mémoire du catalogue (`_pack_plan`) prend 1,6 × la taille des poids + 1,5 Go : cohérent avec la mesure.
La qualité sonore n'a pas été évaluée à l'oreille ; le fichier de test est resté hors du dépôt.

## Limites connues

- **Vulkan, CUDA et CPU n'ont pas été exécutés** : seule la machine Metal a servi. Le README amont dit que CUDA est le
  chemin optimisé et que Vulkan, Metal et HIP servent à la portabilité et aux tests, sans couverture par modèle. À
  valider sur une machine Windows ou Linux avant d'annoncer « tout GPU » sans réserve.
- Un processus par morceau de texte : le modèle est rechargé à chaque appel (mémoire libérée entre deux, mais temps de
  chargement répété). Piste d'optimisation : `audiocpp_server` persistant (options amont `--max-loaded-models`,
  `--idle-unload-ms`, `--min-free-memory-mb` pour borner la mémoire).
- Qwen3-TTS attend le nom de la langue (`french`), pas le code ; la table est dans le moteur.
- Projet jeune (versions 0.x, une publication toutes les deux à quatre semaines) : épinglage strict, pas de « latest ».

## Modèles intégrés

| Modèle | Fichier | Licence | Statut amont |
|---|---|---|---|
| Qwen3-TTS · Clonage 0.6B (GGUF) | `Qwen3-TTS-12Hz-0.6B-Base-GGUF` (Q8_0) | Apache-2.0 | supported ; **testé de bout en bout** |
| Qwen3-TTS · Clonage 1.7B (GGUF) | `Qwen3-TTS-12Hz-1.7B-Base-GGUF` (Q8_0) | Apache-2.0 | supported ; non testé |
| Qwen3-TTS · Voix & style 1.7B (GGUF) | `…-1.7B-CustomVoice-GGUF` (Q8_0) | Apache-2.0 | supported ; **testé de bout en bout** (2026-10-13) : les neuf voix de notre liste répondent, consigne de style acceptée |
| Qwen3-TTS · Création de voix 1.7B (GGUF) | `…-1.7B-VoiceDesign-GGUF` (Q8_0) | Apache-2.0 | supported ; non testé |
| Pocket TTS · FR / EN (GGUF) | `PocketTTS-GGUF/{french,english}/…-q8_0.gguf` (128 Mo chacun) + voix `embeddings/` | CC-BY-4.0 | supported ; **testé de bout en bout** (fr, en, clonage) |
| Chatterbox · Clonage expressif (GGUF) | `Chatterbox-GGUF/chatterbox-q8_0.gguf` (2,09 Go) | MIT | supported ; **testé de bout en bout** (fr, en, de) |

**Qwen3-TTS · Voix & style (voix prédéfinies).** Les noms viennent du modèle lui-même : le GGUF embarque le `config.json` d'origine (`talker_config.spk_id`) avec les neuf voix `serena`, `vivian`, `uncle_fu`, `ryan`, `aiden`, `ono_anna`, `sohee`, `eric` (dialecte du Sichuan) et `dylan` (dialecte de Pékin), c'est-à-dire exactement notre liste. `--voice-id` ignore la casse, et refuse un nom inconnu avec un message clair. Mesuré sur Metal : empreinte 3,6 Go (RSS 5,9 Go), ≈ 2,5× le temps réel. Que la consigne de style change réellement le rendu n'est pas vérifié à l'oreille.

**Qwen3-ASR (transcription)** (Alibaba, Apache-2.0). Mesuré le 2026-10-13 sur Metal avec l'échantillon français de test (3,4 s, texte connu) : texte **exact** avec le 0,6B (Q8, 1,15 Go ; ≈ 10× le temps réel, empreinte 1,6 Go) et avec le 1,7B (Q8, 2,47 Go ; ≈ 8×, empreinte 2,9 Go) ; premier appel à froid ≈ 11 s via l'application. Un seul échantillon facile : **la précision sur des extraits difficiles (accent, bruit) n'est pas mesurée**. La CLI n'a pas d'option `--language` pour l'ASR : l'indice de langue passe par `--request-option language=fr`, et audio.cpp ne le valide pas (une langue invalide est acceptée sans erreur). Le texte n'est qu'une suggestion : l'éditeur de voix permet toujours de le corriger.

**Pocket TTS** (Kyutai). Mesuré le 2026-10-13 : français sur CPU à 6,5× le temps réel, ≈ 0,6 Go ; clonage à 4,4× ; un modèle GGUF par langue, choisi selon la langue de la génération. La fiche amont de la v0.9.1 ne déclare pas le français (seule la branche `main` le fait) mais le binaire v0.9.1 le lit : à revérifier quand une version publiée le déclarera. **Piège corrigé** : audio.cpp résout les liens symboliques ; le cache Hugging Face stocke les fichiers comme liens vers `blobs/`, donc `--voice-id` cherchait les voix au mauvais endroit. Le moteur passe le chemin de la voix (`voice_embedding_path`) à l'intérieur de l'instantané.

**Chatterbox** (Resemble AI). Mesuré le 2026-10-13 sur Metal : 5,1 s d'audio en 5,4 s (≈ 0,95× le temps réel), empreinte mémoire 1,9 Go. Particularités : audio.cpp ne l'expose que comme tâche de **clonage** (`clon`), donc un échantillon de voix est obligatoire (aucune voix intégrée ; la variante Turbo en a une mais n'est qu'en anglais et en « testing ») ; **19 langues** implémentées côté audio.cpp, alors que l'amont annonce 23 (Multilingual V3) ; la langue se choisit à chaque génération ; réglages exposés : expressivité (`exaggeration`), fidélité à la voix (`guidance_scale`, à 0 si l'échantillon n'est pas dans la langue générée, d'après la fiche amont), variabilité. **Filigrane : absent du portage.** L'implémentation d'origine (Resemble AI, Python) applique un filigrane inaudible (Perth) dans `generate()`, après le décodeur et indépendamment des poids ; les 52 fichiers Chatterbox d'audio.cpp (sources, en-têtes, fiche) n'en contiennent aucune trace (vérifié le 2026-10-13 en lisant tous les fichiers, pas seulement par la recherche de code de GitHub). Les sorties ne sont donc **pas** filigranées, et rien ne permet de les reconnaître comme synthétiques : à garder à l'esprit pour un outil de clonage de voix. Non testé empiriquement avec le détecteur Perth.
## Candidats non intégrés (instantané `audiocpp-families.json`, v0.9.1)

Seules les familles à licence permissive et à statut « supported » sont listées comme pistes. Chacune demande ses propres
essais (voix, paramètres, mémoire) avant d'être ajoutée.

**Synthèse vocale**

| Famille | Langues (extrait) | Licence | Remarque |
|---|---|---|---|
| VoxCPM2 | ~30 langues dont le français | Apache-2.0 | clonage et création de voix |
| MOSS-TTS Local / Nano | 31 / 19 langues dont le français | Apache-2.0 | clonage |
| CosyVoice3 | 10 langues dont le français | Apache-2.0 | clonage |
| Magpie TTS | dont le français | NVIDIA Open Model License | usage commercial permis, conditions à lire |
| VibeVoice | en, zh | MIT | longues voix, pas de français |
| Supertonic 3 | ~31 langues | BigScience OpenRAIL-M | restrictions d'usage à répercuter |
| Pocket TTS (de, es, it, pt) | autres langues | CC-BY-4.0 | GGUF disponibles ; seuls fr et en sont intégrés (le néerlandais n'existe pas en GGUF) |
| Kokoro | dont fr-fr | Apache-2.0 | statut « community » |

Écartées pour la licence (recherche ou non commercial) : OmniVoice (CC-BY-NC), Fish Audio, Higgs Audio TTS, IndexTTS2
(conditionnelle).

**Transcription** (limitée aux extraits de voix de référence, voir `transcription.py`) : Qwen3-ASR est intégré. Pistes : Cohere Transcribe (Apache-2.0, 14 langues dont le français, 2,4 Go en Q8, **non testé**), Canary (CC-BY-4.0), Voxtral Realtime (Apache-2.0), Parakeet TDT (CC-BY-4.0, community). Écartée : CrisperWhisper (non commercial).

**Autres usages** (pas de rubrique correspondante dans l'application pour l'instant) : séparation de pistes (HTDemucs, MIT),
musique (ACE-Step, MIT), conversion de voix (Seed-VC : **GPL-3.0**, à examiner avant toute intégration dans une
application MIT), détection de fin de tour (Smart Turn, BSD-2).

## À vérifier à la revue

0. Avant tout : refaire les [tests manuels](audiocpp-tests-manuels.md) si le build ou une famille intégrée change.
1. `scripts/review_components.py` : nouvelle version, familles nouvelles, changements de statut ou de licence.
2. Les notes de version amont : correctifs Vulkan, couverture par modèle, build ROCm, build Linux CUDA non « colab ».
3. Le serveur persistant (`audiocpp_server`) est-il devenu assez stable pour remplacer un processus par morceau ?
4. Un modèle « community » ou « experimental » est-il passé à « supported » (Kokoro, Moonshine) ?
5. Seed-VC : voir « Politique de licences » ci-dessous avant toute intégration.
6. Chatterbox : l'implémentation audio.cpp couvre-t-elle les 23 langues de l'amont, a-t-elle une voix intégrée, a-t-elle ajouté un filigrane ?
   Pocket TTS GGUF français : la fiche de la v0.9.1 ne le déclare pas mais le binaire le lit ; vérifier qu'une version publiée le déclare.
7. Re-mesurer mémoire et vitesse du modèle de référence (tableau ci-dessus) si le build change.
8. Valider Vulkan, CUDA et CPU sur une machine réelle (voir limites) et noter le résultat ici.

## Politique de licences

- **Téléchargement à la demande uniquement, jamais embarqué.** L'application ne redistribue aucun modèle ; les binaires
  d'audio.cpp sont téléchargés depuis les versions officielles. Si les installateurs embarquent un jour ces binaires, vérifier
  d'abord quels modèles le build compile (option `--model-set` amont) : une famille sous copyleft dans le binaire imposerait
  des obligations de redistribution.
- **Seed-VC (conversion de voix) : GPL-3.0** pour le code et les poids (étiquette Hugging Face), dépôt archivé depuis le
  2025-11-21. Décision : si on l'intègre un jour, ce sera en téléchargement à la demande seulement (comme eSpeak-ng), jamais
  embarqué, avec la licence affichée dans le sélecteur de modèles. Alternatives permissives : MeanVC2 (Apache-2.0), OpenVoice V2 (MIT).
  Aucune intégration n'est faite à ce jour.
- Les licences de chaque famille proviennent de `docs/model_licenses.md` d'audio.cpp (copie dans l'instantané JSON) ; la
  licence qui fait foi est celle du dépôt d'origine du modèle.
