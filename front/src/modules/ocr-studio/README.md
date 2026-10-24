# `ocr-studio` (front)

## Rôle

L'onglet **OCR** (`/ocr`, `/ocr/:id`) : lire le texte d'une image ou d'un PDF avec un modèle d'OCR local. Mode `ocr` du shell, qui n'est pas une conversation (`ConversationMode` l'exclut) : la liste de la barre latérale est celle des lectures (`OcrSidebarList`).

## Structure

| Dossier | Contenu |
|---|---|
| `components/` | `OcrPage` (route), `OcrHome` (accueil + carte de premier lancement), `OcrComposer` (dépôt du fichier, tâche, pages, consigne libre, sélecteur de modèle), `OcrModelCard` (points forts et points faibles du modèle), `OcrResult` (état, progression, original à côté du texte, onglets de pages, copier, exporter, relancer, annuler, supprimer), `OcrSidebarList`, `ExtractTextAction` (bouton « Extraire le texte » de la visionneuse, pour une image de la bibliothèque) |
| `hooks/useOcr.ts` | Requêtes, actions, abonnement aux événements `studio.ocr.*` (cache mis à jour, pages relues au fil de la lecture) |
| `lib/ocrRules.ts` | Format accepté, tâches d'un modèle, état du bouton d'envoi, progression, texte joint |
| `services/ocrApi.ts` | Appels HTTP |

## Services

| Méthode | Endpoint | Description |
|---|---|---|
| `list(q)` | `GET /api/ocr/documents` | Lectures |
| `get(id)` | `GET /api/ocr/documents/:id` | Lecture et pages |
| `create(request)` | `POST /api/ocr/documents` | Fichier ou `asset_id`, modèle, tâche, consigne, pages |
| `cancel(id)`, `retry(id, change)`, `remove(id)` | `POST …/cancel`, `POST …/retry`, `DELETE …` | Actions |
| `exportUrl(id, format)`, `sourceUrl(id)` | `GET …/export`, `GET …/source` | Téléchargement du texte, aperçu de l'original |

## Composants hors du module

`model-catalog` : type `ocr` (onglet « Modèles d'OCR », recherche Hugging Face, `useActiveModel('ocr')`) ; `engines` : carte llama.cpp ; `studio-shell` : mode, routes `/ocr`, liste ; `studio-core` : `StudioLightbox` reçoit `imageActions` (le bouton d'extraction).

## Dépendances

`model-catalog`, `engines` (`WelcomeSetup`, `SetupPrompt`), `studio-core` (`StudioModelPicker`), `studio-shell` (routes, `studioHttp`, `useT`), `media-library` (lightbox).

## Limites

Non vérifié avec un vrai modèle ni dans un navigateur. La commande `/ocr` du chat n'est pas faite.
