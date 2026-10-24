/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import type { Asset } from '../types'
import { downloadName } from './messageState'
import { loadShareFile } from './share'

/** A library asset as a `File`, to hand to a composer that takes files (chat attachments, the OCR source). */
export function assetToFile(asset: Asset): Promise<File> {
  return loadShareFile(resolveMediaUrl(asset.url), downloadName(asset))
}
