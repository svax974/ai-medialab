/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Longest text one request takes (the server refuses more), and the length from which the text is read piece by piece with a warning. */
export const MAX_TEXT_LENGTH = 8000
export const LONG_TEXT_LENGTH = 6000

/** Estimated speech duration (about 15 characters per second, a calm reading pace) at a playback speed. */
export function estimateSeconds(text: string, speed = 1): number {
  const chars = text.replace(/\s+/g, ' ').trim().length
  return chars / 15 / Math.max(0.5, speed)
}

export type ApproxDuration = { key: 'audioStudio.approx.seconds'; params: [number] } | { key: 'audioStudio.approx.minutes'; params: [number, string] }

/** "≈ 12 s" or "≈ 1 min 05 s" as a locale key and its parameters (the component translates it). */
export function approxDuration(seconds: number): ApproxDuration {
  if (seconds < 60) return { key: 'audioStudio.approx.seconds', params: [Math.max(1, Math.round(seconds))] }
  return { key: 'audioStudio.approx.minutes', params: [Math.floor(seconds / 60), String(Math.round(seconds % 60)).padStart(2, '0')] }
}

/** The rule of the server (`engine/app/dialogue.py`): "Name: line" at the start of a line, the name optionally bracketed. */
const LINE = /^\s*[[(]?\s*([\p{L}][\p{L}\p{N}_ .'’-]{0,28}?)\s*[\])]?\s*[:：]\s*(.*)$/u

/** Names that open at least one line with some text after them, in order of appearance (the characters of a dialogue). */
export function speakersIn(text: string): string[] {
  const seen: string[] = []
  for (const line of text.split('\n')) {
    const match = LINE.exec(line)
    if (match && match[2].trim() && !seen.includes(match[1].trim())) seen.push(match[1].trim())
  }
  return seen
}
