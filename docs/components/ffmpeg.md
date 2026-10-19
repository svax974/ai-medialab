# FFmpeg (via PyAV) : quel build, quelle licence ?

*Dernière vérification contre les sources : 2026-10-17 (roue PyAV 19.0.1 macOS arm64 installée dans `engine/.venv`, pages
amont citées plus bas ; le pack `ffmpeg` n'a pas été installé en vrai : seuls ses tests unitaires ont tourné).* Registre et procédure de revue : [README.md](README.md).

## Ce que l'application fait avec FFmpeg

Aucun exécutable `ffmpeg` n'est appelé : tout passe par **PyAV** (`av`, extra `ffmpeg` de `engine/pyproject.toml`, installé par le pack
`ffmpeg` : voir la décision), dont les roues embarquent les bibliothèques FFmpeg (`libavcodec`, `libavformat`…) en bibliothèques partagées.

| Usage | Où | Codecs |
|---|---|---|
| Écrire les clips générés en MP4 lisible par le navigateur | `encode_mp4` (`engine/app/media.py`), `write_mp4` (`engine/video_runtime/common.py`) | encodeur **H.264** (`yuv420p`, `+faststart`) ; piste **AAC** (encodeur natif de FFmpeg) |
| Lire une vidéo envoyée, vignette, sondage | `read_frames`, `read_video_with_audio`, `probe_video`, `video_thumb` (`media.py`), `read_frames_at`, `probe` (`common.py`) | décodeurs natifs (H.264, HEVC, VP8/9, AAC, Opus, MP3, PCM…), AV1 via dav1d |
| Démuxer le `.webm` de `sd-cli` (LTX avec son : VP8 + PCM) et le réencoder | `engine/app/engines/sdcpp_video_engine.py` | décodage VP8, puis `encode_mp4` |

Hors FFmpeg : les voix et l'audio passent par libsndfile (`soundfile`) ; `sd-cli` (stable-diffusion.cpp) n'est lié à aucune
bibliothèque FFmpeg (`otool -L`). Les packs vidéo Kiwi-Edit et Bernini installent leur propre `av` (et `imageio-ffmpeg` pour
Bernini) depuis PyPI, **sur la machine de l'utilisateur** et à sa demande (`engine/app/audio_packs.py`) : l'application ne les
redistribue pas ; la licence du FFmpeg d'`imageio-ffmpeg` n'a pas été vérifiée.

Le seul encodeur dont la licence pose question est donc l'encodeur **H.264** ; l'AAC natif et tous les décodeurs utiles sont
LGPL.

## Constat : la roue PyPI de PyAV est en pratique un build GPL

Lu dans `engine/.venv/.../av/.dylibs/` (PyAV 19.0.1, macOS arm64) :

- la ligne `configure` de `libavcodec` porte `--enable-version3` sans `--enable-gpl` et la bibliothèque s'annonce « LGPL
  version 3 or later » ;
- mais elle est liée (`otool -L`) à **`libx264`** (1,5 Mo) et **`libx265`** (6,6 Mo), toutes deux GPL-2.0-or-later, livrées dans
  la roue. Le dépôt qui produit ces builds, [pyav-ffmpeg](https://github.com/PyAV-Org/pyav-ffmpeg), liste x264 et x265 pour toutes
  les plateformes et ne publie pas de variante LGPL ;
- le reste est permissif ou LGPL (lame, opus, vpx, dav1d, webp, vmaf, SVT-AV1).

Selon [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html), dès que des parties GPL sont utilisées « the GPL applies to all of
FFmpeg », et la liste de conformité LGPL exige de compiler sans `--enable-gpl` / `--enable-nonfree` et de vérifier qu'aucune
bibliothèque GPL comme libx264 n'est utilisée. Une application de bureau qui embarque cette roue telle quelle distribue donc du
code GPL (source correspondante de FFmpeg, x264 et x265 à fournir). La licence MIT de l'application reste compatible, mais les
obligations sont plus lourdes que nécessaire, pour deux bibliothèques dont on peut se passer.

## Décision

1. **PyAV n'est pas dans l'installateur.** Le pack `ffmpeg` (`PACKS['ffmpeg']`, `engine/app/audio_packs.py`, famille `runtime`, ≈ 50 Mo) installe
   `av` sur la machine de l'utilisateur, depuis PyPI, avec le premier modèle vidéo (`engine/app/components.py` : tout modèle `kind == "video"`
   l'exige). L'application ne redistribue donc pas la roue (ni x264/x265) : même position que pour les packs Kiwi-Edit et Bernini. Son
   `site-packages` est ajouté à `sys.path` par `media.load_av` (serveur) et par `activate_overlays` (worker). Sans lui, l'envoi d'une vidéo
   répond 409 avec un message qui renvoie à l'installation. Ce n'est pas un avis juridique ; les brevets H.264 / AAC ne sont pas traités.
2. **Encodeur H.264 choisi à l'exécution, sans dépendre de libx264.** `H264_ENCODERS` (`engine/app/media.py`, copie dans
   `engine/video_runtime/common.py`) essaie, dans l'ordre, `h264_videotoolbox` (encodeur matériel d'Apple, bibliothèque système :
   compatible LGPL), `libopenh264` (OpenH264 de Cisco, BSD-2-Clause) puis `libx264` en dernier recours ; le premier qui s'ouvre à la
   taille demandée gagne. Débit : réglage dans `_h264_settings` (x264 garde son CRF). Vérifié sur Mac Apple Silicon avec la roue de
   développement : VideoToolbox est retenu, le MP4 produit est en H.264. Sous Windows et Linux, `pyav-ffmpeg` liste x264 pour toutes les plateformes ; la présence d'un encodeur matériel ou d'OpenH264 dans ces roues n'est pas vérifiée, `libx264` sert alors.
