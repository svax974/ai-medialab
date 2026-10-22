# `diagram-studio` (front)

## Role

"Diagrams" tab: org charts, flowcharts, sequences, architectures, states, mind maps. Same mechanics
as the other studios (home page, composer, model selection, download on selection, conversation
thread, gallery, export) but without a generation job: a generation is a one-off call to the local LLM
(`POST /api/diagrams/generate`), followed by a Mermaid → SVG → PNG rendering **on the front side**, then an upload of the PNG
(`POST /api/diagrams/messages/:id/render`) which attaches it to the message as a classic generated asset — hence its
presence in the gallery, the thread and the download exactly like an image.

## Structure

```
components/  DiagramHome, Composer, DiagramTypePicker, ThemePicker
hooks/       useSendDiagram (generates → renders → attaches, a single action from the composer's point of view)
lib/         composerRules (pure, tested), mermaidThemes, renderDiagram (Mermaid → SVG → PNG, client-side), suggestions
services/    diagramsApi
state/       diagramDraftStore (prompt, diagram type, theme — persistent, respects private mode)
```

`diagramStudioAdapter.tsx` reuses the generic `AssistantMessage`/`reuseUserMessage` of `studio-core`: a rendered diagram
is an `image` asset like any other, no specific rendering component is needed.

## Services

| Method | Endpoint | Description |
|---|---|---|
| `generate` | `POST /api/diagrams/generate` | Body `{conversation_id, prompt, model_id, diagram_type}` → `{conversation_id, user_message, assistant_message, mermaid_source, diagram_type}`. |
| `render` | `POST /api/diagrams/messages/:id/render` | Multipart: the rendered PNG + `diagram_type`. Response: the created asset (`Asset`). |

## Components

| Component | Description |
|---|---|
| `DiagramHome` | Home page: tagline, first-installation card, hero composer, four prompt suggestions (one per common diagram type). |
| `Composer` | Prompt (Enter sends), model selector, diagram type, visual theme, send. No references nor generation parameters (size, steps): a diagram is prompt + type + theme. |
| `DiagramTypePicker` | Choice of the type (flowchart, org chart, architecture, states, mind map, sequence) — determines the JSON schema and the Mermaid conversion on the back. |
| `ThemePicker` | Visual theme applied to the rendering (light, dark, coloured, minimal) — never sent to the model: changing the theme asks for nothing again, the stored Mermaid source is simply rendered again. |

## Main types

`DiagramType`, `DiagramTheme`, `GenerateDiagramRequest`/`GenerateDiagramResponse` (mirror of
`back/src/modules/diagrams/types/diagramTypes.ts`).

## Dependencies

`studio-core` (`AssistantMessage`, `reuseUserMessage`, `StudioModelPicker`, `upsertMessage`/`addOutput`,
`usePromptHandoff`), `model-catalog` (`useActiveModel('diagram')`, `useModels`), `engines` (`SetupPrompt`,
`WelcomeSetup`), `mermaid` (SVG rendering, new front dependency — see `package.local.json`).
