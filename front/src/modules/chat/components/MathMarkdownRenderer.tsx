/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { memo } from 'react'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { normalizeMath } from '../lib/math'
import { MarkdownView } from './MarkdownRenderer'

/** `$$…$$` only (`normalizeMath` wrote the others that way): a lone dollar sign stays text. */
const REMARK = [[remarkMath, { singleDollarTextMath: false }]] as never
/**
 * KaTeX draws the formulas into elements of the syntax tree (never raw HTML): `trust` off (no links, no
 * `\includegraphics`), a formula that does not parse is shown in the error colour instead of breaking the answer, and the
 * macro expansion is bounded against a formula that loops.
 */
const REHYPE = [[rehypeKatex, { throwOnError: false, errorColor: 'var(--warn)', strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 20 }]] as never

/** The Markdown of an answer that has formulas: the same renderer plus KaTeX (this chunk, with its fonts, loads only then). */
function MathMarkdownRenderer({ text }: { text: string }) {
  return <MarkdownView text={normalizeMath(text)} remark={REMARK} rehype={REHYPE} />
}

export default memo(MathMarkdownRenderer)