3. **Développement** : `uv sync --extra ffmpeg` (`scripts-local/dev-services.sh` le fait). Rien n'est distribué.
4. **Option non retenue pour l'instant, un installateur hors ligne ou une licence LGPL stricte** : embarquer un **FFmpeg LGPL en
   bibliothèques partagées** (sans `--enable-gpl`, sans `--enable-nonfree`, sans x264 ni x265) et un PyAV compilé contre lui
   (`pip install av --no-binary av` avec `pkg-config`, voir la [doc d'installation de PyAV](https://pyav.basswood.io/docs/stable/overview/installation.html) ;
   FFmpeg à la version majeure attendue par le PyAV épinglé).
   - **macOS** : `--enable-videotoolbox --enable-audiotoolbox`, plus libopus, libvpx, libdav1d (BSD). Il n'existe pas
     de build LGPL macOS prêt à l'emploi chez [BtbN](https://github.com/BtbN/FFmpeg-Builds) (Windows et Linux seulement) : à
     compiler (script `scripts/build-deps` de PyAV adapté, ou configure à la main).
   - **Linux, Windows** : partir des variantes `lgpl-shared` de BtbN (sans x264/x265). Il faut un encodeur H.264 de la liste :
     `libopenh264` s'il est compilé dedans (à vérifier), sinon l'ajouter. Brevets : la licence de brevets de Cisco ne couvre que
     les binaires OpenH264 **téléchargés depuis Cisco**, pas une copie compilée et embarquée par nous. Sous Windows, `h264_mf`
     (Media Foundation) serait une alternative à ajouter à la liste, non testée.
   - `scripts-local/build_runtime.py` (`report_ffmpeg_license`) **avertit** quand le runtime assemblé contient libx264 / libx265 (un
     profil qui réembarquerait `av`) : un tel installateur ne se publie pas sans la source correspondante.

## Obligations si le build LGPL (option 4) est embarqué

D'après la liste de [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html) :

- liaison dynamique (déjà le cas : `.dylib` / `.so` / `.dll` séparées), noms de bibliothèques non maquillés ;
- fournir la **source exacte** de FFmpeg utilisée (archive hébergée à côté de l'installateur), la ligne `configure` et le diff
  éventuel ; idem pour chaque bibliothèque LGPL ajoutée (p. ex. lame) ;
- mention de FFmpeg et de la LGPL dans la fenêtre « À propos » et sur la page de téléchargement ; une éventuelle licence
  utilisateur ne doit ni interdire l'ingénierie inverse ni revendiquer FFmpeg ;
- conserver les notices BSD des bibliothèques permissives (opus, vpx, dav1d, OpenH264).

Ce document n'a pas valeur de conseil juridique (brevets H.264 / AAC compris).

## Prochaines étapes

1. Installer le pack `ffmpeg` en vrai sur Mac, Windows et Linux (non fait) : vérifier que `av` se charge depuis l'overlay (bibliothèques
   `av/.dylibs`, `av.libs` ou DLL à côté du module) dans le serveur et dans le worker, et que `h264_encoder` retient l'encodeur attendu.
2. Mentionner FFmpeg et son téléchargement dans la fenêtre « À propos » et dans les notes de version.
3. Si un installateur hors ligne ou une licence LGPL stricte devient nécessaire : option 4 ci-dessus (compiler FFmpeg LGPL et PyAV, source jointe).

## À vérifier à la revue

- Le contenu de `av/.dylibs` (ou `av.libs`) après une montée de version de PyAV, et la ligne `configure` de `libavcodec`.
- Si PyAV ou pyav-ffmpeg publient un jour une variante LGPL de leurs roues, le pack `ffmpeg` l'installerait à la place (changer `requirements`).
