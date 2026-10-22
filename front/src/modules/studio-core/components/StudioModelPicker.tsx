/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { ModelPicker, useModelUsage, WhatsNewButton, type ModelInfo } from '@/modules/model-catalog'

/**
 * The model picker of a composer, its models ordered by use (finished generations of this library), and next to it the
 * « What's new ? » button of the page (recent models of this kind): the one place that puts it on the image, audio, video and
 * chat pages. `onSelect`: what else a choice does (the chat keeps the model in the conversation's settings).
 */
export function StudioModelPicker({ model, onSelect }: { model: ModelInfo; onSelect?: (model: ModelInfo) => void }) {
  return (
    <>
      <ModelPicker model={model} usage={useModelUsage()} onSelect={onSelect} />
      <WhatsNewButton kind={model.kind} />
    </>
  )
}
