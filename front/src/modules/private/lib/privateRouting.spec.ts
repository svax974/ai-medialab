/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_ASSET_PAGE, isLibraryListing, isPersistingRequest, privatePath } from './privateRouting'
import { ttlMinutes } from './ttl'

describe('privatePath', () => {
  it('sends the studio routes to their private twin while the session is on', () => {
    for (const path of ['/conversations', '/conversations?mode=image&q=x', '/conversations/abc', '/messages', '/messages/m1/retry', '/messages/m1/cancel', '/queue', '/assets', '/assets/a1', '/chat/attachments', '/chat/attachments/chat_0123456789abcdef.png', '/chat/enhance-prompt']) {
      expect(privatePath(path, true)).toBe(`/private${path}`)
    }
  })
  it('never touches a route in the normal mode', () => {
    expect(privatePath('/conversations/abc', false)).toBe('/conversations/abc')
  })
  it('leaves the routes that hold no content: models, hardware, settings, engines, the session itself, the usage read', () => {
    for (const path of ['/models', '/system', '/settings', '/engines/sdcpp/install', '/private/session', '/messages/model-usage', '/conversationsX', '/hf/search?q=x', '/chat/model/unload', '/chat/attachmentsX']) {
      expect(privatePath(path, true)).toBe(path)
    }
  })
})

describe('what a private session refuses or does not list', () => {
  it('refuses to write into the voice library or the persistent chat conversations, but reads them', () => {
    expect(isPersistingRequest('post', '/voices/from-asset', true)).toBe(true)
    expect(isPersistingRequest('delete', '/voices/v1', true)).toBe(true)
    expect(isPersistingRequest('post', '/chat/conversations/c/messages', true)).toBe(true)
    expect(isPersistingRequest('post', '/chat/conversations/c/leaf', true)).toBe(true)
    expect(isPersistingRequest('post', '/chat/attachments', true)).toBe(false) // routed to the session folder instead
    expect(isPersistingRequest('post', '/chat/model/unload', true)).toBe(false) // holds no content
    expect(isPersistingRequest('get', '/voices', true)).toBe(false)
    expect(isPersistingRequest('get', '/chat/conversations/c', true)).toBe(false)
    expect(isPersistingRequest('post', '/voices', false)).toBe(false)
  })
  it('lists nothing: the gallery is empty and is not even asked', () => {
    expect(isLibraryListing('get', '/assets?kind=generated&media=image', true)).toBe(true)
    expect(isLibraryListing('get', '/assets', true)).toBe(true)
    expect(isLibraryListing('get', '/assets/a1', true)).toBe(false)
    expect(isLibraryListing('post', '/assets', true)).toBe(false)
    expect(isLibraryListing('get', '/assets?x=1', false)).toBe(false)
    expect(EMPTY_ASSET_PAGE).toEqual({ items: [], next_before: null })
  })
})

describe('ttlMinutes', () => {
  it('is what the server says, rounded, at least one', () => {
    expect(ttlMinutes({ last_activity: 1000, expires_at: 1000 + 1800 })).toBe(30)
    expect(ttlMinutes({ last_activity: 1000, expires_at: 1010 })).toBe(1)
    expect(ttlMinutes({ last_activity: null, expires_at: null })).toBeNull()
    expect(ttlMinutes(null)).toBeNull()
  })
})
