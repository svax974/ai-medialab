/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { CreateAssetInput } from 'src/modules/media-library';
import type { EngineJobOutput } from '../types/jobTypes';

/** Progress of a job as the browser knew it from the legacy SSE: latest value of each field, keyed by message. */
export type ProgressState = Record<string, unknown>;

/** Merges a `job.progress` or `job.preview` payload into the state of its message (`job_id` is the engine's key, dropped). */
export function mergeProgress(state: ProgressState | undefined, payload: Record<string, unknown>): ProgressState {
  const { job_id: _jobId, ...fields } = payload;
  return { ...(state ?? {}), ...fields };
}

/** A `job.preview` payload as a progress update: only its URL matters to the browser. */
export function previewToProgress(payload: Record<string, unknown>): Record<string, unknown> {
  return { preview_url: payload.url ?? null };
}

/** Browser payload of `job.progress`: the legacy shape (`message_id`, `conversation_id` and the progress fields). */
export function toBrowserProgress(messageId: string, conversationId: string, state: ProgressState): Record<string, unknown> {
  return { message_id: messageId, conversation_id: conversationId, ...state };
}

/** The asset row to store for a file a job produced (`job.output`). Position is the index in the batch. */
export function outputToAssetInput(output: EngineJobOutput, conversationId: string, messageId: string): CreateAssetInput {
  return {
    id: output.asset_id,
    kind: 'generated',
    media: output.media,
    filename: output.filename,
    thumb: output.thumb ?? null,
    conversationId,
    messageId,
    width: output.width ?? null,
    height: output.height ?? null,
    seed: output.seed ?? null,
    duration: output.duration ?? null,
    position: output.index,
    meta: output.meta ?? {},
  };
}
