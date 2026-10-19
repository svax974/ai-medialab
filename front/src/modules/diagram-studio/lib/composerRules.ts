/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'

/** Whether the send button is enabled, and which tooltip explains its state (pure, tested). */
export function sendState(model: ModelInfo, prompt: string, sending: boolean): { canSend: boolean; tipKey: string } {
  if (!model.compatible) return { canSend: false, tipKey: 'diagramStudio.send.incompatible' }
  if (!model.ready) return { canSend: false, tipKey: 'diagramStudio.send.notReady' }
  if (sending) return { canSend: false, tipKey: 'diagramStudio.send.sending' }
  if (!prompt.trim()) return { canSend: false, tipKey: 'diagramStudio.send.empty' }
  return { canSend: true, tipKey: 'diagramStudio.send.tip' }
}
