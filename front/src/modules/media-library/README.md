# Module `media-library` (front)

## Role

The **media library** on the browser side: access to assets (`assetsApi`), the **generic gallery** (filters, cursor pagination,
states, live update), the **lightbox list** (`useLightboxStore`), the **file drop** layer and the drop rules of the audio
and video modes. The image gallery is built here (route `/galerie`); the audio and video libraries (H4.5, H4.6) reuse `AssetGallery` with their
own tiles. Back: `back/src/modules/media-library/README.md` (`GET/POST/PATCH/DELETE /api/assets`, events `studio.asset.*`). Task H4.4.

Lower layer: `studio-core` depends on it (types, API, lightbox list), never the reverse (same direction as on the back). The image tile (favourite, reference, download) is
the one of `studio-core`: it is `image-studio` (`ImageGallery`) that assembles gallery and tile.

## Structure

```
media-library/
  index.ts                       exports
  types.ts                       Asset, AssetMedia, AssetPage, AssetListQuery (studio-core re-exports them)
  services/assetsApi.ts          list (kind=generated, media, favorites, q, before, limit), upload (multipart, progress), setFavorite, remove
  lib/assetKeys.ts               query keys: ['assets'] (family invalidated by events), recent(media), list(media, favorites, q)
  lib/assetCache.ts              pure logic: patchAssetInData, removeAssetFromData (single page or infinite list), flattenPages (without duplicates) (tested)
  lib/gallery.ts                 pure logic: cursor, counter "60+", displayed state, key of the empty message, columns per media (tested)
  lib/dropRules.ts               pure logic: accepted types and sorting of a drop in audio / video mode (tested)
  hooks/useAssetPages.ts         infinite list of a media (key list, staleTime 0), flattened, with fetchMore / retry
  hooks/useDebouncedValue.ts     search: 250 ms after the last keystroke
  hooks/useEndlessScroll.ts      sentinel (IntersectionObserver, 600 px margin) to read the next page
  state/lightboxStore.ts         list and position of the lightbox (Zustand): show, close, setIndex, patch, drop (tested)
  components/AssetGallery.tsx    the gallery: header, columns, states, sentinel; the tiles come from `renderTile(asset, index, open)`
  components/GalleryHeader.tsx   title, counter, text filter, Favourites button (texts library.<media>.*)
  components/DropVeil.tsx        "Déposez…" (Drop…) overlay (image-studio, audio and video put their texts in it)
  components/VideoPosterTile.tsx clip tile on `VideoPoster` of `common` (used by the video library of `video-studio`, H4.6)
  locales/                       locales.fr.json, locales.en.json (keys library.*)
```

## Public API

`AssetGallery({ media, renderTile })`, `GalleryHeader`, `DropVeil`, `VideoPosterTile`, `useAssetPages`, `useDebouncedValue`, `useEndlessScroll`, `assetsApi`, `assetKeys`,
`useLightboxStore`, `patchAssetInData` / `removeAssetFromData` / `flattenPages`, `classifyDrop` / `AUDIO_ACCEPT` / `VIDEO_ACCEPT`, `galleryState` / `emptyKey` / `countText` /
`GALLERY_COLUMNS`, types.

**Used by H4.5 and H4.6**: `<AssetGallery media="audio" renderTile={…} />` (`audio-studio`) and `media="video"` with `VideoPosterTile` + the clip buttons as `overlay` (`video-studio/components/VideoGallery`); the texts `library.audio.*` and `library.video.*`
(title `Bibliothèque` (library), counters `prises` (takes) / `clips`, filters, empty messages) and the drop texts `library.drop.audio.*` / `library.drop.video.*` are already there, as well as the columns
(`GALLERY_COLUMNS`, 1 column for audio: the cards stack, up to you to centre them in `renderTile`). Drop: `classifyDrop(mode, files)` returns the files to keep and the key of the
warning; the drop itself is plugged in with `useWindowDrop` (`common`) and `DropVeil`, as `image-studio/hooks/useImageDrop.ts` does.

## Data and real time

- **List**: `useInfiniteQuery` key `['assets','list',media,favorites,q]`, 60 items per page, cursor `next_before` from the server (most recent first), `staleTime: 0`: a list left
  in cache is reread when the page is opened (new images, favourites changed elsewhere). The search (`q`) is done by the server (prompt or conversation title).
- **Events** (applied by `useStudioEvents` of `studio-core`, mounted by the shell): `studio.asset.updated` replaces the asset in all lists (single page or infinite list), the conversation in
  cache and the lightbox; `studio.asset.deleted` removes it from the lists and the lightbox (which closes if it was the last one), rereads the conversation; `studio.job.image` and `studio.conversation.deleted`
  reread the lists. A favourite removed in the "Favourites" view stays there until the next load (as before).
