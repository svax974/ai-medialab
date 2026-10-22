/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { create } from 'zustand'
import { upsertDownload } from '../lib/downloads'
import type { DownloadProgress } from '../types'

/** Live download progress (event stream), by model id. The catalogue only reports running or failed downloads at read time. */
interface DownloadState {
  downloads: Record<string, DownloadProgress>
  setDownload: (progress: DownloadProgress) => void
  /** After a stream reconnection: the catalogue is the source again. */
  clear: () => void
}

export const useDownloadStore = create<DownloadState>()((set) => ({
  downloads: {},
  setDownload: (progress) => set((state) => ({ downloads: upsertDownload(state.downloads, progress) })),
  clear: () => set({ downloads: {} }),
}))
