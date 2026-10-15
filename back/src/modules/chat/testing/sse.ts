/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { ServerResponse } from 'http';
import type { LlmEvent } from '../services/EngineLlmClient';

/** One server-sent event frame of the engine's reply stream (`event:` + `data:` with the event's `type`). */
export const frame = (event: object): string => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`;

/** A reply as the engine would stream it: a loading event, the text pieces, the usage and the end. */
export const GOOD_REPLY: LlmEvent[] = [
  { type: 'loading', phase: 'starting', model_id: 'llm-a' },
  { type: 'reasoning', content: 'Je réfléchis.' },
  { type: 'delta', content: 'Bon' },
  { type: 'delta', content: 'jour' },
  { type: 'usage', prompt_tokens: 5, completion_tokens: 2, cached_tokens: 0, tokens_per_second: 41.5, prompt_ms: 10, predicted_ms: 48, context_size: 16384 },
  { type: 'done', finish_reason: 'stop' },
];

/** Answers with a complete event stream. */
export function streamEvents(res: ServerResponse, events: object[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(frame(e));
  res.end();
}

/** A parsed JSON payload read back in a test (event data, request bodies): shaped by the test, not by the code under test. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
