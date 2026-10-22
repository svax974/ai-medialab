# `diagrams` (back)

## Role

Diagram generation (org charts, flowcharts, sequences, architecture, states, mind maps) for the "Diagrams" tab: a one-off call to the local language model (JSON constrained by a schema, never a diffusion job), converted to Mermaid, stored as a pair of messages (prompt + generation) in the generic entities of `studio-core` — the same ones used for an image, an audio or a video. The rendering (Mermaid → SVG → PNG) happens on the front side; this module only produces the structure and stores the PNG once received.

Unlike Image/Audio/Video, these generations never go through the general job queue (`GenerationQueueService`/`/api/messages`): a diagram model has no engine class (`spec.engine` empty on the engine side), and sending it there would crash the worker. `engine/app/job_checks.py::check_generation` explicitly refuses `spec.kind == "diagram"` as defense in depth, on top of the fact that this module never enqueues it itself.

## Architecture

| Element | Role |
|---|---|
| `DiagramsController` | `/api/diagrams/generate` and `/api/diagrams/messages/:id/render` |
| `DiagramsService` | Engine lock (`EngineBusyGate`, owner `'diagram'`), model resolution (`ChatModelService`, `kind: 'diagram'`), constrained LLM call (`EngineLlmClient.complete`), JSON → Mermaid conversion (`toMermaid`), creation of the messages (`MessageService`/`ConversationService`), attachment of the render as a generated asset |
| `lib/schemas.ts` | `GRAPH_SCHEMA` (nodes/edges: flowchart, org chart, architecture, states, mind map) and `SEQUENCE_SCHEMA` (ordered participants/messages), plus the associated system instructions |
| `lib/toMermaid.ts` | Pure, tested function: schema-validated JSON → Mermaid source (no free syntax to parse) |

## Dependencies

`ChatModule` (`EngineLlmClient`, `ChatModelService`, generic LLM/diagram resolution), `StudioCoreModule` (`ConversationService`, `MessageService`, `EngineBusyGate`, `GenerationQueueService`), `MediaLibraryModule` (`AssetFileService.ingest(file, {kind:'generated', messageId, meta})`, a variant added for this module — the generated asset is a regular PNG, `kind:'generated'`, `media:'image'`: no new media type).

## Exposed endpoints (exhaustive)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/diagrams/generate` | Admin | Body `{conversation_id?, prompt, model_id?, diagram_type}` → schema-constrained LLM call, conversion to Mermaid, creation of the message pair (status `done`). Response `{conversation_id, user_message, assistant_message, mermaid_source, diagram_type}` (same generic `MessageDto` as `/api/messages`). 409 if the engine is busy or the model unavailable (same codes as `PromptEnhanceService`), 404 unknown conversation/model, 422 empty prompt or invalid diagram type. |
| `POST` | `/api/diagrams/messages/:id/render` | Admin | Multipart `file` (PNG already rendered on the front side) + `diagram_type`: attaches the image as the message's generated asset, with the Mermaid source and the diagram type in its metadata (to restyle without asking the model again). Response: the created `AssetDto`. 404 if the message is not a diagram generation, 422 without a file. |

## Entities

No entity of its own: the messages live in `MessageEntity`/`ConversationEntity` of `studio-core` (`ConversationMode = 'diagram'`), the renders in `AssetEntity` of `media-library` (`kind:'generated'`, `media:'image'`, `meta: {diagram_type, mermaid_source}`).

## Extension points

- New diagram type: add its value to `DiagramType`/`DIAGRAM_TYPES`, a case in `toMermaid.ts`, and if needed a dedicated JSON schema (if its data shape differs from the generic graph or the sequence).
- Proposed models: `engine/app/engines/diagram_models.py` (reuses the same GGUF files as `llm_models.py` — no duplicate download).
