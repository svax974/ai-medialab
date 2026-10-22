/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { isPrivateMode } from '../state/privateStore'

export const PRIVATE_PREFIX = '/private'

/** Studio routes whose private twin lives under `/private` (same path, same shape, answered from memory). */
const ROUTED = [
  /^\/conversations(?=[/?]|$)/, /^\/messages(?=[/?]|$)(?!\/model-usage)/, /^\/queue(?=[/?]|$)/, /^\/assets(?=[/?]|$)/,
  // The private chat: attachments live in the session folder and the prompt improvement keeps nothing (the conversation itself is
  // held by the browser, `chat/services/privateChatBackend.ts`, and its answers come from `/private/chat`).
  /^\/chat\/(attachments|enhance-prompt)(?=[/?]|$)/,
]
/** Routes that would keep something of a private session in the normal library or database: refused while it is on. */
const PERSISTING = [/^\/voices(?=[/?]|$)/, /^\/chat\/conversations(?=[/?]|$)/]

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** `/conversations/x` becomes `/private/conversations/x` for the studio routes, and only while the session is on. */
export function privatePath(path: string, active: boolean = isPrivateMode()): string {
  return active && ROUTED.some((re) => re.test(path)) ? `${PRIVATE_PREFIX}${path}` : path
}

/** A request that would write into the voice library or the persistent chat (its conversations): refused in a private session. */
export function isPersistingRequest(method: HttpMethod, path: string, active: boolean = isPrivateMode()): boolean {
  return active && method !== 'get' && PERSISTING.some((re) => re.test(path))
}

/** The gallery and the libraries list what is stored: in a private session there is nothing to list (and nothing is asked). */
export function isLibraryListing(method: HttpMethod, path: string, active: boolean = isPrivateMode()): boolean {
  return active && method === 'get' && /^\/assets(?=\?|$)/.test(path)
}

/** An empty page of assets (the shape of `GET /assets`). */
export const EMPTY_ASSET_PAGE = { items: [] as unknown[], next_before: null as number | null }
