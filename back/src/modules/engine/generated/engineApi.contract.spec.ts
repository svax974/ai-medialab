/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const BACK = resolve(__dirname, '../../../..');

describe('engine contract', () => {
  it('generated/engineApi.d.ts is up to date with engine/openapi.json (run `npm run engine:types`)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-types-'));
    const out = join(dir, 'engineApi.d.ts');
    try {
      execFileSync(join(BACK, 'node_modules/.bin/openapi-typescript'), [join(BACK, '../engine/openapi.json'), '-o', out], {
        cwd: BACK,
        stdio: 'pipe',
      });
      expect(readFileSync(join(__dirname, 'engineApi.d.ts'), 'utf8')).toBe(readFileSync(out, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
