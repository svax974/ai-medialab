/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useInstallStore } from './installStore'

describe('installStore', () => {
  beforeEach(() => useInstallStore.setState({ packInstall: { state: 'idle' }, engineInstall: { state: 'idle' }, pendingModelId: null }))

  it('keeps the two installers and the pending model apart', () => {
    const s = useInstallStore.getState()
    s.setPackInstall({ state: 'running', pack: 'p' })
    s.setEngineInstall({ state: 'done' })
    s.setPending('m')
    expect(useInstallStore.getState()).toMatchObject({ packInstall: { state: 'running' }, engineInstall: { state: 'done' }, pendingModelId: 'm' })
  })
  it('reset after a reconnection drops the live states but not the pending model', () => {
    const s = useInstallStore.getState()
    s.setPackInstall({ state: 'running' })
    s.setPending('m')
    s.reset()
    expect(useInstallStore.getState()).toMatchObject({ packInstall: { state: 'idle' }, engineInstall: { state: 'idle' }, pendingModelId: 'm' })
  })
})
