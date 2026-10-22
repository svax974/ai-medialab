/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { StudioMode } from '@/modules/studio-shell/types'
import type { ModelKind } from '../types'

/** The models a mode of the studio uses: the chat runs language models (`llm`), the other modes their own kind. */
export function modelKindOfMode(mode: StudioMode): ModelKind {
  return mode === 'chat' ? 'llm' : mode
}
