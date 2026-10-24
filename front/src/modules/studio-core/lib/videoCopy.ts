/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { assetsApi } from '@/modules/media-library/services/assetsApi'
import type { VideoPreset } from '@/modules/media-library/types'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import type { Asset } from '../types'
import { downloadName } from './messageState'

export interface VideoCopyFile {
  url: string
  name: string
}

/** File name of a light copy: the name of the original with the preset before the extension. */
export function videoCopyName(asset: Parameters<typeof downloadName>[0], preset: VideoPreset): string {
  const extension = preset.startsWith('gif') ? 'gif' : 'mp4'
  return downloadName(asset).replace(/\.mp4$/, `-${preset}.${extension}`)
}

/** Has the engine make the light copy of a video (a notice shows while it works). Throws after telling the user. */
export async function makeVideoCopy(asset: Asset, preset: VideoPreset): Promise<VideoCopyFile> {
  const notice = toast.loading(i18n.get('thread.export.preparing'))
  try {
    const copy = await assetsApi.exportVideo(asset.id, preset)
    toast.dismiss(notice)
    return { url: resolveMediaUrl(copy.url), name: videoCopyName(asset, preset) }
  } catch (error) {
    toast.update(notice, { render: error instanceof Error ? error.message : i18n.get('thread.export.failed'), type: 'error', isLoading: false, autoClose: 5000 })
    throw error
  }
}

/** Downloads a light copy (MP4 or GIF) of a video. */
export async function downloadVideoCopy(asset: Asset, preset: VideoPreset): Promise<void> {
  const copy = await makeVideoCopy(asset, preset).catch(() => null)
  if (!copy) return
  const link = document.createElement('a')
  link.href = copy.url
  link.download = copy.name
  document.body.appendChild(link)
  link.click()
  link.remove()
}
