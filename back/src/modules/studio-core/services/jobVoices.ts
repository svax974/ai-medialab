/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { join } from 'path';
import type { VoiceEntity } from 'src/modules/audio-studio';
import { uploadsDir } from 'src/modules/media-library';
import type { EngineJobSubmit } from '../types/jobTypes';

type VoiceRef = { source?: unknown; id?: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function libraryId(ref: unknown): string | null {
  const { source, id } = isRecord(ref) ? (ref as VoiceRef) : {};
  return source === 'library' && typeof id === 'string' && id ? id : null;
}

/** Ids of the library voices an audio generation uses: the default voice (`params.voice`) and the cast of a dialogue (`params.cast`). */
export function libraryVoiceIds(params: Record<string, unknown>): string[] {
  const cast = isRecord(params.cast) ? Object.values(params.cast) : [];
  return [...new Set([params.voice, ...cast].map(libraryId).filter((id): id is string => id !== null))];
}

/**
 * The `voices` of a job: for each library voice the generation uses, its reference clip (absolute path in the data
 * folder), transcript and name. A voice that was deleted is absent: the engine then says "Cette voix n'existe plus".
 */
export function jobVoices(rows: VoiceEntity[]): NonNullable<EngineJobSubmit['voices']> {
  const voices: NonNullable<EngineJobSubmit['voices']> = {};
  for (const row of rows) {
    if (row.filename) voices[row.id] = { path: join(uploadsDir(), row.filename), transcript: row.transcript ?? '', name: row.name };
  }
  return voices;
}
