/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { privateApi } from '../services/privateApi'
import { usePrivateStore } from '../state/privateStore'

/**
 * What ties the session to the page: a session left by a page that closed without telling (a reload) is erased at
 * startup (a page always opens in the normal mode); the browser is asked to confirm before closing while the
 * session holds results; and as the page goes away the server is told to erase (`sendBeacon`).
 */
export function usePrivateGuards(): void {
  useEffect(() => {
    privateApi.info().then(
      (info) => {
        if (info.active && !usePrivateStore.getState().active) void privateApi.end().catch(() => undefined)
      },
      () => undefined,
    )
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      const state = usePrivateStore.getState()
      if (!state.active || (state.info?.results ?? 0) === 0) return
      event.preventDefault()
      event.returnValue = ''
    }
    const pageHide = (): void => {
      if (usePrivateStore.getState().active) privateApi.leaveBeacon()
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('pagehide', pageHide)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('pagehide', pageHide)
    }
  }, [])
}
