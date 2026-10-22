/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import type { LookupAddress } from 'dns';
import { assertPublicUrl, createSafeLookup, isPublicIp, parseV6, SsrfBlockedError } from './ssrfGuard';

describe('isPublicIp', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '192.0.0.8', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '203.0.113.9',
  ])('refuses the private, local or reserved IPv4 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '11.0.0.1', '100.63.255.255', '100.128.0.1'])(
    'accepts the public IPv4 %s',
    (ip) => expect(isPublicIp(ip)).toBe(true),
  );

  it.each([
    '::1', '::', 'fe80::1', 'fe80::abcd%en0', 'fc00::1', 'fd12:3456:789a::1', 'ff02::1', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::1', '::127.0.0.1',
    'fec0::1', '100::1',
  ])('refuses the private, local or embedded-private IPv6 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2a00:1450:4009:81b::200e', '64:ff9b::808:808'])(
    'accepts the public IPv6 %s',
    (ip) => expect(isPublicIp(ip)).toBe(true),
  );

  it('refuses what is not an address', () => {
    expect(isPublicIp('example.com')).toBe(false);
    expect(isPublicIp('999.1.1.1')).toBe(false);
    expect(isPublicIp('')).toBe(false);
    expect(isPublicIp('1.2.3')).toBe(false);
  });
});

describe('parseV6', () => {
  it('expands compression and embedded IPv4', () => {
    expect(parseV6('::1')).toEqual([...Array(15).fill(0), 1]);
    expect(parseV6('::ffff:1.2.3.4')).toEqual([...Array(10).fill(0), 255, 255, 1, 2, 3, 4]);
    expect(parseV6('1:2:3:4:5:6:7:8')).toEqual([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8]);
    expect(parseV6('1::8')?.length).toBe(16);
  });
  it('rejects malformed addresses', () => {
    for (const bad of ['1:2:3:4:5:6:7:8:9', '1::2::3', ':::', 'g::1', '1:2:3', '::ffff:1.2.3.999']) expect(parseV6(bad)).toBeNull();
  });
});

describe('assertPublicUrl', () => {
  it.each([
    'http://127.0.0.1/', 'http://localhost/x', 'http://LOCALHOST:8080/', 'https://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fe80::1]/', 'http://0.0.0.0/', 'http://2130706433/', 'http://0x7f000001/', 'http://017700000001/',
    'http://metadata.google.internal/', 'http://printer.local/', 'http://router.lan/', 'http://intranet/', 'http://foo.localhost/',
  ])('refuses %s', (url) => {
    expect(() => assertPublicUrl(url)).toThrow(SsrfBlockedError);
  });

  it('refuses other schemes, credentials and unusual ports', () => {
    expect(() => assertPublicUrl('ftp://example.com/')).toThrow(/http/);
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow(SsrfBlockedError);
    expect(() => assertPublicUrl('gopher://example.com/')).toThrow(SsrfBlockedError);
    expect(() => assertPublicUrl('http://user:pass@example.com/')).toThrow(/identifiants/);
    expect(() => assertPublicUrl('http://example.com:22/')).toThrow(/Port 22/);
    expect(() => assertPublicUrl('http://example.com:6379/')).toThrow(/Port 6379/);
    expect(() => assertPublicUrl('not a url')).toThrow(/invalide/);
  });

  it('accepts public pages on the usual ports', () => {
    for (const url of ['https://example.com/a?b=1', 'http://example.com/', 'https://example.com:8443/x', 'http://93.184.216.34/', 'https://[2606:4700:4700::1111]/', 'https://docs.example.co.uk/page#frag']) {
      expect(assertPublicUrl(url)).toBeInstanceOf(URL);
    }
  });
});

describe('createSafeLookup', () => {
  const addr = (...ips: string[]): LookupAddress[] => ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  const run = (resolver: Parameters<typeof createSafeLookup>[0], options: object = {}) =>
    new Promise<{ err: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
      createSafeLookup(resolver)('host.example', options, (err, result) => resolve({ err, result }));
    });

  it('hands the connection the validated addresses', async () => {
    const one = await run(async () => addr('93.184.216.34'));
    expect(one).toEqual({ err: null, result: '93.184.216.34' });
    const all = await run(async () => addr('93.184.216.34', '2606:4700:4700::1111'), { all: true });
    expect(all.result).toEqual(addr('93.184.216.34', '2606:4700:4700::1111'));
  });

  it('refuses a name that resolves to a private address', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', 'fd00::5']) {
      const { err } = await run(async () => addr(ip));
      expect(err).toBeInstanceOf(SsrfBlockedError);
    }
  });

  it('refuses a name with ONE private address among public ones', async () => {
    const { err } = await run(async () => addr('93.184.216.34', '192.168.0.10'), { all: true });
    expect(err).toBeInstanceOf(SsrfBlockedError);
  });

  it('checks again at every connection: a name that turns private after a first public answer is refused (DNS rebinding)', async () => {
    let calls = 0;
    const resolver = async () => (calls++ === 0 ? addr('93.184.216.34') : addr('127.0.0.1'));
    expect((await run(resolver)).err).toBeNull();
    expect((await run(resolver)).err).toBeInstanceOf(SsrfBlockedError);
  });

  it('reports an unresolvable name as such', async () => {
    const { err } = await run(async () => []);
    expect(err?.code).toBe('ENOTFOUND');
    const failing = await run(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    });
    expect(failing.err?.code).toBe('ENOTFOUND');
  });
});
