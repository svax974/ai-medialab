/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { newId, nowSeconds } from 'src/modules/media-library';
import { VoiceDto } from '../dto/VoiceDto';
import { VoiceEntity } from '../entities/VoiceEntity';
import { toVoiceDto } from '../mappers/voiceMapper';
import { CreateVoiceInput, DEFAULT_VOICE_NAME, MAX_VOICE_NAME_LENGTH, UpdateVoiceInput } from '../types/voiceTypes';

/** Reads and writes the voice library. Writing the sample file and transcribing are the engine's job (H4.5). */
@Injectable()
export class VoiceService {
  constructor(@InjectRepository(VoiceEntity) private readonly voices: Repository<VoiceEntity>) {}

  /** Newest first. */
  async list(): Promise<VoiceDto[]> {
    return (await this.voices.find({ order: { createdAt: 'DESC' } })).map(toVoiceDto);
  }

  async get(id: string): Promise<VoiceDto | null> {
    const voice = await this.voices.findOneBy({ id });
    return voice ? toVoiceDto(voice) : null;
  }

  async create(input: CreateVoiceInput): Promise<VoiceDto> {
    const voice = await this.voices.save(
      this.voices.create({
        id: newId(),
        name: input.name.trim().slice(0, MAX_VOICE_NAME_LENGTH) || DEFAULT_VOICE_NAME,
        kind: input.kind,
        filename: input.filename ?? null,
        transcript: (input.transcript ?? '').trim(),
        description: (input.description ?? '').trim(),
        language: input.language ?? null,
        duration: input.duration ?? null,
        peaks: input.peaks ?? [],
        createdAt: nowSeconds(),
      }),
    );
    return toVoiceDto(voice);
  }

  /** `null` when the voice does not exist. */
  async update(id: string, input: UpdateVoiceInput): Promise<VoiceDto | null> {
    const fields: Partial<VoiceEntity> = {};
    if (input.name !== undefined) {
      fields.name = input.name.trim().slice(0, MAX_VOICE_NAME_LENGTH) || DEFAULT_VOICE_NAME;
    }
    if (input.transcript !== undefined) fields.transcript = input.transcript;
    if (input.description !== undefined) fields.description = input.description;
    if (input.language !== undefined) fields.language = input.language;
    if (Object.keys(fields).length) await this.voices.update({ id }, fields);
    return this.get(id);
  }

  /** Deletes the row and returns it (so the caller can remove the sample file), `null` if unknown. */
  async remove(id: string): Promise<VoiceEntity | null> {
    const voice = await this.voices.findOneBy({ id });
    if (!voice) return null;
    await this.voices.delete({ id });
    return voice;
  }
}
