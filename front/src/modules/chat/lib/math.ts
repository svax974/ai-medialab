/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Fenced code (closed), or an inline code span: never touched. */
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|``[^\n]*?``|`[^`\n]*`)/g
const FENCE = /```|~~~/g
/** `$x$` that looks like mathematics: no space inside the dollars, the closing one not followed by a digit (so prices stay text). */
const INLINE_DOLLAR = /(^|[^\\$\w])\$(?=[^\s$])((?:[^$\n\\]|\\.)*?[^\s$\\])\$(?!\d)/g
const BLOCK_BRACKET = /\\\[([\s\S]+?)\\\]/g
const INLINE_PAREN = /\\\(([^\n]+?)\\\)/g

/** Whether the text may contain a formula (a cheap test: decides whether the math renderer is loaded at all). */
export const mayHaveMath = (text: string): boolean => /\$\$|\\\(|\\\[|\$[^\s$]/.test(text)

/** The part of the text from an unclosed code fence on (an answer being written): code, whatever it will become. */
function openFenceAt(text: string): number {
  const marks = [...text.matchAll(FENCE)].map((m) => m.index ?? 0)
  return marks.length % 2 === 1 ? marks[marks.length - 1] : text.length
}

function convert(part: string): string {
  return part
    .replace(BLOCK_BRACKET, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(INLINE_PAREN, (_m, body: string) => `$$${body.trim()}$$`)
    .replace(INLINE_DOLLAR, (_m, before: string, body: string) => `${before}$$${body}$$`)
}

/**
 * Writes the formulas the way the renderer reads them (`$$…$$`, inline or in a block): models also write `\( … \)`,
 * `\[ … \]` and `$…$`. Code (fenced blocks, even one still open, and inline code) is left as it is.
 */
export function normalizeMath(text: string): string {
  if (!mayHaveMath(text)) return text
  const cut = openFenceAt(text)
  const head = text.slice(0, cut)
  const tail = text.slice(cut)
  return head.split(CODE).map((part, i) => (i % 2 === 1 ? part : convert(part))).join('') + tail
}
