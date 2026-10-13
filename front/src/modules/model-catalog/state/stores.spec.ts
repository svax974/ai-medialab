/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useDownloadStore } from './downloadStore'
import { useModelSelectionStore } from './modelSelectionStore'

describe('downloadStore', () => {
  beforeEach(() => useDownloadStore.getState().clear())
  it('keeps the latest progress of each model and clears on resync', () => {
    const { setDownload } = useDownloadStore.getState()
    setDownload({ model_id: 'a', state: 'running', done: 1, total: 2, rate: 0, eta: null, error: null })
    setDownload({ model_id: 'a', state: 'done', done: 2, total: 2, rate: 0, eta: null, error: null })
    expect(useDownloadStore.getState().downloads.a.state).toBe('done')
    useDownloadStore.getState().clear()
    expect(useDownloadStore.getState().downloads).toEqual({})
  })
})

describe('modelSelectionStore', () => {
  it('remembers the model of each kind separately', () => {
    useModelSelectionStore.getState().select('audio', 'kokoro')
    useModelSelectionStore.getState().select('image', 'sdxl')
    expect(useModelSelectionStore.getState().selected).toEqual({ image: 'sdxl', audio: 'kokoro', video: null })
  })
})
