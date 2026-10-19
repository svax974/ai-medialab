/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { IDLE_RUN } from '../lib/setupDialog'
import { useSetupStore } from './setupStore'

beforeEach(() => useSetupStore.setState({ dialogModelId: null, run: IDLE_RUN }))

describe('setupStore', () => {
  it('opens the dialog for a model and closes it', () => {
    useSetupStore.getState().open('m')
    expect(useSetupStore.getState().dialogModelId).toBe('m')
    useSetupStore.getState().close()
    expect(useSetupStore.getState().dialogModelId).toBeNull()
  })

  it('forgets a finished run when the dialog is reopened', () => {
    useSetupStore.getState().setRun({ ...IDLE_RUN, state: 'cancelled', model_id: 'm' })
    useSetupStore.getState().open('m')
    expect(useSetupStore.getState().run.state).toBe('idle')
  })

  it('keeps the run that is going on', () => {
    useSetupStore.getState().setRun({ ...IDLE_RUN, state: 'running', model_id: 'm' })
    useSetupStore.getState().open('m')
    expect(useSetupStore.getState().run.state).toBe('running')
  })
})
