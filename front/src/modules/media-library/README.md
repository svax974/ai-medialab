# Module `media-library` (front)

## Rôle

La **bibliothèque de médias** côté navigateur : l'accès aux assets (`assetsApi`), la **galerie générique** (filtres, pagination par curseur,
états, mise à jour en direct), la **liste de la visionneuse** (`useLightboxStore`), la surcouche de **dépôt de fichiers** et les règles de dépôt des modes
audio et vidéo. La galerie d'images est faite ici (route `/galerie`) ; les bibliothèques audio et vidéo (H4.5, H4.6) réutilisent `AssetGallery` avec leurs
propres tuiles. Back : `back/src/modules/media-library/README.md` (`GET/POST/PATCH/DELETE /api/assets`, événements `studio.asset.*`). Tâche H4.4.

Couche basse : `studio-core` en dépend (types, API, liste de la visionneuse), jamais l'inverse (même sens qu'au back). La tuile d'image (favori, référence, téléchargement) est
celle de `studio-core` : c'est `image-studio` (`ImageGallery`) qui assemble galerie et tuile.

## Structure

```
media-library/
  index.ts                       exports
  types.ts                       Asset, AssetMedia, AssetPage, AssetListQuery (studio-core les réexporte)
  services/assetsApi.ts          list (kind=generated, media, favorites, q, before, limit), upload (multipart, progression), setFavorite, remove
  lib/assetKeys.ts               clés de requête : ['assets'] (famille invalidée par les événements), recent(media), list(media, favorites, q)
  lib/assetCache.ts              logique pure : patchAssetInData, removeAssetFromData (page seule ou liste infinie), flattenPages (sans doublon) (testé)
  lib/gallery.ts                 logique pure : curseur, compteur « 60+ », état affiché, clé du message vide, colonnes par média (testé)
  lib/dropRules.ts               logique pure : types acceptés et tri d'un dépôt en mode audio / vidéo (testé)
  hooks/useAssetPages.ts         liste infinie d'un média (clé list, staleTime 0), aplatie, avec fetchMore / retry
  hooks/useDebouncedValue.ts     recherche : 250 ms après la dernière frappe
  hooks/useEndlessScroll.ts      sentinelle (IntersectionObserver, marge 600 px) pour lire la page suivante
  state/lightboxStore.ts         liste et position de la visionneuse (Zustand) : show, close, setIndex, patch, drop (testé)
  components/AssetGallery.tsx    la galerie : en-tête, colonnes, états, sentinelle ; les tuiles viennent de `renderTile(asset, index, open)`
  components/GalleryHeader.tsx   titre, compteur, filtre texte, bouton Favoris (textes library.<media>.*)
  components/DropVeil.tsx        surcouche « Déposez… » (image-studio, audio et vidéo y mettent leurs textes)
  components/VideoPosterTile.tsx tuile de clip sur `VideoPoster` de `common` (pour H4.6)
  locales/                       locales.fr.json, locales.en.json (clés library.*)
```

## API publique

`AssetGallery({ media, renderTile })`, `GalleryHeader`, `DropVeil`, `VideoPosterTile`, `useAssetPages`, `useDebouncedValue`, `useEndlessScroll`, `assetsApi`, `assetKeys`,
`useLightboxStore`, `patchAssetInData` / `removeAssetFromData` / `flattenPages`, `classifyDrop` / `AUDIO_ACCEPT` / `VIDEO_ACCEPT`, `galleryState` / `emptyKey` / `countText` /
`GALLERY_COLUMNS`, types.

**Pour H4.5 et H4.6** : `<AssetGallery media="audio" renderTile={…} />` (ou `video`, avec `VideoPosterTile` + les boutons de la vidéo en `overlay`) ; les textes `library.audio.*` et `library.video.*`
(titre « Bibliothèque », compteurs « prises » / « clips », filtres, messages vides) et les textes de dépôt `library.drop.audio.*` / `library.drop.video.*` sont déjà là, ainsi que les colonnes
(`GALLERY_COLUMNS`, 1 colonne pour l'audio : les cartes s'empilent, à vous de les centrer dans `renderTile`). Dépôt : `classifyDrop(mode, files)` renvoie les fichiers à garder et la clé de
l'avertissement ; le dépôt lui-même se branche avec `useWindowDrop` (`common`) et `DropVeil`, comme `image-studio/hooks/useImageDrop.ts`.

## Données et temps réel

