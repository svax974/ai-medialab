/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Asset } from '../types'

/** Drag type of a conversation image dragged by the user; dropping it on the window adds it as a reference (same as before). */
export const ASSET_DRAG_TYPE = 'application/x-cn-asset'

/** Whether a drag carries one of our images (`dataTransfer.types` is readable during the drag, its content is not). */
export function dragHasAsset(types: readonly string[] | undefined): boolean {
  return types?.includes(ASSET_DRAG_TYPE) ?? false
}

/** The asset of a drop payload, or `null` when the text is not a valid asset. */
export function parseDraggedAsset(payload: string): Asset | null {
  try {
    const value = JSON.parse(payload) as Partial<Asset> | null
    return value && typeof value.id === 'string' && typeof value.url === 'string' ? (value as Asset) : null
  } catch {
    return null
  }
}
