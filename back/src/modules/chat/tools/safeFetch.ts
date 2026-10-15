/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import * as http from 'http';
import * as https from 'https';
import type { IncomingMessage } from 'http';
import { assertPublicUrl, createSafeLookup, isPublicIp, SsrfBlockedError } from './ssrfGuard';

/** Download of a public web page for the chat's `fetch_url` tool (guards: `ssrfGuard.ts`). */

export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 1_500_000;
const TEXT_TYPES = /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json))/i;
const USER_AGENT = 'Mozilla/5.0 (compatible; AIMediaLab/1.0; +local)';

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface SafeFetchOptions {
  signal?: AbortSignal;
  /** Replaced in tests: the function that resolves names (default: the system resolver). */
  lookup?: ReturnType<typeof createSafeLookup>;
  /** Replaced in tests: sends the request (default: `http`/`https`). */
  request?: typeof https.request;
  /** Replaced in tests: tells whether the connected address is acceptable (default: `isPublicIp`). */
  isPublic?: (address: string) => boolean;
}

/**
 * GET with the guards of a server that fetches what a model asks for: the URL is validated at every hop (at most
 * `MAX_REDIRECTS`, each `Location` re-checked), names are resolved by the connecting call itself and every address
 * must be public, the connected socket is checked again, the body is capped and only text types are read.
 */
export async function fetchPublicPage(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchedPage> {
  let url = assertPublicUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { res, socketAddress } = await requestOnce(url, options);
    if (socketAddress && !(options.isPublic ?? isPublicIp)(socketAddress)) {
      res.destroy();
      throw new SsrfBlockedError('La connexion a abouti à une adresse privée : refusée.');
    }
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume();
      if (hop === MAX_REDIRECTS) throw new Error(`Plus de ${MAX_REDIRECTS} redirections.`);
      url = assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (status >= 200 && status < 300 && contentType && !TEXT_TYPES.test(contentType)) {
      res.destroy();
      throw new Error(`Type de contenu non pris en charge : ${contentType.split(';')[0]}.`);
    }
    return { url: url.toString(), status, contentType, body: await readBody(res, contentType) };
  }
  throw new Error('Trop de redirections.');
}

function requestOnce(url: URL, options: SafeFetchOptions): Promise<{ res: IncomingMessage; socketAddress: string | undefined }> {
  return new Promise((resolve, reject) => {
    const send = options.request ?? (url.protocol === 'https:' ? https.request : http.request);
    const req = send(
      url,
      {
        method: 'GET',
        lookup: (options.lookup ?? createSafeLookup()) as never,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1', 'Accept-Language': 'fr,en;q=0.8', 'Accept-Encoding': 'identity' },
        signal: options.signal,
      },
      (res) => resolve({ res, socketAddress: res.socket?.remoteAddress }),
    );
    req.on('error', reject);
    req.end();
  });
}

async function readBody(res: IncomingMessage, contentType: string): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res) {
    size += (chunk as Buffer).length;
    chunks.push(chunk as Buffer);
    if (size > MAX_BODY_BYTES) {
      res.destroy();
      break;
    }
  }
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES));
  } catch {
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES));
  }
}
