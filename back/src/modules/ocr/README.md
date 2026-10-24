# `ocr` (back)

## Rôle

Les lectures de l'onglet OCR : un fichier (image ou PDF), un modèle d'OCR, une tâche → le texte de chaque page. Une lecture est **gardée**
(lignes `ocr_documents` et `ocr_pages`, fichier source dans `<data>/ocr/<id>/`) et exécutée **en arrière-plan** : la création répond tout
de suite (`queued`), la progression et les pages arrivent par l'événement `studio.ocr.updated`. Le moteur lit et nettoie le texte
(`engine/app/ocr.py`, route `POST /engine/v1/ocr/read`) ; ce module possède ce qui est conservé et ce que voit le navigateur.

Ce n'est **pas** une conversation : pas de passage par `studio-core` (ni file de générations, ni messages, ni assets), car le moteur lit des
PDF que la bibliothèque média ne sait pas ingérer. Les deux ne partagent que la jauge d'occupation du moteur.

## Architecture

| Élément | Rôle |
|---|---|
| `OcrController` | `/api/ocr/*` (voir ci-dessous) |
| `OcrService` | Création (validation du fichier, du modèle prêt, de la tâche), relance, annulation, suppression (lignes + dossier), export, reprise au démarrage (`running` → `failed`, `queued` repris) |
| `OcrQueueService` | Une lecture à la fois ; attend que la file de générations soit libre et prend `EngineBusyGate` (propriétaire `'ocr'`) pour toute la lecture ; réveillée à la libération de la jauge ; écrit page par page (une lecture interrompue garde ses pages) |
| `EngineOcrClient` | Flux SSE de `POST /engine/v1/ocr/read` (`fetch` propre : pas de délai, annulable par `AbortSignal`) |
| `OcrStoreService` | Tables ; recherche sur le titre et le texte des pages |
| `OcrDocumentEntity`, `OcrPageEntity` | Tables `ocr_documents`, `ocr_pages` (clé `document_id` + `page_index`, suppression en cascade) ; migration `1792831506395-OcrTables.ts` |
| `lib/pageSpec.ts` | « 1-3, 5 » → pages (1 à partir de 1, 300 au plus) |
| `lib/exportText.ts` | Export `txt`, `md`, `json` et nom de fichier sûr |

## Dépendances

`MediaLibraryModule` (`StudioEvents`, `studioDataDir`, `AssetService` pour « extraire le texte » d'une image de la bibliothèque, `uploadStorage`), `StudioCoreModule` (`EngineBusyGate`, `GenerationQueueService.occupied` / `idle$`), `ModelCatalogModule` (modèle d'OCR prêt, tâches offertes), `engine` (global : `EngineClient`, `SseParser`).

## Endpoints exposés (exhaustif)

Tous **administrateur**, JSON simple (`NoTransportCrypt`).

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/ocr/documents?q=` | Lectures, les plus récentes d'abord ; `q` cherche dans le titre et le texte des pages |
| `POST` | `/api/ocr/documents` | Multipart `file` (image ou PDF, 200 Mo au plus) **ou** `asset_id` (image de la bibliothèque), plus `model_id`, `task`, `prompt`, `pages` (« 1-3, 5 »). Répond la lecture `queued`. 409 modèle absent ou non téléchargé, moteur absent ; 404 modèle inconnu ; 422 format, tâche non offerte, consigne vide, pages mal écrites |
| `GET` | `/api/ocr/documents/:id` | Lecture et pages lues |
| `POST` | `/api/ocr/documents/:id/cancel` | Annule (en attente : tout de suite ; en cours : le moteur s'arrête, les pages lues restent). 409 si elle n'est plus en cours |
| `POST` | `/api/ocr/documents/:id/retry` | Relance (modèle, tâche, consigne, pages au choix ; `force_memory` : continuer malgré le refus `error_code: memory` du contrôle de mémoire libre, après confirmation) ; vide les pages. 409 si elle court encore |
| `DELETE` | `/api/ocr/documents/:id` | Supprime lignes et dossier |
| `GET` | `/api/ocr/documents/:id/export?format=txt\|md\|json` | Téléchargement du texte |
| `GET` | `/api/ocr/documents/:id/source` | Le fichier d'origine (aperçu) |

Événements : `studio.ocr.updated` (la lecture, résumé), `studio.ocr.deleted` (`{id}`), publiés par `StudioEvents`.

## Entités

`OcrDocumentEntity` : titre, fichier source, type (`image`/`pdf`), pages du document, pages demandées (JSON), modèle (id et nom), tâche, consigne, état (`queued`, `running`, `done`, `failed`, `cancelled`), erreur, pages lues et à lire. `OcrPageEntity` : texte, `truncated` (le modèle a atteint sa longueur maximale), jetons.

## Tests

`npx jest --runInBand src/modules/ocr` : service et file avec un faux moteur (lecture d'un PDF, échec, refus avant flux, attente de la jauge, annulation en cours et en attente, relance, suppression, recherche, export, reprise au démarrage), utilitaires purs. Aucun vrai modèle.
