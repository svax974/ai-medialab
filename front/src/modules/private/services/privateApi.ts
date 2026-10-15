/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { studioApiBase, studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { PrivateSessionInfo } from '../types'

/** `/api/private/session` (Nest module `private`): the session itself, not the studio routes it answers. */
export const privateApi = {
  info: (): Promise<PrivateSessionInfo> => studioRequest<PrivateSessionInfo>('get', '/private/session'),
  start: (): Promise<PrivateSessionInfo> => studioRequest<PrivateSessionInfo>('post', '/private/session'),
  end: (): Promise<PrivateSessionInfo> => studioRequest<PrivateSessionInfo>('delete', '/private/session'),
  /** The page's last word as it closes: `sendBeacon` can only POST, and it survives the page. */
  leaveBeacon: (): boolean => typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(`${studioApiBase()}/private/session/leave`),
}
