/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { decodeEntities } from './htmlText';

/** Parsers of the two search providers of the chat's `web_search` tool: DuckDuckGo (HTML, no key) and Brave (API, key). */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const text = (html: string): string => decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/** DuckDuckGo wraps outgoing links in `//duckduckgo.com/l/?uddg=<url>` on some layouts; the direct URL is kept. */
export function unwrapDuckDuckGoLink(href: string): string | null {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(decodeEntities(absolute));
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/')) {
      const target = url.searchParams.get('uddg');
      return target && /^https?:\/\//i.test(target) ? target : null;
    }
    return /^https?:$/.test(url.protocol) && !url.hostname.endsWith('duckduckgo.com') ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Results of `https://html.duckduckgo.com/html/` (ads are skipped). An empty list also means a blocked request. */
export function parseDuckDuckGo(html: string, count: number): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of html.split(/<div class="result\b/).slice(1)) {
    const header = block.slice(0, block.indexOf('>'));
    if (/result--ad|result__ad/.test(header) || /result--ad/.test(block.slice(0, 400))) continue;
    const link = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
      ?? /<a[^>]*href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = unwrapDuckDuckGoLink(link[1]);
    if (!url) continue;
    const snippet = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ?? /<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    hits.push({ title: text(link[2]), url, snippet: snippet ? text(snippet[1]) : '' });
    if (hits.length >= count) break;
  }
  return hits;
}

/** Results of `GET https://api.search.brave.com/res/v1/web/search`. */
export function parseBrave(payload: unknown, count: number): SearchHit[] {
  const results = (payload as { web?: { results?: unknown } } | null)?.web?.results;
  if (!Array.isArray(results)) return [];
  const hits: SearchHit[] = [];
  for (const item of results as { title?: unknown; url?: unknown; description?: unknown }[]) {
    if (typeof item?.url !== 'string' || !/^https?:\/\//i.test(item.url)) continue;
    hits.push({ title: text(String(item.title ?? '')), url: item.url, snippet: text(String(item.description ?? '')) });
    if (hits.length >= count) break;
  }
  return hits;
}
