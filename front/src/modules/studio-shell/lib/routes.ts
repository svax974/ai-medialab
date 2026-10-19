/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { matchPath } from 'react-router-dom'
import type { StudioMode } from '../types'

export type StudioRouteName =
  | 'home'
  | 'conversation'
  | 'gallery'
  | 'audio-home'
  | 'voices'
  | 'audio-library'
  | 'video-home'
  | 'video-library'
  | 'chat-home'
  | 'diagram-home'

export interface StudioRouteDef {
  name: StudioRouteName
  path: string
  /** Mode the page belongs to (`null`: given by the conversation). */
  mode: StudioMode | null
  /** i18n key of the page title. */
  titleKey: string
}

/** Routes kept from the former interface. Order matters only for matching (no overlap). */
export const STUDIO_ROUTES: readonly StudioRouteDef[] = [
  { name: 'home', path: '/', mode: 'image', titleKey: 'studio.page.home.title' },
  { name: 'conversation', path: '/c/:id', mode: null, titleKey: 'studio.page.conversation.title' },
  { name: 'gallery', path: '/galerie', mode: 'image', titleKey: 'studio.page.gallery.title' },
  { name: 'audio-home', path: '/audio', mode: 'audio', titleKey: 'studio.page.audioHome.title' },
  { name: 'voices', path: '/audio/voix', mode: 'audio', titleKey: 'studio.page.voices.title' },
  { name: 'audio-library', path: '/audio/bibliotheque', mode: 'audio', titleKey: 'studio.page.audioLibrary.title' },
  { name: 'video-home', path: '/video', mode: 'video', titleKey: 'studio.page.videoHome.title' },
  { name: 'video-library', path: '/video/bibliotheque', mode: 'video', titleKey: 'studio.page.videoLibrary.title' },
  { name: 'chat-home', path: '/chat', mode: 'chat', titleKey: 'studio.page.chatHome.title' },
  { name: 'diagram-home', path: '/diagrammes', mode: 'diagram', titleKey: 'studio.page.diagramHome.title' },
]

export const studioPaths = {
  home: '/',
  conversation: (id: string) => `/c/${id}`,
  gallery: '/galerie',
  audioHome: '/audio',
  voices: '/audio/voix',
  audioLibrary: '/audio/bibliotheque',
  videoHome: '/video',
  videoLibrary: '/video/bibliotheque',
  chatHome: '/chat',
  diagramHome: '/diagrammes',
} as const

export interface StudioRouteMatch {
  route: StudioRouteDef
  /** Conversation id (`conversation` route only). */
  id: string | null
}

/** The studio route of a pathname (trailing slash tolerated), or `null` when it is not a studio page. */
export function matchStudioRoute(pathname: string): StudioRouteMatch | null {
  for (const route of STUDIO_ROUTES) {
    const match = matchPath({ path: route.path, end: true }, pathname)
    if (match) return { route, id: match.params.id ?? null }
  }
  return null
}

/** Mode shown for a page: the page's own, else the one of the conversation (once loaded). */
export function modeOfRoute(match: StudioRouteMatch | null, conversationMode: StudioMode | undefined): StudioMode | null {
  if (!match) return null
  return match.route.mode ?? conversationMode ?? null
}

/** Start page of a mode (target of "new creation" and of the mode switch before any page was visited). */
export function homePathForMode(mode: StudioMode): string {
  if (mode === 'chat') return studioPaths.chatHome
  if (mode === 'diagram') return studioPaths.diagramHome
  return mode === 'audio' ? studioPaths.audioHome : mode === 'video' ? studioPaths.videoHome : studioPaths.home
}

export const DEFAULT_LAST_PATHS: Record<StudioMode, string> = { image: '/', audio: '/audio', video: '/video', chat: '/chat', diagram: '/diagrammes' }
