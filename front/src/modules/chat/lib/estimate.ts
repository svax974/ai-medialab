/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Rough token count of a text (about four characters per token for English, fewer for code and accents): an indication only. */
export function estimateTokens(text: string): number {
  return text.trim() === '' ? 0 : Math.ceil(text.length / 3.6)
}
