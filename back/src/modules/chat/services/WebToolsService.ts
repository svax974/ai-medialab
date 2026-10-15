/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { throttledFetchJson } from 'src/modules_shared/common/utils/throttledFetch';
import { SettingsService } from 'src/modules/settings';
import { htmlToText, titleOf } from '../tools/htmlText';
import { fetchPublicPage, type FetchedPage } from '../tools/safeFetch';
import { assertPublicUrl, SsrfBlockedError } from '../tools/ssrfGuard';
import { parseBrave, parseDuckDuckGo, type SearchHit } from '../tools/webSearch';
import type { LlmToolCall } from './EngineLlmClient';
import type { ToolRun } from '../types/chatTypes';

/** Functions the tools run through: replaced by fakes in tests. */
export interface WebToolDeps {
  fetchPage: (url: string, signal?: AbortSignal) => Promise<FetchedPage>;
  /** The Brave Search key ('' when none). */
  braveKey: () => Promise<string>;
  /** Transport of the DuckDuckGo form post (default: `fetch`). */
  duckTransport?: (query: string) => SearchTransport;
  /** Transport of the Brave API call (default: `fetch` with the key as the subscription header). */
  braveTransport?: (key: string) => SearchTransport;
}

type SearchTransport = (url: string, signal: AbortSignal) => Promise<{ status: number; body: unknown; retryAfter?: string | null }>;

export const WEB_TOOL_DEPS = Symbol('WEB_TOOL_DEPS');

/** What the chat gives the model: the schemas (OpenAI function calling) of the two tools. */
export const WEB_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: "Cherche sur le Web (pages récentes, actualités, documentation). Renvoie une liste de résultats avec titre, adresse et extrait. À utiliser quand la réponse dépend d'informations récentes ou que tu n'es pas sûr.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Requête de recherche, courte et précise.' }, count: { type: 'integer', minimum: 1, maximum: 10, description: 'Nombre de résultats (5 par défaut).' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: "Lit le texte d'une page Web publique (adresse http ou https) trouvée par une recherche ou donnée par l'utilisateur.",
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'Adresse complète de la page.' } }, required: ['url'] },
    },
  },
] as const;

