/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_LAST_PATHS, homePathForMode, matchStudioRoute, modeOfRoute, STUDIO_ROUTES, studioPaths } from './routes'

describe('matchStudioRoute', () => {
  it('matches every kept route', () => {
    const cases: [string, string][] = [
      ['/', 'home'],
      ['/galerie', 'gallery'],
      ['/audio', 'audio-home'],
      ['/audio/voix', 'voices'],
      ['/audio/bibliotheque', 'audio-library'],
      ['/video', 'video-home'],
      ['/video/bibliotheque', 'video-library'],
      ['/chat', 'chat-home'],
    ]
    for (const [path, name] of cases) expect(matchStudioRoute(path)?.route.name, path).toBe(name)
  })

  it('extracts the conversation id and tolerates a trailing slash', () => {
    expect(matchStudioRoute('/c/abc-123')).toMatchObject({ id: 'abc-123', route: { name: 'conversation' } })
    expect(matchStudioRoute('/c/abc-123/')?.id).toBe('abc-123')
    expect(matchStudioRoute('/audio/')?.route.name).toBe('audio-home')
  })

  it('does not match other pages', () => {
    expect(matchStudioRoute('/admin/page')).toBeNull()
    expect(matchStudioRoute('/legal-mentions')).toBeNull()
    expect(matchStudioRoute('/c')).toBeNull()
  })

  it('builds paths that match back', () => {
    expect(matchStudioRoute(studioPaths.conversation('x1'))?.id).toBe('x1')
    for (const route of STUDIO_ROUTES.filter((r) => r.name !== 'conversation')) expect(matchStudioRoute(route.path)?.route.name).toBe(route.name)
  })
})

describe('modeOfRoute', () => {
  it('uses the mode of the page, else the conversation mode, else none', () => {
    expect(modeOfRoute(matchStudioRoute('/audio/voix'), undefined)).toBe('audio')
    expect(modeOfRoute(matchStudioRoute('/c/x'), 'video')).toBe('video')
    expect(modeOfRoute(matchStudioRoute('/c/x'), undefined)).toBeNull()
    expect(modeOfRoute(null, 'image')).toBeNull()
  })
})

describe('homePathForMode', () => {
  it('gives the start page of each mode, equal to the default last path', () => {
    expect(homePathForMode('image')).toBe('/')
    expect(homePathForMode('audio')).toBe('/audio')
    expect(homePathForMode('video')).toBe('/video')
    expect(homePathForMode('chat')).toBe('/chat')
    expect(DEFAULT_LAST_PATHS).toEqual({ image: '/', audio: '/audio', video: '/video', chat: '/chat' })
  })
})
