/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import type { EngineSchemas } from 'src/modules/engine';

export type JobKind = EngineSchemas['schemas']['JobSubmit']['kind'];
export type EngineJobSubmit = EngineSchemas['schemas']['JobSubmit'];
export type EngineJobState = EngineSchemas['schemas']['JobState'];
export type EngineJobOutput = EngineSchemas['schemas']['JobOutput'];
export type EngineJobCheck = EngineSchemas['schemas']['JobCheck'];

/** A generation waiting for, or holding, the engine: the assistant message and what the engine needs to know. */
export interface QueueEntry {
  messageId: string;
  conversationId: string;
  kind: JobKind;
  /** The message was switched to `running` (the first `job.progress` with that phase did it). */
  running: boolean;
  /** The engine accepted the job (until then there is nothing to cancel on its side). */
  submitted: boolean;
  /** Cancellation asked before the engine had the job: applied right after the submission. */
  cancelRequested: boolean;
}

/** Events of a job as the engine publishes them (`job.<name>`), all carrying `job_id`. */
export interface JobEventData {
  job_id: string;
  [key: string]: unknown;
}

export const JOB_TERMINAL_EVENTS = ['job.done', 'job.failed', 'job.cancelled'] as const;
/** Texts stored on a failed message, in the language of the interface at the time of the failure. */
export const interruptedByEngine = (): string => tr('studioCore.job.interruptedByEngine');
export const engineUnreachable = (): string => tr('studioCore.job.engineUnreachable');

/** What `POST /api/messages` takes (validated by `parseCreateMessage`). */
export interface CreateGenerationInput {
  conversationId: string | null;
  prompt: string;
  modelId: string;
  params: Record<string, unknown>;
  referenceIds: string[];
  count: number;
}

export interface RetryInput {
  modelId?: string;
  params?: Record<string, unknown>;
  keepSeed: boolean;
}
