/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { execFile } from 'child_process';
import { basename, join } from 'path';
import { promisify } from 'util';
import { BadGatewayException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { tr } from 'src/modules/i18n';
import { assetFilePath, studioDataDir } from '../utils/dataDir';
import { isShareService, sharePlan, type ShareCommand, type ShareOutcome } from '../utils/shareCommands';
import { AssetExportService, isExportPreset } from './AssetExportService';
import { AssetService } from './AssetService';

const run = promisify(execFile);
const TIMEOUT_MS = 15_000;

export interface AssetShareBody {
  service?: unknown;
  /** Light copy of a video to send instead of the original (`light`, `tiny`, `gif`, `gif-tiny`). */
  preset?: unknown;
  text?: unknown;
  subject?: unknown;
}

export interface AssetShareDto {
  outcome: ShareOutcome;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 2000) : '');

/**
 * Sends a produced file to Mail, WhatsApp, Messages, X, Facebook or Instagram by opening the application of this
 * computer (single-user local app: the server and the person share the machine). See `utils/shareCommands.ts`.
 */
@Injectable()
export class AssetShareService {
  constructor(
    private readonly assets: AssetService,
    private readonly exports: AssetExportService,
  ) {}

  /** Replaced in tests: the system and the way a command is run. */
  platform: NodeJS.Platform = process.platform;
  exec: (command: ShareCommand) => Promise<unknown> = ({ file, args }) => run(file, args, { timeout: TIMEOUT_MS });

  async share(id: string, body: AssetShareBody): Promise<AssetShareDto> {
    if (!isShareService(body?.service)) throw new UnprocessableEntityException(tr('mediaLibrary.error.shareService'));
    const path = await this.filePath(id, body.preset);
    const plan = sharePlan(body.service, this.platform, { path, text: asText(body.text), subject: asText(body.subject) });
    for (const alternatives of plan.steps) await this.firstThatWorks(alternatives);
    return { outcome: plan.outcome };
  }

  private async filePath(id: string, preset: unknown): Promise<string> {
    const asset = await this.assets.getEntity(id);
    if (!asset) throw new NotFoundException(tr('mediaLibrary.error.imageNotFound'));
    if (preset === undefined) return assetFilePath(asset.kind, asset.filename);
    if (!isExportPreset(preset)) throw new UnprocessableEntityException(tr('mediaLibrary.error.exportPreset'));
    const copy = await this.exports.exportVideo(id, preset);
    return join(studioDataDir(), 'exports', basename(copy.url));
  }

  private async firstThatWorks(alternatives: ShareCommand[]): Promise<void> {
    let failure: unknown;
    for (const command of alternatives) {
      try {
        await this.exec(command);
        return;
      } catch (error) {
        failure = error;
      }
    }
    throw new BadGatewayException(tr('mediaLibrary.error.shareFailed', [failure instanceof Error ? failure.message : String(failure)]));
  }
}
