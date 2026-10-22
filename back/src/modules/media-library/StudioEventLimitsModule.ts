/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Global, Module } from '@nestjs/common';
import { EVENT_STREAM_OPTIONS, type EventStreamOptions } from 'src/modules_shared/common/event-stream';

/**
 * Largest event the browser stream carries in this app. The shared default (16 KB) protects multi-user servers from
 * oversized payloads; here every event is produced by our own server for one local user. A finished audio message
 * (up to 4 takes, each with 240 waveform peaks, one marker per speaker turn and the prompt) measures ~8 KB for a short text, ~33 KB for a
 * 40-turn dialogue and ~105 KB for an 8000-character text (`AudioGeneration.spec.ts`), which the default would silently drop. 256 KB covers the
 * worst case with margin; the replay buffer keeps its default size (events are mostly a few hundred bytes).
 */
export const STUDIO_MAX_EVENT_BYTES = 256 * 1024;

export const STUDIO_EVENT_STREAM_OPTIONS: EventStreamOptions = { maxEventBytes: STUDIO_MAX_EVENT_BYTES };

/**
 * Provides `EVENT_STREAM_OPTIONS` to the shared `EventStreamService` (declared in `CommonModule`, which can only see
 * the providers of its own imports and of global modules, hence `@Global()`).
 */
@Global()
@Module({
  providers: [{ provide: EVENT_STREAM_OPTIONS, useValue: STUDIO_EVENT_STREAM_OPTIONS }],
  exports: [EVENT_STREAM_OPTIONS],
})
export class StudioEventLimitsModule {}
