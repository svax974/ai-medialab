/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { Settings, SettingsPatch } from '../types'

/** Nest routes `/api/settings`. */
export const settingsApi = {
  get(): Promise<Settings> {
    return studioRequest<Settings>('get', '/settings')
  },
  save(patch: SettingsPatch): Promise<Settings> {
    return studioRequest<Settings>('put', '/settings', patch)
  },
}
