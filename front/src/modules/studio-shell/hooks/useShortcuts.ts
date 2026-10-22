/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { focusTarget } from '../lib/focusRegistry'
import { homePathForMode } from '../lib/routes'
import { isTypingTarget, resolveShortcut } from '../lib/shortcuts'
import { useStudioStore } from '../state/studioStore'

/** A modal (dialog, lightbox) is open: its own keys take precedence over plain shortcuts. */
const modalIsOpen = () => document.querySelector('[role="dialog"], [aria-modal="true"]') !== null

/** Window-level shortcuts of the shell: Cmd+B, Cmd+Shift+O, Cmd+K and `/`. */
export function useShortcuts(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(event, { typing: isTypingTarget(event.target), blocked: modalIsOpen() })
      if (!action) return
      event.preventDefault()
      const store = useStudioStore.getState()
      if (action === 'toggleSidebar') store.toggleSidebar()
      else if (action === 'newCreation') {
        navigate(homePathForMode(store.mode))
        focusTarget('composer')
      } else if (action === 'focusComposer') focusTarget('composer')
      else {
        store.setSidebarOpen(true)
        focusTarget('search', true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])
}
