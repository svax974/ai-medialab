/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import type { TranscriptStatus, TranscriptStage } from '../types/transcriptTypes';

export interface TranscriptDto {
  id: string;
  title: string;
  source_kind: 'file' | 'youtube';
  source_url: string | null;
  model_id: string;
  model_name: string;
  language: string | null;
  status: TranscriptStatus;
  stage: TranscriptStage;
  progress: number | null;
  duration: number;
  processed_seconds: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}
