/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { ModelPicker, type ModelInfo } from '@/modules/model-catalog'
import { useModelUsage } from '../hooks/useModelUsage'

/** The model picker of a composer, its models ordered by use (finished generations of this library). */
export function StudioModelPicker({ model }: { model: ModelInfo }) {
  return <ModelPicker model={model} usage={useModelUsage()} />
}