- **Lightbox**: `StudioLightbox` (`studio-core` module, mounted by the shell) reads `useLightboxStore`; `AssetGallery` opens it on **all loaded assets** (pages already read), so ← → go through what is loaded.
  Deletion (with confirmation) and "Open the conversation" are in the lightbox's details panel.

## Parity with the former interface (`Gallery.tsx`, `Lightbox.tsx`, drop of `App.tsx`)

Ticked boxes = checked by the tested logic and the server-side rendering (`components/render.smoke.spec.ts`); **the visual rendering remains to be validated by eye** (list at the end of the file).

**Image gallery**
- [x] Title `Galerie` (gallery), counter `N tirages` (N prints) with "+" as long as pages remain (`countText`).
- [x] Filter `Filtrer par prompt` (filter by prompt), 250 ms after the last keystroke (`SEARCH_DELAY_MS`), server side.
- [x] Toggle button `Favoris` (highlighted when active, `aria-pressed`), filled/empty heart.
- [x] Loading: centred indicator; empty: `Aucun favori pour l'instant — utilisez ♥ sur une image.` (no favourite yet — use ♥ on an image) (favourites), `Aucun résultat.` (no result) (search), `Aucune image générée pour l'instant.` (no image generated yet) (same priority order, `emptyKey`).
- [x] Columns 2 / 3 / 4 / 5 depending on width (MUI breakpoints: sm 600, md 900, lg 1200, xl 1536 instead of Tailwind's), tiles at the real ratio (1 if dimensions are unknown), do not break across columns.
- [x] Tile: thumbnail loaded on demand, click = lightbox (magnifier cursor), prompt on 2 lines that expands on hover.
- [x] Tile actions on hover (same as in the thread: `TileActions`): favourite at the top left (stays visible when active), use as reference / download / enlarge at the top right, seed at the bottom left; tooltips `Ajouter aux favoris` / `Retirer des favoris` (add to / remove from favourites), `Utiliser comme référence` (use as reference), `Télécharger` (download), `Agrandir` (enlarge).
- [x] Infinite pagination: the next page is read 600 px before the end (`PREFETCH_MARGIN`), indicator at the bottom during reading.
- [x] Live update (new image, favourite, deletion, deleted conversation).

**Lightbox on the gallery side** (common component `Lightbox`, see `studio-core`)
- [x] Opening on the clicked image, ← → and thumbnail index over the loaded images, counter, Escape, zoom on click.
- [x] Actions: use as reference, favourite (`F`), download, details panel (`I`): copyable prompt, model, file, size, seed copyable with tooltip, steps, guidance, influence, duration, date.
- [x] Open the conversation (closes the lightbox, goes to `/c/:id`); delete the image with confirmation (the lightbox removes the image and closes if there is none left).

**Global drop** (`App.tsx` `useFileDrop`)
- [x] Image: files dropped anywhere (including on `/galerie`) = references of the next message (images only, the others ignored with a warning), images of the conversation dragged likewise; overlay `Déposez vos images` (drop your images). (Done in H4.3b; the overlay now goes through `DropVeil`.)
- [x] Audio and video: accepted types, sorting of the drop (audio: the first sound file; video: images and videos), warnings and overlay texts (`dropRules.ts`, locales `library.drop.*`) ready; **the wiring of voices is done in H4.5 (`voices/hooks/useVoiceDrop.ts`, which receives everything and sorts with `classifyDrop`), the one of the video source remains to be done in H4.6**.

**Position in the queue** (deviation from H4.3b, handled here with `studio-core`)
- [x] Exact `en file d'attente · position N` (queued · position N) (all conversations and all modes), exact `N en attente` (N waiting) on the engine card: see the README of `studio-core`.

**Voluntary additions or deviations** (not present before): error message with `Réessayer` (retry) if the first page fails; list reread at each opening (`staleTime: 0`); `srcset` (thumbnail, full file for large screens);
complete English. Not taken over: the lightbox zoom follows the common component (click on the image).

**To validate visually**: rendering of the columns and tiles (ratio, corners, shadow), hover overlay (prompt and buttons do not get in each other's way: the seed and the prompt share the bottom of the tile), header (width of the search field, active Favourites button),
header offset when the side panel is hidden, scrolling and page loading behaviour, lightbox (index, panel, deletion), drop overlay on the gallery.

## Tests

One file at a time, from `front/`, under the memory guard:

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/media-library/lib/assetCache.spec.ts
```

`lib/{assetCache,gallery,dropRules}.spec.ts`, `services/assetsApi.spec.ts`, `state/lightboxStore.spec.ts`, `locales/locales.spec.ts`, `components/render.smoke.spec.ts` (server-side rendering: full and empty image gallery, video library
with `VideoPosterTile`, empty audio library, overlay; no DOM: interactions are not exercised).
