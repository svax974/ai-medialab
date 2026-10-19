/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useInstallStore } from './installStore'

describe('installStore', () => {
  beforeEach(() => useInstallStore.setState({ packInstall: { state: 'idle' }, engineInstall: { state: 'idle' }, llamacppInstall: { state: 'idle' } }))

  it('keeps the installers apart', () => {
    const s = useInstallStore.getState()
    s.setPackInstall({ state: 'running', pack: 'p' })
    s.setEngineInstall({ state: 'done' })
    expect(useInstallStore.getState()).toMatchObject({ packInstall: { state: 'running' }, engineInstall: { state: 'done' }, llamacppInstall: { state: 'idle' } })
  })
  it('reset after a reconnection drops the live states', () => {
    const s = useInstallStore.getState()
    s.setPackInstall({ state: 'running' })
    s.setLlamacppInstall({ state: 'done' })
    s.reset()
    expect(useInstallStore.getState()).toMatchObject({ packInstall: { state: 'idle' }, engineInstall: { state: 'idle' }, llamacppInstall: { state: 'idle' } })
  })
})