const MAX_QUERY_CHARS = 300;
const MAX_URL_CHARS = 2000;
const MAX_PAGE_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 12_000;
const SEARCH_TIMEOUT_MS = 10_000;
const DUCK_URL = 'https://html.duckduckgo.com/html/';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export interface ToolOutcome {
  /** The run as the browser shows it. */
  run: ToolRun;
  /** What the model reads back (the `tool` message). */
  content: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The chat's web tools: `web_search` (DuckDuckGo without a key, Brave Search when a key is set in the settings) and
 * `fetch_url` (a public page as text, behind the SSRF guard). Every outgoing call goes through `throttledFetchJson`
 * (spacing, backoff, never throws); failures come back as an error run whose text the model can read and repeat.
 */
@Injectable()
export class WebToolsService {
  private readonly logger = new Logger(WebToolsService.name);
  private readonly deps: WebToolDeps;

  constructor(settings: SettingsService, @Optional() @Inject(WEB_TOOL_DEPS) deps?: WebToolDeps) {
    this.deps = deps ?? {
      fetchPage: (url, signal) => fetchPublicPage(url, { signal }),
      braveKey: () => settings.braveApiKey().catch(() => ''),
    };
  }

  /** The run shown while the tool works (its arguments are the ones the model sent, bounded). */
  begin(call: LlmToolCall): ToolRun {
    const name = call.function.name === 'fetch_url' ? 'fetch_url' : 'web_search';
    return { id: call.id, name, arguments: this.safeArguments(call), status: 'running' };
  }

  async run(call: LlmToolCall, signal?: AbortSignal): Promise<ToolOutcome> {
    const run = this.begin(call);
    try {
      if (call.function.name === 'web_search') return await this.search(run, signal);
      if (call.function.name === 'fetch_url') return await this.fetch(run, signal);
      return this.failed(run, `Outil inconnu : ${call.function.name}.`);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn(`tool ${call.function.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.failed(run, error instanceof SsrfBlockedError ? `Adresse refusée : ${error.message}` : error instanceof Error ? error.message : 'Échec.');
    }
  }

  private safeArguments(call: LlmToolCall): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.function.arguments || '{}');
    } catch {
      return {};
    }
    if (!isRecord(parsed)) return {};
    const out: Record<string, unknown> = {};
    if (typeof parsed.query === 'string') out.query = parsed.query.slice(0, MAX_QUERY_CHARS);
    if (typeof parsed.count === 'number') out.count = parsed.count;
    if (typeof parsed.url === 'string') out.url = parsed.url.slice(0, MAX_URL_CHARS);
    return out;
  }

  private failed(run: ToolRun, message: string): ToolOutcome {
    return { run: { ...run, status: 'error', result_preview: message }, content: `Erreur : ${message}` };
  }

  private async search(run: ToolRun, signal?: AbortSignal): Promise<ToolOutcome> {
    const query = typeof run.arguments.query === 'string' ? run.arguments.query.trim() : '';
    if (!query) return this.failed(run, 'La requête de recherche est vide.');
    const raw = Number(run.arguments.count);
    const count = Number.isInteger(raw) ? Math.min(10, Math.max(1, raw)) : 5;
    const key = await this.deps.braveKey();
    const provider = key ? 'Brave' : 'DuckDuckGo';
    const hits = key ? await this.brave(query, count, key) : await this.duck(query, count);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (hits === null) return this.failed({ ...run, arguments: { query, count } }, `${provider} n'a pas répondu (limite de débit, blocage ou réseau) : réessayez plus tard.`);
    const lines = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`.trimEnd());
    return {
      run: { ...run, arguments: { query, count }, status: 'done', result_preview: `${provider} : ${hits.length} résultat${hits.length > 1 ? 's' : ''}`, sources: hits.map((h) => ({ title: h.title, url: h.url })) },
      content: hits.length ? lines.join('\n') : 'Aucun résultat.',
    };
  }

  private async brave(query: string, count: number, key: string): Promise<SearchHit[] | null> {
    const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(count) })}`;
    const transport = this.deps.braveTransport?.(key);
    const result = await throttledFetchJson<unknown>('chat-brave', url, {
      timeoutMs: SEARCH_TIMEOUT_MS, maxRetries: 1, minIntervalMs: 1000,
      ...(transport ? { transport } : { init: { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } } }),
    });
    return result.data === null ? null : parseBrave(result.data, count);
  }

  private async duck(query: string, count: number): Promise<SearchHit[] | null> {
    const transport = this.deps.duckTransport?.(query) ?? duckTransport(query);
    const result = await throttledFetchJson<string>('chat-duckduckgo', DUCK_URL, { timeoutMs: SEARCH_TIMEOUT_MS, maxRetries: 1, minIntervalMs: 1500, transport });
    return result.data === null ? null : parseDuckDuckGo(String(result.data), count);
  }

  private async fetch(run: ToolRun, signal?: AbortSignal): Promise<ToolOutcome> {
    const raw = typeof run.arguments.url === 'string' ? run.arguments.url.trim() : '';
    const url = assertPublicUrl(raw).toString(); // refused here with a reason the model can read
    let failure: unknown = null;
    const result = await throttledFetchJson<FetchedPage>('chat-fetch-url', url, {
      timeoutMs: FETCH_TIMEOUT_MS, maxRetries: 0, minIntervalMs: 500,
      transport: async (target, transportSignal) => {
        try {
          const page = await this.deps.fetchPage(target, AbortSignal.any([transportSignal, ...(signal ? [signal] : [])]));
          return { status: page.status, body: page };
        } catch (error) {
          failure = error;
          throw error;
        }
      },
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!result.data) {
      if (failure instanceof Error) throw failure;
      return this.failed(run, `La page a répondu ${result.status || 'rien'} : lecture impossible.`);
    }
    const page = result.data;
    const html = /html|xml/i.test(page.contentType) || /^\s*</.test(page.body);
    const { text, truncated } = html ? htmlToText(page.body, MAX_PAGE_CHARS) : { text: page.body.slice(0, MAX_PAGE_CHARS), truncated: page.body.length > MAX_PAGE_CHARS };
    const title = html ? titleOf(page.body) : '';
    return {
      run: { ...run, status: 'done', result_preview: `${title || page.url} — ${text.length} caractères${truncated ? ' (coupé)' : ''}`, sources: [{ title: title || page.url, url: page.url }] },
      content: `Page : ${page.url}\n${title ? `Titre : ${title}\n` : ''}\n${text}`,
    };
  }
}

function duckTransport(query: string) {
  return async (url: string, signal: AbortSignal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, 'Accept-Language': 'fr,en;q=0.8' },
      body: new URLSearchParams({ q: query, kl: 'wt-wt' }).toString(),
      signal,
    });
    return { status: res.status, body: await res.text(), retryAfter: res.headers.get('retry-after') };
  };
}
