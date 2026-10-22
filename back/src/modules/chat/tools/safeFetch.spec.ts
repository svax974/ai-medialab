/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { EventEmitter } from 'events';
import type * as https from 'https';
import { PassThrough } from 'stream';
import { fetchPublicPage, MAX_BODY_BYTES, MAX_REDIRECTS } from './safeFetch';
import { SsrfBlockedError } from './ssrfGuard';

interface FakeReply {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  address?: string;
}

/** A stand-in for `https.request`: answers each hop from a script and records the URLs asked for. */
function fakeRequest(script: Record<string, FakeReply>) {
  const asked: string[] = [];
  const request = ((url: URL, _options: unknown, callback: (res: unknown) => void) => {
    asked.push(url.toString());
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const reply = script[url.toString()];
      if (!reply) return void req.emit('error', new Error(`no scripted reply for ${url}`));
      const res = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string>; socket: { remoteAddress: string } };
      res.statusCode = reply.status;
      res.headers = reply.headers ?? {};
      res.socket = { remoteAddress: reply.address ?? '93.184.216.34' };
      callback(res);
      res.end(reply.body ?? '');
    };
    return req;
  }) as unknown as typeof https.request;
  return { request, asked };
}

const html = { 'content-type': 'text/html; charset=utf-8' };

describe('fetchPublicPage', () => {
  it('reads a public page', async () => {
    const { request, asked } = fakeRequest({ 'https://example.com/a': { status: 200, headers: html, body: '<p>Bonjour</p>' } });
    const page = await fetchPublicPage('https://example.com/a', { request });
    expect(page).toEqual({ url: 'https://example.com/a', status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Bonjour</p>' });
    expect(asked).toEqual(['https://example.com/a']);
  });

  it('refuses a private URL before any request', async () => {
    const { request, asked } = fakeRequest({});
    for (const url of ['http://127.0.0.1/', 'http://10.0.0.1/x', 'http://169.254.169.254/latest', 'http://localhost/']) {
      await expect(fetchPublicPage(url, { request })).rejects.toBeInstanceOf(SsrfBlockedError);
    }
    expect(asked).toEqual([]);
  });

  it('follows a redirect to another public page', async () => {
    const { request, asked } = fakeRequest({
      'https://example.com/a': { status: 301, headers: { location: '/b' } },
      'https://example.com/b': { status: 200, headers: html, body: 'ok' },
    });
    const page = await fetchPublicPage('https://example.com/a', { request });
    expect(page.url).toBe('https://example.com/b');
    expect(asked).toHaveLength(2);
  });

  it('refuses a redirect that leads to a private address, without requesting it', async () => {
    for (const target of ['http://127.0.0.1:8080/admin', 'http://10.0.0.7/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd']) {
      const { request, asked } = fakeRequest({ 'https://example.com/go': { status: 302, headers: { location: target } } });
      await expect(fetchPublicPage('https://example.com/go', { request })).rejects.toBeInstanceOf(SsrfBlockedError);
      expect(asked).toEqual(['https://example.com/go']);
    }
  });

  it(`gives up after ${MAX_REDIRECTS} redirections`, async () => {
    const script: Record<string, FakeReply> = {};
    for (let i = 0; i < 10; i++) script[`https://example.com/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    const { request, asked } = fakeRequest(script);
    await expect(fetchPublicPage('https://example.com/0', { request })).rejects.toThrow(/redirections/);
    expect(asked).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('refuses a connection that ended on a private address even when the name looked public', async () => {
    const { request } = fakeRequest({ 'https://example.com/x': { status: 200, headers: html, body: 'secret', address: '127.0.0.1' } });
    await expect(fetchPublicPage('https://example.com/x', { request })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('refuses types that are not text', async () => {
    const { request } = fakeRequest({ 'https://example.com/f': { status: 200, headers: { 'content-type': 'application/zip' }, body: 'PK' } });
    await expect(fetchPublicPage('https://example.com/f', { request })).rejects.toThrow(/non pris en charge/);
  });

  it('caps the body', async () => {
    const { request } = fakeRequest({ 'https://example.com/big': { status: 200, headers: html, body: 'a'.repeat(MAX_BODY_BYTES + 5000) } });
    const page = await fetchPublicPage('https://example.com/big', { request });
    expect(page.body.length).toBe(MAX_BODY_BYTES);
  });

  it('decodes the declared charset and returns error statuses as they are', async () => {
    const { request } = fakeRequest({
      'https://example.com/l1': { status: 200, headers: { 'content-type': 'text/html; charset=iso-8859-1' }, body: Buffer.from([0x63, 0x61, 0x66, 0xe9]) },
      'https://example.com/404': { status: 404, headers: html, body: 'nope' },
    });
    expect((await fetchPublicPage('https://example.com/l1', { request })).body).toBe('café');
    expect((await fetchPublicPage('https://example.com/404', { request })).status).toBe(404);
  });
});
