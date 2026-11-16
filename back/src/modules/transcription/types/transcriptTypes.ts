/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

export type TranscriptStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type TranscriptStage = TranscriptStatus | 'downloading' | 'preparing' | 'transcribing';

export type { TranscriptDto } from '../dto/TranscriptDto';
export type { TranscriptDetailDto } from '../dto/TranscriptDetailDto';

export interface TranscriptInput {
  url?: string;
  filePath?: string;
  originalName?: string;
  modelId?: string;
  language: string | null;
}

export type TranscriptEvent =
  | { type: 'heartbeat' }
  | { type: 'progress'; stage: 'downloading' | 'preparing'; done: number; total: number }
  | { type: 'prepared'; duration: number; chunks: number; title: string }
  | { type: 'segment'; index: number; text: string; language: string | null; done: number }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: string };
