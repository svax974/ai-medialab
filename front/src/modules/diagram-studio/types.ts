/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { Message } from '@/modules/studio-core'

/** Mirrors `back/src/modules/diagrams/types/diagramTypes.ts` `DiagramType`. */
export type DiagramType = 'flowchart' | 'orgchart' | 'architecture' | 'state' | 'mindmap' | 'sequence'

export const DIAGRAM_TYPES: readonly DiagramType[] = ['flowchart', 'orgchart', 'architecture', 'state', 'mindmap', 'sequence']

/** A visual preset applied at render time only (never sent to the model): the stored Mermaid source is re-themable. */
export type DiagramTheme = 'light' | 'dark' | 'vivid' | 'minimal'

export const DIAGRAM_THEMES: readonly DiagramTheme[] = ['light', 'dark', 'vivid', 'minimal']

export interface GenerateDiagramRequest {
  conversation_id: string | null
  prompt: string
  model_id: string
  diagram_type: DiagramType
}

export interface GenerateDiagramResponse {
  conversation_id: string
  user_message: Message
  assistant_message: Message
  mermaid_source: string
  diagram_type: DiagramType
}
