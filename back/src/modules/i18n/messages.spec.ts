/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { loadDictionaries } from './tr';

const root = path.resolve(__dirname, '..');
const { fr, en } = loadDictionaries(root);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

const placeholders = (text: string): string => (text.match(/\{\d+\}/g) ?? []).sort().join();

describe('server messages (src/modules/*/i18n)', () => {
  it('fr and en define the same keys, none empty, with the same placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    const broken = Object.keys(fr).filter(
      (key) => !fr[key].trim() || !en[key]?.trim() || placeholders(en[key]) !== placeholders(fr[key]),
    );
    expect(broken).toEqual([]);
  });

  it('defines every key passed to tr() in the code', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(root)) {
      for (const match of fs.readFileSync(file, 'utf-8').matchAll(/\btr\(\s*['"`]([\w.-]+)['"`]/g)) used.add(match[1]);
    }
    const missing = [...used].filter((key) => !(key in fr));
    expect(missing).toEqual([]);
  });
});
