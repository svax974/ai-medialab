/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { filterFiles } from '@/modules_shared/common/components/ui/filedrop/fileFilter'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { assetsApi } from '@/modules/media-library/services/assetsApi'
import { useImageDraftStore, type PendingUpload } from '@/modules/studio-core/state/imageDraftStore'

/** Image types accepted as references (what the engine can read), as MIME types and extensions. */
export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,image/heic,image/heif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.avif'

/**
 * Imports images as references of the next message: files that are not images are ignored with a warning; each image
 * shows a dimmed preview with a spinner until the server (`POST /api/assets`, multipart) answers; then the created
 * assets join the references and the composer takes the focus. A failure is shown and leaves the draft as it was.
 */
export async function uploadReferences(files: File[]): Promise<void> {
  const { accepted, rejected } = filterFiles(files, { accept: IMAGE_ACCEPT, multiple: true })
  if (rejected.length > 0) toast.warning(i18n.get('imageStudio.upload.ignored'))
  if (accepted.length === 0) return

  const draft = useImageDraftStore.getState
  const pending: PendingUpload[] = accepted.map((file) => ({ tempId: crypto.randomUUID(), previewUrl: URL.createObjectURL(file), name: file.name }))
  draft().setUploading([...draft().uploading, ...pending])
  try {
    draft().addReferences(await assetsApi.upload(accepted))
    focusTarget('composer')
  } catch (error) {
    toast.error(i18n.get('imageStudio.upload.failed', [(error as Error).message]))
  } finally {
    const done = new Set(pending.map((p) => p.tempId))
    for (const p of pending) URL.revokeObjectURL(p.previewUrl)
    draft().setUploading(draft().uploading.filter((u) => !done.has(u.tempId)))
  }
}
