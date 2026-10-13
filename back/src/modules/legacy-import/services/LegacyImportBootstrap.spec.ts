/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { LegacyImportBootstrap } from './LegacyImportBootstrap';
import { LegacyImportService } from './LegacyImportService';

describe('LegacyImportBootstrap', () => {
  afterEach(() => delete process.env.LEGACY_IMPORT);
  const make = (run: () => Promise<unknown>) => {
    const importer = { run: jest.fn(run) } as unknown as LegacyImportService;
    return { importer, bootstrap: new LegacyImportBootstrap(importer) };
  };

  it('runs the import at startup', async () => {
    const { importer, bootstrap } = make(async () => ({ status: 'no-source', counts: {} }));
    await bootstrap.onApplicationBootstrap();
    expect(importer.run).toHaveBeenCalledTimes(1);
  });

  it('is skipped with LEGACY_IMPORT=false', async () => {
    process.env.LEGACY_IMPORT = 'false';
    const { importer, bootstrap } = make(async () => ({}));
    await bootstrap.onApplicationBootstrap();
    expect(importer.run).not.toHaveBeenCalled();
  });

  it('logs a failure instead of stopping the server', async () => {
    const { bootstrap } = make(async () => {
      throw new Error('boom');
    });
    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
