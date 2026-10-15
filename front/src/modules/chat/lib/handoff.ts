/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** The studios an answer can be sent to as a prompt. */
export const HANDOFF_TARGETS = ['image', 'video', 'audio'] as const

const FENCED = /^[ \t]*(```|~~~)[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$\n?/gm
const OPEN_FENCE = /^[ \t]*(```|~~~)[^\n]*\n?/gm

/**
 * What an answer's Markdown becomes as a prompt: the text without the marks that mean nothing to a generation model.
 * Fenced code is kept as plain text (an empty block disappears), headings, emphasis, quotes, list markers, links
 * (their text stays) and images (dropped) lose their marks, blank lines are squeezed. Predictable and conservative: the
 * words are never changed.
 */
export function promptFromMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(FENCED, (_m, _fence: string, body: string) => (body.trim() ? body : ''))
    .replace(OPEN_FENCE, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The text to send: what the user selected in the answer when something is, else the whole answer; both without the Markdown marks. */
export const handoffText = (answer: string, selection: string): string => promptFromMarkdown(selection.trim() ? selection : answer)
