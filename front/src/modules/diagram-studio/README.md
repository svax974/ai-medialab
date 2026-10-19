# `diagram-studio` (front)

## Rôle

Onglet « Diagrammes » : organigrammes, flowcharts, séquences, architectures, états, cartes mentales. Même mécanique
que les autres studios (page d'accueil, composeur, sélection de modèle, téléchargement à la sélection, fil de
conversation, galerie, export) mais sans job de génération : une génération est un appel ponctuel au LLM local
(`POST /api/diagrams/generate`), suivi d'un rendu Mermaid → SVG → PNG **côté front**, puis d'un envoi du PNG
(`POST /api/diagrams/messages/:id/render`) qui l'attache au message comme un asset généré classique — d'où sa
présence dans la galerie, le fil et le téléchargement exactement comme une image.

## Structure

```
components/  DiagramHome, Composer, DiagramTypePicker, ThemePicker
hooks/       useSendDiagram (génère → rend → attache, une seule action du point de vue du composeur)
lib/         composerRules (pur, testé), mermaidThemes, renderDiagram (Mermaid → SVG → PNG, client-side), suggestions
services/    diagramsApi
state/       diagramDraftStore (prompt, type de diagramme, thème — persistant, respecte le mode privé)
```

`diagramStudioAdapter.tsx` réutilise l'`AssistantMessage`/`reuseUserMessage` génériques de `studio-core` : un
diagramme rendu est un asset `image` comme un autre, aucun composant de rendu spécifique n'est nécessaire.

## Services

| Méthode | Endpoint | Description |
|---|---|---|
| `generate` | `POST /api/diagrams/generate` | Corps `{conversation_id, prompt, model_id, diagram_type}` → `{conversation_id, user_message, assistant_message, mermaid_source, diagram_type}`. |
| `render` | `POST /api/diagrams/messages/:id/render` | Multipart : le PNG rendu + `diagram_type`. Réponse : l'asset créé (`Asset`). |

## Composants

| Composant | Description |
|---|---|
| `DiagramHome` | Page d'accueil : accroche, carte de première installation, composeur hero, quatre suggestions de prompt (une par type de diagramme courant). |
| `Composer` | Prompt (Entrée envoie), sélecteur de modèle, type de diagramme, thème visuel, envoi. Pas de références ni de paramètres de génération (taille, étapes) : un diagramme est prompt + type + thème. |
| `DiagramTypePicker` | Choix du type (flowchart, organigramme, architecture, états, carte mentale, séquence) — détermine le schéma JSON et la conversion Mermaid côté back. |
| `ThemePicker` | Thème visuel appliqué au rendu (clair, sombre, coloré, minimal) — jamais envoyé au modèle : change de thème ne redemande rien, la source Mermaid stockée est simplement re-rendue. |

## Types principaux

`DiagramType`, `DiagramTheme`, `GenerateDiagramRequest`/`GenerateDiagramResponse` (miroir de
`back/src/modules/diagrams/types/diagramTypes.ts`).

## Dépendances

`studio-core` (`AssistantMessage`, `reuseUserMessage`, `StudioModelPicker`, `upsertMessage`/`addOutput`,
`usePromptHandoff`), `model-catalog` (`useActiveModel('diagram')`, `useModels`), `engines` (`SetupPrompt`,
`WelcomeSetup`), `mermaid` (rendu SVG, nouvelle dépendance front — voir `package.local.json`).
