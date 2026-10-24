/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { PluginRoute } from '@/modules_shared/common/plugins/AppPlugin'
import { STUDIO_ROUTES, type StudioRouteDef } from './lib/routes'
import { AudioHomePage } from './pages/AudioHomePage'
import { AudioLibraryPage } from './pages/AudioLibraryPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { DiagramHomePage } from './pages/DiagramHomePage'
import { GalleryPage } from './pages/GalleryPage'
import { ConversationPage } from './pages/ConversationPage'
import { HomePage } from './pages/HomePage'
import { OcrHomePage } from './pages/OcrHomePage'
import { VideoHomePage } from './pages/VideoHomePage'
import { VideoLibraryPage } from './pages/VideoLibraryPage'
import { VoicesPage } from './pages/VoicesPage'

/** Page of a route: the image studio's home and conversation (H4.3) and gallery (H4.4), the audio studio's home, voices and library (H4.5), the video studio's home and library (H4.6), the chat's home (`/chat`, loaded on demand); `ComingSoonPage` stays as the fallback of a route without a page. */
function pageOf(route: StudioRouteDef) {
  if (route.name === 'home') return <HomePage />
  if (route.name === 'conversation') return <ConversationPage />
  if (route.name === 'gallery') return <GalleryPage />
  if (route.name === 'audio-home') return <AudioHomePage />
  if (route.name === 'voices') return <VoicesPage />
  if (route.name === 'audio-library') return <AudioLibraryPage />
  if (route.name === 'video-home') return <VideoHomePage />
  if (route.name === 'video-library') return <VideoLibraryPage />
  if (route.name === 'diagram-home') return <DiagramHomePage />
  if (route.name === 'ocr-home' || route.name === 'ocr-document') return <OcrHomePage />
  return <ComingSoonPage titleKey={route.titleKey} />
}

/**
 * Routes of the studio for `components/Router.tsx`. Each H4 task replaces the element of its route.
 * `fullscreen`: PageLayout renders the studio shell (not the template's header/sidebar) around them.
 */
export const studioRoutes: PluginRoute[] = STUDIO_ROUTES.map((route): PluginRoute =>
  // The chat page is code-split (the Markdown renderer and the code colouring come with it).
  route.name === 'chat-home'
    ? { path: route.path, layout: 'fullscreen', lazy: () => import('./pages/ChatHomePage') }
    : { path: route.path, layout: 'fullscreen', element: pageOf(route) },
)
