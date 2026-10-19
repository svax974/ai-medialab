/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger } from '@nestjs/common';
import { resolve } from 'path';
import { unlink } from 'fs/promises';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import { AssetDto } from '../dto/AssetDto';
import { AssetEntity, AssetKind } from '../entities/AssetEntity';
import { newId } from '../utils/ids';
import { AssetService } from './AssetService';

export interface UploadedFile {
  /** Where the raw upload was written (inside `<data>/uploads`). */
  path: string;
  originalName: string;
  mimeType: string;
}

export interface IngestOptions {
  /** `'upload'` (default): a reference the user attached. `'generated'`: a result produced outside the usual
   * generation job (e.g. a diagram rendered client-side, see `modules/diagrams`) — same decode/thumbnail step,
   * stored like any other generated asset (gallery, message link). */
  kind?: AssetKind;
  messageId?: string;
  conversationId?: string;
  meta?: Record<string, unknown>;
}

/** Ingestion of uploads and removal of files: the files and thumbnails belong to the engine, the rows to Nest. */
@Injectable()
export class AssetFileService {
  private readonly logger = new Logger(AssetFileService.name);

  constructor(
    private readonly assets: AssetService,
    private readonly engine: EngineClient,
  ) {}

  /** The engine decodes the file and makes the thumbnail (it consumes `path`); Nest stores the row. 422 when unreadable. */
  async ingest(file: UploadedFile, options: IngestOptions = {}): Promise<AssetDto> {
    const id = newId();
    try {
      const stored = await this.engine.post('/engine/v1/media/ingest', {
        body: { source_path: resolve(file.path), asset_id: id, original_name: file.originalName, content_type: file.mimeType },
        timeoutMs: 300_000,
      });
      return await this.assets.create({
        id, kind: options.kind ?? 'upload', media: stored.media, filename: stored.filename, thumb: stored.thumb,
        originalName: file.originalName, width: stored.width ?? null, height: stored.height ?? null,
        duration: stored.duration ?? null, meta: { ...(stored.meta ?? {}), ...options.meta },
        messageId: options.messageId, conversationId: options.conversationId,
      });
    } catch (error) {
      await unlink(file.path).catch(() => undefined); // the engine removes it itself once it has read it
      throw engineErrorToHttp(error);
    }
  }

  /**
   * Deletes assets that nothing references any more (rows, then files and thumbnails through the engine); one that a
   * remaining message still uses as reference only loses its link to the message. Call after the related messages
   * or conversations were deleted. Files left behind by an unreachable engine are logged, never an error.
   */
  async purge(assets: AssetEntity[]): Promise<void> {
    const removed = await this.assets.purge(assets);
    await this.removeFiles(removed);
  }

  async removeFiles(assets: AssetEntity[]): Promise<void> {
    if (!assets.length) return;
    const files = assets.map((a) => ({ folder: a.kind === 'upload' ? ('uploads' as const) : ('outputs' as const), filename: a.filename, thumb: a.thumb }));
    try {
      await this.engine.post('/engine/v1/media/purge', { body: { files }, timeoutMs: 60_000 });
    } catch (error) {
      this.logger.warn(`files of ${assets.length} asset(s) not removed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
