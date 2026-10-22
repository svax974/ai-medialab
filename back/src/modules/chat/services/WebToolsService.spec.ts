/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { resetThrottleBuckets } from 'src/modules_shared/common/utils/throttledFetch';
import { SsrfBlockedError } from '../tools/ssrfGuard';
import type { LlmToolCall } from './EngineLlmClient';
import { WEB_TOOL_SCHEMAS, WebToolsService, type WebToolDeps } from './WebToolsService';

const call = (name: string, args: unknown, id = 'call_1'): LlmToolCall => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

const DDG_PAGE = `<div class="result results_links web-result "><h2><a class="result__a" href="https://example.org/a">Exemple A</a></h2><a class="result__snippet" href="x">Extrait A</a></div>
<div class="result results_links web-result "><h2><a class="result__a" href="https://example.org/b">Exemple B</a></h2><a class="result__snippet" href="x">Extrait B</a></div>`;

function make(overrides: Partial<WebToolDeps> = {}) {
  const deps: WebToolDeps = {
    fetchPage: jest.fn(async (url: string) => ({ url, status: 200, contentType: 'text/html', body: '<html><head><title>Page test</title></head><body><p>Bonjour le monde</p></body></html>' })),
    braveKey: jest.fn(async () => ''),
    duckTransport: jest.fn(() => async () => ({ status: 200, body: DDG_PAGE })),
    braveTransport: jest.fn(() => async () => ({ status: 200, body: { web: { results: [{ title: 'Brave A', url: 'https://brave.example/a', description: 'desc' }] } } })),
    ...overrides,
  };
  return { deps, tools: new WebToolsService(undefined as never, deps) };
}

