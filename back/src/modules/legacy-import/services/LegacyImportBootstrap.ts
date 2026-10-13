/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { LegacyImportService } from './LegacyImportService';

/**
 * Runs the import at startup. `LEGACY_IMPORT=false` turns it off. A failure is logged and does not stop the server:
 * the transaction rolled back, nothing was marked, and the next start tries again.
 */
@Injectable()
export class LegacyImportBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegacyImportBootstrap.name);

  constructor(private readonly importer: LegacyImportService) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((process.env.LEGACY_IMPORT ?? 'true').toLowerCase() === 'false') return;
    try {
      const report = await this.importer.run();
      if (report.status !== 'no-source' && report.status !== 'already-imported') {
        this.logger.log(`Legacy import (${report.status}): ${JSON.stringify(report.counts)}`);
      }
    } catch (error) {
      this.logger.error(`Legacy import failed, will retry at next start: ${(error as Error).message}`);
    }
  }
}
