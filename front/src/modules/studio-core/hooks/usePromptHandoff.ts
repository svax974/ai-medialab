/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { usePromptHandoffStore, type HandoffTarget } from '../state/promptHandoffStore'

/** The composer of `target` takes the text another studio sent it (when it shows, or while it is shown) and applies it to its draft. */
export function usePromptHandoff(target: HandoffTarget, apply: (text: string) => void): void {
  const pending = usePromptHandoffStore((s) => s.pending)
  useEffect(() => {
    if (!pending || pending.target !== target) return
    const text = usePromptHandoffStore.getState().take(target)
    if (text !== null) apply(text)
  }, [pending, target, apply])
}
