/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import type { Asset } from '../types'
import { downloadName } from './messageState'

/** Copies a text and says so (or says it failed: the clipboard needs a secure context and a user gesture). */
export function copyText(text: string): void {
  navigator.clipboard.writeText(text).then(
    () => void toast.success(i18n.get('thread.copy.done'), { autoClose: 1200 }),
    () => void toast.error(i18n.get('thread.copy.failed')),
  )
}

/** Downloads a media file through a temporary link (the file is served by the same origin). */
export function downloadAsset(asset: Asset): void {
  const link = document.createElement('a')
  link.href = resolveMediaUrl(asset.url)
  link.download = downloadName(asset)
  document.body.appendChild(link)
  link.click()
  link.remove()
}
