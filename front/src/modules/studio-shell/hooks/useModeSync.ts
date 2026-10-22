/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { matchStudioRoute, modeOfRoute } from '../lib/routes'
import { useStudioStore } from '../state/studioStore'
import { useConversation } from './useConversations'

/**
 * The mode (image / audio / video) follows the current page, and the page is remembered as the last one of its mode
 * (the mode switch returns there). A conversation page takes the mode of the conversation once loaded.
 */
export function useModeSync(): void {
  const { pathname } = useLocation()
  const match = matchStudioRoute(pathname)
  const { data: conversation } = useConversation(match?.route.name === 'conversation' ? match.id : null)
  const setMode = useStudioStore((s) => s.setMode)
  const rememberPath = useStudioStore((s) => s.rememberPath)
  const mode = modeOfRoute(match, conversation?.mode)

  useEffect(() => {
    if (!mode) return
    setMode(mode)
    rememberPath(mode, pathname)
  }, [mode, pathname, setMode, rememberPath])
}
