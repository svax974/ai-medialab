/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { parseBrave, parseDuckDuckGo, unwrapDuckDuckGoLink } from './webSearch';

/** Trimmed from a real answer of `html.duckduckgo.com/html/` (checked 2026-10-15): direct links, one ad, one wrapped link. */
const DDG = `
<div class="results">
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://github.com/ggml-org/llama.cpp/releases">Releases: ggml-org/llama.cpp - GitHub</a></h2>
      <div class="result__extras"><a class="result__url" href="https://github.com/ggml-org/llama.cpp/releases">github.com/ggml-org/llama.cpp/releases</a></div>
      <a class="result__snippet" href="https://github.com/ggml-org/llama.cpp/releases">LLM inference in <b>C/C++</b>. Contribute to ggml-org/llama.cpp &amp; more.</a>
    </div>
  </div>
  <div class="result result--ad results_links">
    <div class="links_main"><h2 class="result__title"><a class="result__a" href="https://ads.example.com/x">Annonce</a></h2><a class="result__snippet" href="#">Achetez</a></div>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdoc%3Fa%3D1&amp;rut=abc">Doc <i>officielle</i></a></h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdoc">Le guide.</a>
    </div>
  </div>
  <div class="result results_links web-result ">
    <h2 class="result__title"><a class="result__a" href="javascript:alert(1)">Piège</a></h2>
  </div>
</div>`;

describe('parseDuckDuckGo', () => {
  it('reads titles, links and snippets, skips ads and non-web links', () => {
    expect(parseDuckDuckGo(DDG, 10)).toEqual([
      { title: 'Releases: ggml-org/llama.cpp - GitHub', url: 'https://github.com/ggml-org/llama.cpp/releases', snippet: 'LLM inference in C/C++. Contribute to ggml-org/llama.cpp & more.' },
      { title: 'Doc officielle', url: 'https://example.org/doc?a=1', snippet: 'Le guide.' },
    ]);
  });
  it('keeps at most `count` results and returns nothing for a page without results (a blocked request)', () => {
    expect(parseDuckDuckGo(DDG, 1)).toHaveLength(1);
    expect(parseDuckDuckGo('<html><body>Unfortunately, bots use DuckDuckGo too.</body></html>', 5)).toEqual([]);
  });
});

describe('unwrapDuckDuckGoLink', () => {
  it('extracts the target of a redirect link and refuses anything but http(s)', () => {
    expect(unwrapDuckDuckGoLink('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx&rut=1')).toBe('https://a.example/x');
    expect(unwrapDuckDuckGoLink('https://b.example/y')).toBe('https://b.example/y');
    expect(unwrapDuckDuckGoLink('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)')).toBeNull();
    expect(unwrapDuckDuckGoLink('javascript:alert(1)')).toBeNull();
    expect(unwrapDuckDuckGoLink('https://duckduckgo.com/about')).toBeNull();
  });
});

describe('parseBrave', () => {
  it('reads the web results and ignores anything without an http(s) url', () => {
    const payload = { web: { results: [
      { title: 'A <strong>b</strong>', url: 'https://a.example', description: 'x &amp; y' },
      { title: 'bad', url: 'ftp://x' }, { url: 5 }, null, { title: 'C', url: 'https://c.example' },
    ] } };
    expect(parseBrave(payload, 5)).toEqual([
      { title: 'A b', url: 'https://a.example', snippet: 'x & y' },
      { title: 'C', url: 'https://c.example', snippet: '' },
    ]);
    expect(parseBrave(payload, 1)).toHaveLength(1);
    expect(parseBrave({}, 5)).toEqual([]);
    expect(parseBrave(null, 5)).toEqual([]);
  });
});
