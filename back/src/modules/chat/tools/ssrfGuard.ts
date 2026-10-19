/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { lookup as dnsLookup } from 'dns';
import { isIP } from 'net';
import type { LookupAddress } from 'dns';

/**
 * Protection of the chat's `fetch_url` tool against server-side request forgery: a page the model asks for must be on
 * the public Internet, never on this machine or its network (the engine, Nest itself, a router, a cloud metadata
 * service). Three layers: the URL (scheme, credentials, port, literal address, local names), every address the name
 * resolves to (a name with one private address is refused), and the address the socket really connected to. The name
 * is resolved by the same function that opens the connection (`createSafeLookup`), so a DNS answer that changes
 * between the check and the connection (rebinding) cannot reach a private address.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home', '.lan', '.corp', '.intranet'];
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data']);

const inV4 = (o: number[], base: number[], bits: number): boolean => {
  let remaining = bits;
  for (let i = 0; i < 4 && remaining > 0; i++, remaining -= 8) {
    const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
    if ((o[i] & mask) !== (base[i] & mask)) return false;
  }
  return true;
};

const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12], [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 88, 99, 0], 24], [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24], [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
];

function parseV4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null;
}

/** The 16 bytes of an IPv6 address (`::` compression, an embedded dotted IPv4, a `%zone` suffix), or null. */
export function parseV6(address: string): number[] | null {
  const text = address.split('%')[0].toLowerCase();
  if (!text.includes(':')) return null;
  let head = text;
  let tail: number[] = [];
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const v4 = parseV4(dotted[1]);
    if (!v4) return null;
    tail = v4;
    head = text.slice(0, text.length - dotted[1].length) + '0:0';
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === '' ? [] : s.split(':'));
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const all = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]);
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

const isPublicV4 = (o: number[]): boolean => !V4_BLOCKED.some(([base, bits]) => inV4(o, base, bits));

function isPublicV6(b: number[]): boolean {
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zeros(0, 15) && (b[15] === 0 || b[15] === 1)) return false; // :: and ::1
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPublicV4(b.slice(12)); // ::ffff:a.b.c.d (IPv4-mapped)
  if (zeros(0, 12)) return false; // ::a.b.c.d (IPv4-compatible, deprecated)
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return isPublicV4(b.slice(12)); // 64:ff9b::/96 NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return isPublicV4(b.slice(2, 6)); // 2002::/16 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return false; // 2001::/32 Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // documentation
  if (b[0] === 0x01 && zeros(1, 8)) return false; // 100::/64 discard
  if ((b[0] & 0xfe) === 0xfc) return false; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return false; // fec0::/10 site-local
  return b[0] !== 0xff; // ff00::/8 multicast
}

/** True for an address of the public Internet; false for anything private, local, reserved, or not an address. */
export function isPublicIp(address: string): boolean {
  const family = isIP(address.split('%')[0]);
  if (family === 4) {
    const octets = parseV4(address);
    return octets !== null && isPublicV4(octets);
  }
  if (family === 6) {
    const bytes = parseV6(address);
    return bytes !== null && isPublicV6(bytes);
  }
  return false;
}

/** The URL as `fetch_url` accepts it: http/https, no credentials, a normal port, a public literal or a plausible name. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError(tr('chat.ssrf.invalid'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfBlockedError(tr('chat.ssrf.protocol'));
  if (url.username || url.password) throw new SsrfBlockedError(tr('chat.ssrf.credentials'));
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new SsrfBlockedError(tr('chat.ssrf.port', [port]));
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new SsrfBlockedError(tr('chat.ssrf.privateAddress'));
    return url;
  }
  if (!host.includes('.') || BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfBlockedError(tr('chat.ssrf.localHost'));
  }
  return url;
}

type Resolver = (hostname: string, options: { all: true; verbatim: true; family?: number }) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (hostname, options) =>
  new Promise((resolve, reject) => dnsLookup(hostname, options, (err, addresses) => (err ? reject(err) : resolve(addresses))));

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` function for `http(s).request`: it resolves the name, refuses it when ANY address is not public, and
 * hands the connection the validated addresses. Used by the connection itself, which closes the rebinding window.
 */
export function createSafeLookup(resolver: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean; family?: number } | number | LookupCallback, callback?: LookupCallback): void => {
    const opts = typeof options === 'object' ? options : {};
    const done = (typeof options === 'function' ? options : callback) as LookupCallback;
    resolver(hostname, { all: true, verbatim: true, family: opts.family })
      .then((addresses) => {
        if (!addresses.length) throw Object.assign(new Error(tr('chat.ssrf.noAddress', [hostname])), { code: 'ENOTFOUND' });
        const blocked = addresses.find((a) => !isPublicIp(a.address));
        if (blocked) throw Object.assign(new SsrfBlockedError(tr('chat.ssrf.resolvesPrivate', [hostname])), { code: 'ESSRF' });
        if (opts.all) done(null, addresses);
        else done(null, addresses[0].address, addresses[0].family);
      })
      .catch((error: NodeJS.ErrnoException) => done(error, []));
  };
}
