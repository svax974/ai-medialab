/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Most pages one reading takes (the engine's limit, `engine/app/ocr.py` `MAX_PAGES`). */
export const MAX_OCR_PAGES = 300;

/**
 * Pages written by the user, "1-3, 5, 8-9", as a sorted list without duplicates (1-based); `null` for an empty text (all pages).
 * Returns `undefined` when the text is not a page list.
 */
export function parsePageSpec(spec: string | undefined | null): number[] | null | undefined {
  const text = (spec ?? '').trim();
  if (!text) return null;
  const pages = new Set<number>();
  for (const part of text.split(',')) {
    const match = /^\s*(\d{1,5})\s*(?:-\s*(\d{1,5}))?\s*$/.exec(part);
    if (!match) return undefined;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from || to - from >= MAX_OCR_PAGES) return undefined;
    for (let page = from; page <= to; page++) pages.add(page);
    if (pages.size > MAX_OCR_PAGES) return undefined;
  }
  return [...pages].sort((a, b) => a - b);
}
