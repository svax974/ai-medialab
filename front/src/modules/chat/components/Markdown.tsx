/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { lazy, Suspense } from 'react'
import { Box } from '@mui/material'
import { useThrottled } from '../hooks/useThrottled'
import { mayHaveMath } from '../lib/math'

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'))
const MathMarkdownRenderer = lazy(() => import('./MathMarkdownRenderer'))

/** While the renderer chunk loads (or Markdown is not wanted), the text as it is. */
function Plain({ text }: { text: string }) {
  return <Box sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 15, lineHeight: 1.65, color: 'var(--ink)' }}>{text}</Box>
}

/**
 * The text of an answer as Markdown. While it is being written the rendering is throttled (the whole text is parsed
 * again at each refresh): about twelve times a second is smooth and cheap.
 */
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const shown = useThrottled(text, streaming ? 80 : 0)
  return (
    <Suspense fallback={<Plain text={shown} />}>
      {mayHaveMath(shown) ? <MathMarkdownRenderer text={shown} /> : <MarkdownRenderer text={shown} />}
    </Suspense>
  )
}
