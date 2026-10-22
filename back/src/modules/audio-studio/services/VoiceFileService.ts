/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import { assetFilePath, AssetService, newId, StudioEvents, uploadsDir, type UploadedFile } from 'src/modules/media-library';
import { VoiceDto } from '../dto/VoiceDto';
import { VoiceTranscriptionDto } from '../dto/VoiceTranscriptionDto';
import {
  defaultSavedVoiceName, defaultUploadedVoiceName, MAX_TRANSCRIPT_LENGTH, type TranscribeVoiceInput,
  type UpdateVoiceInput, type UploadVoiceInput, type VoiceFromAssetInput,
} from '../types/voiceTypes';
import { VoiceService } from './VoiceService';

const stemOf = (name: string): string => name.replace(/\.[^.]*$/, '');
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The voice library with its files: the engine turns an audio file into a 24 kHz reference clip (and transcribes it),
 * Nest keeps the row and removes the file. Every change publishes `studio.voices.changed`.
 */
@Injectable()
export class VoiceFileService {
  private readonly logger = new Logger(VoiceFileService.name);

  constructor(
    private readonly voices: VoiceService,
    private readonly assets: AssetService,
    private readonly engine: EngineClient,
    private readonly events: StudioEvents,
  ) {}

  /** A cloning sample (or a designed voice's clip) sent by the user. The raw upload is always removed. */
  async createFromUpload(file: UploadedFile, input: UploadVoiceInput): Promise<VoiceDto> {
    try {
      return await this.store(file.path, {
        ...input,
        name: input.name || stemOf(file.originalName) || defaultUploadedVoiceName(),
      });
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  /** Keeps a generated take as a library voice; what the user left empty comes from the take's metadata. 404 if not an audio take. */
  async createFromAsset(input: VoiceFromAssetInput): Promise<VoiceDto> {
    const asset = await this.assets.getEntity(input.assetId);
    if (!asset || asset.media !== 'audio') throw new NotFoundException(tr('audioStudio.error.takeNotFound'));
    const meta = asset.meta ?? {};
    return this.store(assetFilePath(asset.kind, asset.filename), {
      name: input.name || text(meta.voice) || defaultSavedVoiceName(),
      kind: input.kind,
      transcript: input.transcript || text(meta.prompt).slice(0, MAX_TRANSCRIPT_LENGTH),
      description: input.description || text(meta.instruct),
      language: input.language || text(meta.language) || null,
    });
  }

  /** `null` when the voice does not exist. */
  async update(id: string, input: UpdateVoiceInput): Promise<VoiceDto | null> {
    const voice = await this.voices.update(id, input);
    if (voice) this.events.publish('voices.changed', {});
    return voice;
  }

  /** Deletes the row, then the sample file through the engine; `false` when the voice does not exist. */
  async remove(id: string): Promise<boolean> {
    const voice = await this.voices.remove(id);
    if (!voice) return false;
    if (voice.filename) {
      await this.engine
        .post('/engine/v1/media/purge', { body: { files: [{ folder: 'uploads', filename: voice.filename }] }, timeoutMs: 60_000 })
        .catch((error) => this.logger.warn(`sample of voice ${id} not removed: ${error instanceof Error ? error.message : String(error)}`));
    }
    this.events.publish('voices.changed', {});
    return true;
  }

  /** A suggested transcript computed by the engine (nothing is stored); 404 unknown voice, 409 no transcription model installed. */
  async transcribe(id: string, input: TranscribeVoiceInput): Promise<VoiceTranscriptionDto> {
    const voice = await this.voices.get(id);
    if (!voice?.url) throw new NotFoundException(tr('audioStudio.error.voiceNotFound'));
    const filename = voice.url.slice(voice.url.lastIndexOf('/') + 1);
    try {
      return await this.engine.post('/engine/v1/media/transcribe', {
        body: { path: resolve(join(uploadsDir(), filename)), language: input.language ?? voice.language, model_id: input.modelId },
        timeoutMs: 600_000,
      });
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }

  private async store(sourcePath: string, input: UploadVoiceInput & { kind: UploadVoiceInput['kind'] }): Promise<VoiceDto> {
    const id = newId();
    let prepared: { filename: string; duration: number; peaks: number[] };
    try {
      prepared = await this.engine.post('/engine/v1/media/voice-reference', {
        body: { source_path: resolve(sourcePath), voice_id: id },
        timeoutMs: 120_000,
      });
    } catch (error) {
      throw engineErrorToHttp(error);
    }
    try {
      const voice = await this.voices.create({ ...input, id, filename: prepared.filename, duration: prepared.duration, peaks: prepared.peaks });
      this.events.publish('voices.changed', {});
      return voice;
    } catch (error) {
      await this.engine.post('/engine/v1/media/purge', { body: { files: [{ folder: 'uploads', filename: prepared.filename }] } }).catch(() => undefined);
      throw error;
    }
  }
}
