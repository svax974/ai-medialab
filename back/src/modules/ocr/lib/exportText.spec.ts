/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import type { OcrDocumentDetailDto } from '../types/ocrTypes';
import { exportFileName, exportReading } from './exportText';

const doc = (texts: string[]): OcrDocumentDetailDto => ({
  id: 'd', title: 'Facture.pdf', source_kind: 'pdf', document_pages: texts.length, pages: null, model_id: 'm', model_name: 'M', task: 'default', prompt: null,
  status: 'done', error: null, error_code: null, progress: { done: texts.length, total: texts.length }, created_at: 1, updated_at: 2, source_url: '/x',
  pages_read: texts.map((text, i) => ({ index: i + 1, text, truncated: false, tokens: null })),
});

describe('exportReading', () => {
  it('writes a single page as it is', () => {
    expect(exportReading(doc(['Bonjour']), 'txt').body).toBe('Bonjour\n');
  });

  it('marks the pages of a longer document', () => {
    expect(exportReading(doc(['a', 'b']), 'md').body).toBe('## Page 1\n\na\n\n## Page 2\n\nb\n');
    expect(exportReading(doc(['a', 'b']), 'txt').body).toBe('--- Page 1 ---\na\n\n--- Page 2 ---\nb\n');
  });

  it('gives the whole reading as JSON', () => {
    const { body, extension } = exportReading(doc(['a']), 'json');
    expect(extension).toBe('json');
    expect(JSON.parse(body).pages_read[0].text).toBe('a');
  });
});

describe('exportFileName', () => {
  it('drops the extension and unsafe characters', () => {
    expect(exportFileName('Facture 2026/03.pdf', 'md')).toBe('Facture 2026_03.md');
    expect(exportFileName('', 'txt')).toBe('ocr.txt');
  });
});
