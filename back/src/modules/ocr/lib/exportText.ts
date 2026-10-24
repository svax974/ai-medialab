/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { OcrDocumentDetailDto, OcrExportFormat } from '../types/ocrTypes';

/** The text of a reading for a download: pages joined (with a page heading when there are several), or the whole result as JSON. */
export function exportReading(doc: OcrDocumentDetailDto, format: OcrExportFormat): { body: string; mime: string; extension: string } {
  if (format === 'json') {
    return { body: JSON.stringify(doc, null, 2), mime: 'application/json; charset=utf-8', extension: 'json' };
  }
  const several = doc.pages_read.length > 1;
  const blocks = doc.pages_read.map((page) => {
    if (!several) return page.text;
    return format === 'md' ? `## Page ${page.index}\n\n${page.text}` : `--- Page ${page.index} ---\n${page.text}`;
  });
  return {
    body: blocks.join('\n\n') + '\n',
    mime: format === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
    extension: format,
  };
}

/** A file name for a download: the document's title without its extension, safe on every system. */
export function exportFileName(title: string, extension: string): string {
  const base = title.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim().slice(0, 80) || 'ocr';
  return `${base}.${extension}`;
}
