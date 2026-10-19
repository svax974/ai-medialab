/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { MessageDto } from 'src/modules/studio-core';

/**
 * What the Diagrams tab can produce. `flowchart`/`orgchart`/`architecture` are the same graph rendered differently
 * (direction, grouping into subgraphs); `state` is a graph too (Mermaid's state syntax is structurally the same as a
 * flowchart's); `mindmap` needs the graph to be a tree (the first spanning tree found if it is not); `sequence` has
 * its own shape (participants + ordered messages), not a graph. Gantt/timeline and true class/ER diagrams (which need
 * attributes and cardinality, not just nodes and edges) are not covered: scoped out, see `lib/toMermaid.ts`.
 */
export type DiagramType = 'flowchart' | 'orgchart' | 'architecture' | 'state' | 'mindmap' | 'sequence';

export const DIAGRAM_TYPES: readonly DiagramType[] = ['flowchart', 'orgchart', 'architecture', 'state', 'mindmap', 'sequence'];

export interface GraphNode {
  id: string;
  label: string;
  shape: 'rect' | 'round' | 'diamond' | 'circle' | 'stadium';
  group?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
}

/** What the model answers for `flowchart` / `orgchart` / `architecture` / `state` / `mindmap`. */
export interface GraphData {
  direction?: 'TD' | 'LR';
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SequenceParticipant {
  id: string;
  label: string;
}

export interface SequenceMessage {
  from: string;
  to: string;
  label: string;
  style?: 'sync' | 'async' | 'reply';
}

/** What the model answers for `sequence`. */
export interface SequenceData {
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
}

export interface GenerateDiagramInput {
  conversationId?: string;
  prompt: string;
  modelId?: string;
  diagramType: DiagramType;
}

/** `MessageDto` kept generic (`src/modules/studio-core`) on purpose: the front caches diagram messages with the
 * exact same `upsertMessage` helper it already uses for image/audio/video (see `image-studio/hooks/useSendMessage.ts`). */
export interface GenerateDiagramResult {
  conversation_id: string;
  user_message: MessageDto;
  assistant_message: MessageDto;
  mermaid_source: string;
  diagram_type: DiagramType;
}
