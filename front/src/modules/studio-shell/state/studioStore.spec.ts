/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useStudioStore } from './studioStore'

describe('studioStore', () => {
  beforeEach(() => {
    useStudioStore.setState({ mode: 'image', sidebarOpen: true, settingsOpen: false, modelsOpen: false, modelsSearchKind: null })
  })

  it('toggles the sidebar', () => {
    useStudioStore.getState().toggleSidebar()
    expect(useStudioStore.getState().sidebarOpen).toBe(false)
    useStudioStore.getState().toggleSidebar()
    expect(useStudioStore.getState().sidebarOpen).toBe(true)
  })

  it('remembers the last path of each mode independently', () => {
    useStudioStore.getState().rememberPath('audio', '/audio/voix')
    expect(useStudioStore.getState().lastPathByMode).toMatchObject({ image: '/', audio: '/audio/voix', video: '/video' })
  })

  it('sets the mode', () => {
    useStudioStore.getState().setMode('video')
    expect(useStudioStore.getState().mode).toBe('video')
  })

  it('opens the models dialog on a kind to search, then forgets the request', () => {
    useStudioStore.getState().openModelSearch('video')
    expect(useStudioStore.getState()).toMatchObject({ modelsOpen: true, modelsSearchKind: 'video' })
    useStudioStore.getState().clearModelSearch()
    expect(useStudioStore.getState()).toMatchObject({ modelsOpen: true, modelsSearchKind: null })
  })
})
