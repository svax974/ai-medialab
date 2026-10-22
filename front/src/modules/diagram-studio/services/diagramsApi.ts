/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Asset } from '@/modules/media-library'
import { studioRequest, studioUpload } from '@/modules/studio-shell/services/studioHttp'
import type { DiagramType, GenerateDiagramRequest, GenerateDiagramResponse } from '../types'

/** `/api/diagrams/*` (Nest, module `diagrams`): one-shot generation (no job queue, see the module's README) and the
 * PNG render attached afterwards once the front has turned the Mermaid source into an image. */
export const diagramsApi = {
  generate(request: GenerateDiagramRequest): Promise<GenerateDiagramResponse> {
    return studioRequest<GenerateDiagramResponse>('post', '/diagrams/generate', request)
  },
  /** Attaches the rendered PNG to the assistant message; the answer is the created (generated) asset. */
  render(messageId: string, png: Blob, diagramType: DiagramType): Promise<Asset> {
    const form = new FormData()
    form.append('file', png, 'diagram.png')
    form.append('diagram_type', diagramType)
    return studioUpload<Asset>(`/diagrams/messages/${encodeURIComponent(messageId)}/render`, form)
  },
}