describe('WebToolsService', () => {
  beforeEach(() => resetThrottleBuckets());

  it('offers two OpenAI function schemas', () => {
    expect(WEB_TOOL_SCHEMAS.map((t) => t.function.name)).toEqual(['web_search', 'fetch_url']);
    expect(WEB_TOOL_SCHEMAS[0].function.parameters.required).toEqual(['query']);
  });

  it('web_search uses DuckDuckGo without a key and lists the sources', async () => {
    const { tools, deps } = make();
    const out = await tools.run(call('web_search', { query: ' llama.cpp  ', count: 3 }));
    expect(deps.duckTransport).toHaveBeenCalledWith('llama.cpp');
    expect(out.run).toMatchObject({ id: 'call_1', name: 'web_search', status: 'done', arguments: { query: 'llama.cpp', count: 3 }, result_preview: 'DuckDuckGo : 2 résultats' });
    expect(out.run.sources).toEqual([{ title: 'Exemple A', url: 'https://example.org/a' }, { title: 'Exemple B', url: 'https://example.org/b' }]);
    expect(out.content).toContain('1. Exemple A\n   https://example.org/a\n   Extrait A');
  });

  it('web_search uses Brave when a key is set, and never puts the key in the run or the text', async () => {
    const { tools, deps } = make({ braveKey: jest.fn(async () => 'BSA-secret-key') });
    const out = await tools.run(call('web_search', { query: 'x' }));
    expect(deps.braveTransport).toHaveBeenCalledWith('BSA-secret-key');
    expect(deps.duckTransport).not.toHaveBeenCalled();
    expect(out.run.result_preview).toBe('Brave : 1 résultat');
    expect(JSON.stringify(out)).not.toContain('BSA-secret-key');
  });

  it('web_search bounds the count and refuses an empty query', async () => {
    const { tools } = make();
    expect((await tools.run(call('web_search', { query: 'a', count: 999 }))).run.arguments.count).toBe(10);
    expect((await tools.run(call('web_search', { query: 'a', count: 'x' }))).run.arguments.count).toBe(5);
    const empty = await tools.run(call('web_search', { query: '   ' }));
    expect(empty.run.status).toBe('error');
    expect(empty.content).toMatch(/^Erreur : La requête de recherche est vide/);
  });

  it('web_search reports a provider that does not answer (rate limit, block) as an error the model can read', async () => {
    const { tools } = make({ duckTransport: jest.fn(() => async () => ({ status: 403, body: 'blocked' })) });
    const out = await tools.run(call('web_search', { query: 'x' }));
    expect(out.run.status).toBe('error');
    expect(out.content).toMatch(/DuckDuckGo n'a pas répondu/);
  });

  it('web_search says so when there is no result', async () => {
    const { tools } = make({ duckTransport: jest.fn(() => async () => ({ status: 200, body: '<html>aucun</html>' })) });
    const out = await tools.run(call('web_search', { query: 'zzz' }));
    expect(out.run).toMatchObject({ status: 'done', result_preview: 'DuckDuckGo : 0 résultat' });
    expect(out.content).toBe('Aucun résultat.');
  });

  it('fetch_url returns the text of a page with its title', async () => {
    const { tools, deps } = make();
    const out = await tools.run(call('fetch_url', { url: 'https://example.com/page' }));
    expect(deps.fetchPage).toHaveBeenCalledWith('https://example.com/page', expect.anything());
    expect(out.run).toMatchObject({ status: 'done', sources: [{ title: 'Page test', url: 'https://example.com/page' }] });
    expect(out.run.result_preview).toMatch(/^Page test — \d+ caractères$/);
    expect(out.content).toContain('Page : https://example.com/page\nTitre : Page test');
    expect(out.content).toContain('Bonjour le monde');
  });

  it('fetch_url refuses private addresses with a reason, without calling the network', async () => {
    const { tools, deps } = make();
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8000/engine/v1/status', 'file:///etc/passwd']) {
      const out = await tools.run(call('fetch_url', { url }));
      expect(out.run.status).toBe('error');
      expect(out.content).toMatch(/^Erreur : Adresse refusée/);
    }
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });

  it('fetch_url surfaces why a fetch failed (guard on a redirect, timeout, type)', async () => {
    const { tools } = make({ fetchPage: jest.fn(async () => { throw new SsrfBlockedError('Adresse privée, locale ou réservée refusée.'); }) });
    const out = await tools.run(call('fetch_url', { url: 'https://example.com/redirects' }));
    expect(out.content).toBe('Erreur : Adresse refusée : Adresse privée, locale ou réservée refusée.');
    const other = make({ fetchPage: jest.fn(async () => { throw new Error('Type de contenu non pris en charge : application/zip.'); }) });
    expect((await other.tools.run(call('fetch_url', { url: 'https://example.com/f.zip' }))).content).toMatch(/non pris en charge/);
  });

  it('fetch_url handles plain text and a page that answers with an error status', async () => {
    const text = make({ fetchPage: jest.fn(async (url: string) => ({ url, status: 200, contentType: 'text/plain', body: 'ligne 1\nligne 2' })) });
    expect((await text.tools.run(call('fetch_url', { url: 'https://example.com/a.txt' }))).content).toContain('ligne 1\nligne 2');
    const gone = make({ fetchPage: jest.fn(async (url: string) => ({ url, status: 404, contentType: 'text/html', body: 'nope' })) });
    const out = await gone.tools.run(call('fetch_url', { url: 'https://example.com/missing' }));
    expect(out.run.status).toBe('error');
  });

  it('cuts a very long page', async () => {
    const { tools } = make({ fetchPage: jest.fn(async (url: string) => ({ url, status: 200, contentType: 'text/plain', body: 'a'.repeat(50_000) })) });
    const out = await tools.run(call('fetch_url', { url: 'https://example.com/long' }));
    expect(out.content.length).toBeLessThan(20_300);
    expect(out.run.result_preview).toContain('(coupé)');
  });

  it('handles an unknown tool, malformed arguments and bounded arguments', async () => {
    const { tools } = make();
    expect((await tools.run(call('rm_rf', {}))).content).toBe('Erreur : Outil inconnu : rm_rf.');
    expect((await tools.run(call('web_search', '{not json'))).run.status).toBe('error');
    const long = tools.begin(call('web_search', { query: 'q'.repeat(1000), other: 'x' }));
    expect((long.arguments.query as string).length).toBe(300);
    expect(long.arguments).not.toHaveProperty('other');
    expect(long.status).toBe('running');
  });

  it('rethrows an abort instead of reporting an error', async () => {
    const controller = new AbortController();
    const { tools } = make({
      fetchPage: jest.fn(async () => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      }),
    });
    await expect(tools.run(call('fetch_url', { url: 'https://example.com/slow' }), controller.signal)).rejects.toThrow();
  });
});
