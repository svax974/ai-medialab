/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { Injectable } from '@nestjs/common';
import { EngineClient, EngineUnavailableError, SseParser, type EngineSchemas } from 'src/modules/engine';
import { ChatError, type ChatErrorCode } from '../types/chatTypes';

/** Body of `POST /engine/v1/llm/chat`, typed from the engine's OpenAPI schema. */
/** `private`: a reply of the private session (the engine then leaves no log line about the model); the caller may leave it out. */
export type LlmChatRequest = Omit<EngineSchemas['schemas']['ChatBody'], 'private' | 'force_memory'> & { private?: boolean; force_memory?: boolean };

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
  tokens_per_second: number | null;
  prompt_ms?: number;
  predicted_ms?: number;
  context_size: number | null;
}

/** The events of the engine's reply stream (`engine/app/api/llm.py`), each with its `type`. */
export type LlmEvent =
  | { type: 'loading'; phase: 'starting' | 'loading' | 'ready'; model_id: string; elapsed_s?: number }
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_calls'; calls: LlmToolCall[] }
  | ({ type: 'usage' } & LlmUsage)
  | { type: 'done'; finish_reason: 'stop' | 'length' | 'tool_calls' }
  | { type: 'error'; code: ChatErrorCode; message: string; n_prompt_tokens?: number; n_ctx?: number };

const ENGINE_CODES: ChatErrorCode[] = ['refused', 'busy', 'context_exceeded', 'upstream', 'closed', 'memory'];

/**
 * A refusal the engine sends before any byte of the stream (plain HTTP status), as a chat error. The engine words its detail in
 * the interface language, so the patterns below know both.
 */
export function refusalFromHttp(status: number, detail: string): ChatError {
  if (status === 404) return new ChatError('no_model', detail || tr('chat.error.engineUnknownModel'));
  if (status === 409) {
    if (/pas install|not installed/i.test(detail) && /llama\.cpp|moteur de chat|chat engine/i.test(detail)) return new ChatError('no_engine', detail);
    if (/téléchargé|introuvable|downloaded|not found/i.test(detail)) return new ChatError('no_model', detail);
    return new ChatError('busy', detail || tr('chat.error.engineBusy'));
  }
  if (status === 422) return new ChatError('refused', detail || tr('chat.error.engineRefused'));
  return new ChatError('upstream', detail || tr('chat.error.engineStatus', [status]));
}

const detailOf = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    return parsed.detail === undefined ? text : JSON.stringify(parsed.detail);
  } catch {
    return text;
  }
};

/**
 * Streaming client of the engine's chat route. `EngineClient` reads whole JSON answers; a reply is a server-sent event
 * stream that can last minutes, so it has its own `fetch` (same URL and shared secret, no timeout, cancelled by the
 * caller's `AbortSignal`: aborting stops the generation in the engine and leaves the model loaded).
 */
@Injectable()
export class EngineLlmClient {
  constructor(private readonly engine: EngineClient) {}

  /**
   * Yields the events of one reply. Refusals before the first byte throw a `ChatError`; an engine error event is
   * yielded as it comes; a stream that ends without `done` or `error` yields `error closed`. Aborting throws `AbortError`.
   */
  async *chat(body: LlmChatRequest, signal?: AbortSignal): AsyncGenerator<LlmEvent> {
    const res = await this.open(body, signal);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let ended = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          const event = this.parse(frame.data);
          if (!event) continue;
          yield event;
          if (event.type === 'done' || event.type === 'error') {
            ended = true;
            return;
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (!ended) yield { type: 'error', code: 'closed', message: tr('chat.error.engineClosed') };
  }

  /** One reply as a whole (titles, prompt enhancement): the text, or a `ChatError`. */
  async complete(body: LlmChatRequest, signal?: AbortSignal): Promise<{ content: string; usage: LlmUsage | null }> {
    let content = '';
    let usage: LlmUsage | null = null;
    for await (const event of this.chat(body, signal)) {
      if (event.type === 'delta') content += event.content;
      else if (event.type === 'usage') usage = event;
      else if (event.type === 'error') throw new ChatError(event.code, event.message);
    }
    return { content, usage };
  }

  private async open(body: LlmChatRequest, signal?: AbortSignal): Promise<Response> {
    const path = '/engine/v1/llm/chat';
    let res: Response;
    try {
      res = await fetch(this.engine.buildUrl(path), {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...this.engine.authHeaders() },
        body: JSON.stringify({ private: false, ...body }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChatError('upstream', new EngineUnavailableError(path, error).message);
    }
    if (!res.ok || !res.body) throw refusalFromHttp(res.status, detailOf(await res.text().catch(() => '')));
    return res;
  }

  private parse(data: string): LlmEvent | null {
    let event: { type?: string };
    try {
      event = JSON.parse(data) as { type?: string };
    } catch {
      return null;
    }
    if (event.type === 'error') {
      const code = (event as { code?: string }).code as ChatErrorCode;
      return { ...(event as object), code: ENGINE_CODES.includes(code) ? code : 'upstream' } as LlmEvent;
    }
    return typeof event.type === 'string' ? (event as LlmEvent) : null;
  }
}
