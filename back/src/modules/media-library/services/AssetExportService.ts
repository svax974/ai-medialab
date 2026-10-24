/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { tr } from 'src/modules/i18n';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import { assetFilePath } from '../utils/dataDir';
import { AssetService } from './AssetService';

/** Weights of a video made to be sent: shorter side in pixels and images per second at most. */
export const EXPORT_PRESETS = {
  light: { shortSide: 360, maxFps: 15 },
  tiny: { shortSide: 240, maxFps: 12 },
} as const;

export type ExportPreset = keyof typeof EXPORT_PRESETS;

export interface AssetExportDto {
  /** Browser URL of the copy (`/media/exports/<file>`, like the asset URLs). */
  url: string;
  width: number;
  height: number;
  fps: number;
  bytes: number;
}

export function isExportPreset(value: unknown): value is ExportPreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXPORT_PRESETS, value);
}

/** Lighter copies of produced videos (the engine converts, this service only picks the file and the weight). */
@Injectable()
export class AssetExportService {
  constructor(
    private readonly assets: AssetService,
    private readonly engine: EngineClient,
  ) {}

  async exportVideo(id: string, preset: unknown): Promise<AssetExportDto> {
    if (!isExportPreset(preset)) throw new UnprocessableEntityException(tr('mediaLibrary.error.exportPreset'));
    const asset = await this.assets.getEntity(id);
    if (!asset) throw new NotFoundException(tr('mediaLibrary.error.imageNotFound'));
    if (asset.media !== 'video') throw new UnprocessableEntityException(tr('mediaLibrary.error.exportOnlyVideo'));
    const { shortSide, maxFps } = EXPORT_PRESETS[preset];
    try {
      const copy = await this.engine.post('/engine/v1/media/video-export', {
        body: { source_path: assetFilePath(asset.kind, asset.filename), short_side: shortSide, max_fps: maxFps },
        timeoutMs: 300_000,
      });
      return { url: `/media/exports/${copy.filename}`, width: copy.width, height: copy.height, fps: copy.fps, bytes: copy.bytes };
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }
}