- **Liste** : `useInfiniteQuery` clé `['assets','list',media,favorites,q]`, 60 éléments par page, curseur `next_before` du serveur (plus récents d'abord), `staleTime: 0` : une liste restée
  en cache est relue à l'ouverture de la page (nouvelles images, favoris changés ailleurs). La recherche (`q`) est faite par le serveur (prompt ou titre de conversation).
- **Événements** (appliqués par `useStudioEvents` de `studio-core`, monté par la coquille) : `studio.asset.updated` remplace l'asset dans toutes les listes (page seule ou liste infinie), la conversation en
  cache et la visionneuse ; `studio.asset.deleted` le retire des listes et de la visionneuse (qui se ferme si c'était le dernier), relit la conversation ; `studio.job.image` et `studio.conversation.deleted`
  relisent les listes. Un favori retiré dans la vue « Favoris » y reste jusqu'au prochain chargement (comme avant).
- **Visionneuse** : `StudioLightbox` (module `studio-core`, monté par la coquille) lit `useLightboxStore` ; `AssetGallery` l'ouvre sur **tous les assets chargés** (pages déjà lues), donc ← → parcourent ce qui est chargé.
  La suppression (avec confirmation) et « Ouvrir la conversation » sont dans le panneau de détails de la visionneuse.

## Parité avec l'ancienne interface (`Gallery.tsx`, `Lightbox.tsx`, dépôt de `App.tsx`)

Cases cochées = vérifiées par la logique testée et le rendu côté serveur (`components/render.smoke.spec.ts`) ; **le rendu visuel reste à valider à l'œil** (liste en fin de fichier).

**Galerie d'images**
- [x] Titre « Galerie », compteur « N tirages » avec « + » tant qu'il reste des pages (`countText`).
- [x] Filtre « Filtrer par prompt », 250 ms après la dernière frappe (`SEARCH_DELAY_MS`), côté serveur.
- [x] Bouton « Favoris » à bascule (surligné quand actif, `aria-pressed`), cœur plein/vide.
- [x] Chargement : indicateur centré ; vide : « Aucun favori pour l'instant — utilisez ♥ sur une image. » (favoris), « Aucun résultat. » (recherche), « Aucune image générée pour l'instant. » (même ordre de priorité, `emptyKey`).
- [x] Colonnes 2 / 3 / 4 / 5 selon la largeur (points de rupture MUI : sm 600, md 900, lg 1200, xl 1536 au lieu de ceux de Tailwind), tuiles au ratio réel (1 si dimensions inconnues), ne se coupent pas entre colonnes.
- [x] Tuile : miniature chargée à la demande, clic = visionneuse (curseur loupe), prompt sur 2 lignes qui monte au survol.
- [x] Actions de tuile au survol (mêmes que dans le fil : `TileActions`) : favori en haut à gauche (reste visible s'il est actif), utiliser comme référence / télécharger / agrandir en haut à droite, graine en bas à gauche ; info-bulles « Ajouter aux favoris » / « Retirer des favoris », « Utiliser comme référence », « Télécharger », « Agrandir ».
- [x] Pagination infinie : la page suivante est lue 600 px avant la fin (`PREFETCH_MARGIN`), indicateur en bas pendant la lecture.
- [x] Mise à jour en direct (nouvelle image, favori, suppression, conversation supprimée).

**Visionneuse côté galerie** (composant commun `Lightbox`, voir `studio-core`)
- [x] Ouverture sur l'image cliquée, ← → et index de vignettes sur les images chargées, compteur, Échap, zoom au clic.
- [x] Actions : utiliser comme référence, favori (`F`), télécharger, panneau de détails (`I`) : prompt copiable, modèle, fichier, taille, graine copiable avec info-bulle, étapes, guidance, influence, durée, date.
- [x] Ouvrir la conversation (ferme la visionneuse, va à `/c/:id`) ; supprimer l'image avec confirmation (la visionneuse retire l'image et se ferme s'il n'y en a plus).

**Dépôt global** (`App.tsx` `useFileDrop`)
- [x] Image : fichiers déposés n'importe où (y compris sur `/galerie`) = références du prochain message (images seulement, les autres ignorés avec un avertissement), images de la conversation glissées idem ; surcouche « Déposez vos images ». (Fait en H4.3b ; la surcouche passe maintenant par `DropVeil`.)
- [x] Audio et vidéo : types acceptés, tri du dépôt (audio : le premier fichier sonore ; vidéo : images et vidéos), avertissements et textes de la surcouche (`dropRules.ts`, locales `library.drop.*`) prêts ; **le branchement (voix, source vidéo) est dans H4.5 et H4.6**.

**Position dans la file** (écart de H4.3b, traité ici avec `studio-core`)
- [x] « en file d'attente · position N » exact (toutes conversations et tous modes), « N en attente » de la carte du moteur exact : voir le README de `studio-core`.

**Ajouts ou écarts volontaires** (non présents avant) : message d'erreur avec « Réessayer » si la première page échoue ; liste relue à chaque ouverture (`staleTime: 0`) ; `srcset` (miniature, fichier complet pour les grands écrans) ;
anglais complet. Non repris : le zoom de la visionneuse suit le composant commun (clic sur l'image).

**À valider visuellement** : rendu des colonnes et des tuiles (ratio, coins, ombre), surcouche de survol (prompt et boutons ne se gênent pas : la graine et le prompt partagent le bas de la tuile), en-tête (largeur du champ de recherche, bouton Favoris actif),
décalage de l'en-tête quand le panneau latéral est masqué, comportement du défilement et du chargement de page, visionneuse (index, panneau, suppression), surcouche de dépôt sur la galerie.

## Tests

Un fichier à la fois, depuis `front/`, sous garde mémoire :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/media-library/lib/assetCache.spec.ts
```

`lib/{assetCache,gallery,dropRules}.spec.ts`, `services/assetsApi.spec.ts`, `state/lightboxStore.spec.ts`, `locales/locales.spec.ts`, `components/render.smoke.spec.ts` (rendu côté serveur : galerie d'images pleine et vide, bibliothèque
vidéo avec `VideoPosterTile`, bibliothèque audio vide, surcouche ; pas de DOM : les interactions ne sont pas exercées).
