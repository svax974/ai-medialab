/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest }))

import { settingsApi } from './settingsApi'

describe('settingsApi', () => {
  beforeEach(() => studioRequest.mockClear())

  it('reads /settings', async () => {
    await settingsApi.get()
    expect(studioRequest).toHaveBeenCalledWith('get', '/settings')
  })

  it('saves a patch with PUT /settings', async () => {
    await settingsApi.save({ keep_alive_minutes: -1, hf_token: '' })
    expect(studioRequest).toHaveBeenCalledWith('put', '/settings', { keep_alive_minutes: -1, hf_token: '' })
  })
})
