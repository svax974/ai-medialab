/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { parseDownloadProgress } from '../lib/downloads'
import { useDownloadStore } from '../state/downloadStore'

/** Topic of the engine's `download.progress` event, relayed by Nest (back/src/modules/engine/README.md). */
export const DOWNLOAD_TOPIC = 'engine.download.progress'

/**
 * Feeds the live download progress from the event stream. Mounted once by the studio shell, so a download keeps
 * showing its progress when the dialog is closed (the welcome card and the composers read the same store). After a
 * reconnection the live state is dropped: a progress event may have been missed, the catalogue is read again.
 */
export function useDownloadEvents(): void {
  useEffect(() => {
    const { setDownload, clear } = useDownloadStore.getState()
    return eventStreamClient.subscribe(
      [DOWNLOAD_TOPIC],
      (event) => {
        const progress = parseDownloadProgress(event.data)
        if (progress) setDownload(progress)
      },
      { onResync: clear },
    )
  }, [])
}
