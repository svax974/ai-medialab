/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useActiveModel } from '@/modules/model-catalog'
import { creationModels } from '../lib/creation'
import type { CreationModels } from '../types'

/** The model each studio uses (image, video, audio), the ready ones only: sent with every message so the chat creates with them. */
export function useCreationModels(): CreationModels {
  const image = useActiveModel('image')
  const video = useActiveModel('video')
  const audio = useActiveModel('audio')
  return creationModels({ image, video, audio })
}
