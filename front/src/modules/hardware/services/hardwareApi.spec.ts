/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest }))

import { hardwareApi } from './hardwareApi'

describe('hardwareApi', () => {
  beforeEach(() => studioRequest.mockClear())

  it('reads the machine, with or without a new detection', async () => {
    await hardwareApi.system()
    await hardwareApi.system(true)
    expect(studioRequest.mock.calls).toEqual([
      ['get', '/system'],
      ['get', '/system?refresh=true'],
    ])
  })

  it('reads the engine status and unloads the model with a POST', async () => {
    await hardwareApi.status()
    await hardwareApi.unload()
    expect(studioRequest.mock.calls).toEqual([
      ['get', '/status'],
      ['post', '/engine/unload'],
    ])
  })
})
