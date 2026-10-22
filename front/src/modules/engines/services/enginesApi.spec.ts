/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const studioRequest = vi.hoisted(() => vi.fn(async (): Promise<unknown> => ({})))
vi.mock('@/modules/studio-shell/services/studioHttp', () => ({ studioRequest }))

import { enginesApi } from './enginesApi'

describe('enginesApi', () => {
  beforeEach(() => studioRequest.mockClear())

  it('installs, cancels and uninstalls a pack', async () => {
    await enginesApi.installPack('audio tts')
    await enginesApi.cancelPackInstall()
    await enginesApi.uninstallPack('audio tts')
    expect(studioRequest.mock.calls).toEqual([
      ['post', '/engines/pack/audio%20tts/install'],
      ['delete', '/engines/pack/install'],
      ['delete', '/engines/pack/audio%20tts'],
    ])
  })
  it('installs, cancels and uninstalls llama.cpp', async () => {
    await enginesApi.installLlamacpp()
    await enginesApi.cancelLlamacppInstall()
    await enginesApi.uninstallLlamacpp()
    expect(studioRequest.mock.calls).toEqual([
      ['post', '/engines/llamacpp/install'],
      ['delete', '/engines/llamacpp/install'],
      ['delete', '/engines/llamacpp'],
    ])
  })
  it('installs and cancels stable-diffusion.cpp', async () => {
    await enginesApi.installSdcpp()
    await enginesApi.cancelSdcppInstall()
    expect(studioRequest.mock.calls).toEqual([
      ['post', '/engines/sdcpp/install'],
      ['delete', '/engines/sdcpp/install'],
    ])
  })
})
