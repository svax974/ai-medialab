/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/**
 * JSON Schemas sent as `response_format: {type: 'json_schema', schema}` (`engine/app/llm.py`, already wired to
 * llama.cpp's constrained decoding — see `engine/app/update_advisor.py`'s `EXTRACT_SCHEMA` for the existing, proven
 * use of this mechanism). The model's answer is always valid against the schema: no free-form Mermaid/DOT to parse.
 * Caps (`maxItems`, `maxLength`) keep a single diagram from running away in size or latency.
 */

export const GRAPH_SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['TD', 'LR'] },
    nodes: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', maxLength: 32 },
          label: { type: 'string', maxLength: 80 },
          shape: { type: 'string', enum: ['rect', 'round', 'diamond', 'circle', 'stadium'] },
          group: { type: 'string', maxLength: 40 },
        },
        required: ['id', 'label', 'shape'],
      },
    },
    edges: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', maxLength: 32 },
          to: { type: 'string', maxLength: 32 },
          label: { type: 'string', maxLength: 40 },
          style: { type: 'string', enum: ['solid', 'dashed'] },
        },
        required: ['from', 'to'],
      },
    },
  },
  required: ['nodes', 'edges'],
} as const;

export const SEQUENCE_SCHEMA = {
  type: 'object',
  properties: {
    participants: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: { id: { type: 'string', maxLength: 24 }, label: { type: 'string', maxLength: 48 } },
        required: ['id', 'label'],
      },
    },
    messages: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', maxLength: 24 },
          to: { type: 'string', maxLength: 24 },
          label: { type: 'string', maxLength: 80 },
          style: { type: 'string', enum: ['sync', 'async', 'reply'] },
        },
        required: ['from', 'to', 'label'],
      },
    },
  },
  required: ['participants', 'messages'],
} as const;

/** `Tu dessines...`: the instruction per diagram family, appended with the user's own prompt as the next message. */
export const GRAPH_SYSTEM =
  "Tu transformes une demande en un graphe structuré pour un diagramme (organigramme, flowchart, architecture ou " +
  'diagramme d\'états). Réponds UNIQUEMENT par un JSON {"direction": "TD"|"LR", "nodes": [{"id", "label", "shape", ' +
  '"group"?}], "edges": [{"from", "to", "label"?, "style"?}]}. "id" est un identifiant court sans espace (ex. "a1"), ' +
  '"label" est le texte affiché (peut contenir des espaces et accents). "from"/"to" référencent des "id" de "nodes" ' +
  "existants. N'invente pas de nœud non demandé ; reste fidèle au contenu et à la structure demandés.";

export const SEQUENCE_SYSTEM =
  'Tu transformes une demande en diagramme de séquence structuré. Réponds UNIQUEMENT par un JSON ' +
  '{"participants": [{"id", "label"}], "messages": [{"from", "to", "label", "style"?: "sync"|"async"|"reply"}]}. ' +
  '"id" est un identifiant court sans espace, "label" est le texte affiché. "from"/"to" référencent des "id" de ' +
  '"participants" existants, dans l\'ordre chronologique des échanges.';
