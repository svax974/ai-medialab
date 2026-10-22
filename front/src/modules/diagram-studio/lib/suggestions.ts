/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { DiagramType } from '../types'

export interface DiagramSuggestion {
  labelKey: string
  promptKey: string
  diagramType: DiagramType
}

/** Starter prompts of the home page, one per diagram type the picker offers (except `architecture`/`mindmap`: four keeps the grid tidy, like the image studio's). */
export const SUGGESTIONS: DiagramSuggestion[] = [
  { labelKey: 'diagramStudio.suggestion.orgchart.label', promptKey: 'diagramStudio.suggestion.orgchart.prompt', diagramType: 'orgchart' },
  { labelKey: 'diagramStudio.suggestion.flowchart.label', promptKey: 'diagramStudio.suggestion.flowchart.prompt', diagramType: 'flowchart' },
  { labelKey: 'diagramStudio.suggestion.sequence.label', promptKey: 'diagramStudio.suggestion.sequence.prompt', diagramType: 'sequence' },
  { labelKey: 'diagramStudio.suggestion.state.label', promptKey: 'diagramStudio.suggestion.state.prompt', diagramType: 'state' },
]
