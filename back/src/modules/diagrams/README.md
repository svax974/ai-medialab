# `diagrams` (back)

## Rôle

Génération de diagrammes (organigrammes, flowcharts, séquences, architecture, états, cartes mentales) pour l'onglet
« Diagrammes » : un appel ponctuel au modèle de langage local (JSON contraint par schéma, jamais de job de diffusion),
converti en Mermaid, stocké comme une paire de messages (prompt + génération) dans les entités génériques de
`studio-core` — les mêmes que pour une image, un audio ou une vidéo. Le rendu (Mermaid → SVG → PNG) a lieu côté
front ; ce module ne fait que produire la structure et stocker le PNG une fois reçu.

Contrairement à Image/Audio/Vidéo, ces générations ne passent jamais par la file de jobs généraliste
(`GenerationQueueService`/`/api/messages`) : un modèle de diagramme n'a pas de classe moteur (`spec.engine` vide côté
engine), et l'y envoyer planterait le worker. `engine/app/job_checks.py::check_generation` refuse explicitement
`spec.kind == "diagram"` en défense en profondeur, en plus du fait que ce module ne l'enqueue jamais lui-même.

## Architecture

| Élément | Rôle |
|---|---|
| `DiagramsController` | `/api/diagrams/generate` et `/api/diagrams/messages/:id/render` |
| `DiagramsService` | Verrou moteur (`EngineBusyGate`, propriétaire `'diagram'`), résolution du modèle (`ChatModelService`, `kind: 'diagram'`), appel LLM contraint (`EngineLlmClient.complete`), conversion JSON → Mermaid (`toMermaid`), création des messages (`MessageService`/`ConversationService`), attache du rendu comme asset généré |
| `lib/schemas.ts` | `GRAPH_SCHEMA` (nœuds/arêtes : flowchart, organigramme, architecture, états, carte mentale) et `SEQUENCE_SCHEMA` (participants/messages ordonnés), plus les instructions système associées |
| `lib/toMermaid.ts` | Fonction pure, testée : JSON validé par schéma → source Mermaid (aucune syntaxe libre à parser) |

## Dépendances

`ChatModule` (`EngineLlmClient`, `ChatModelService`, résolution générique LLM/diagramme), `StudioCoreModule`
(`ConversationService`, `MessageService`, `EngineBusyGate`, `GenerationQueueService`), `MediaLibraryModule`
(`AssetFileService.ingest(file, {kind:'generated', messageId, meta})`, variante ajoutée pour ce module — l'asset
généré est un PNG classique, `kind:'generated'`, `media:'image'` : aucun nouveau type de média).

## Endpoints exposés (exhaustif)

| Méthode | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/diagrams/generate` | Admin | Corps `{conversation_id?, prompt, model_id?, diagram_type}` → appel LLM contraint par schéma, conversion en Mermaid, création du couple de messages (status `done`). Réponse `{conversation_id, user_message, assistant_message, mermaid_source, diagram_type}` (mêmes `MessageDto` génériques que `/api/messages`). 409 si le moteur est occupé ou le modèle indisponible (mêmes codes que `PromptEnhanceService`), 404 conversation/modèle inconnu, 422 prompt vide ou type de diagramme invalide. |
| `POST` | `/api/diagrams/messages/:id/render` | Admin | Multipart `file` (PNG déjà rendu côté front) + `diagram_type` : attache l'image comme asset généré du message, avec en métadonnées la source Mermaid et le type de diagramme (pour re-styler sans redemander au modèle). Réponse : l'`AssetDto` créé. 404 si le message n'est pas une génération de diagramme, 422 sans fichier. |

## Entités

Aucune entité propre : les messages vivent dans `MessageEntity`/`ConversationEntity` de `studio-core`
(`ConversationMode = 'diagram'`), les rendus dans `AssetEntity` de `media-library` (`kind:'generated'`,
`media:'image'`, `meta: {diagram_type, mermaid_source}`).

## Points d'extension

- Nouveau type de diagramme : ajouter sa valeur à `DiagramType`/`DIAGRAM_TYPES`, un cas dans `toMermaid.ts`, et au
  besoin un schéma JSON dédié (si sa forme de données diffère du graphe générique ou de la séquence).
- Modèles proposés : `engine/app/engines/diagram_models.py` (réutilise les mêmes fichiers GGUF que `llm_models.py` —
  aucun téléchargement dupliqué).
