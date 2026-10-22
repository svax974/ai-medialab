/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { ConflictException, Injectable } from '@nestjs/common';
import { resolve } from 'path';
import { unlink } from 'fs/promises';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import { newId, type AssetDto } from 'src/modules/media-library';
import { PrivateSessionService } from './PrivateSessionService';
import { PrivateStore } from './PrivateStore';
import { sessionPath } from './privateFiles';

export interface PrivateUploadedFile {
  /** Where multer wrote the raw upload (`<session>/tmp`). */
  path: string;
  originalName: string;
  mimeType: string;
}

/** References of a private generation: the engine decodes the file into the session folder, the row stays in memory. */
@Injectable()
export class PrivateUploadService {
  constructor(
    private readonly session: PrivateSessionService,
    private readonly store: PrivateStore,
    private readonly engine: EngineClient,
  ) {}

  async ingest(file: PrivateUploadedFile): Promise<AssetDto> {
    this.session.touch();
    if (!this.session.active) {
      await unlink(file.path).catch(() => undefined);
      throw new ConflictException(tr('private.error.noSession'));
    }
    const id = newId();
    try {
      const stored = await this.engine.post('/engine/v1/media/ingest', {
        body: {
          source_path: resolve(file.path), asset_id: id, original_name: file.originalName, content_type: file.mimeType,
          private_dir: sessionPath(this.session.sessionId),
        },
        timeoutMs: 300_000,
      });
      const asset = this.store.addAsset({
        id, kind: 'upload', media: stored.media, filename: stored.filename, thumb: stored.thumb, originalName: file.originalName,
        width: stored.width ?? null, height: stored.height ?? null, duration: stored.duration ?? null, seed: null, position: 0,
        meta: stored.meta ?? {}, conversationId: null, messageId: null,
      });
      return this.store.assetDto(asset);
    } catch (error) {
      await unlink(file.path).catch(() => undefined); // the engine removes it itself once it has read it
      throw engineErrorToHttp(error);
    }
  }
}
