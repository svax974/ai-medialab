/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { PluginRoute } from '@/modules_shared/common/plugins/AppPlugin'
import { STUDIO_ROUTES, type StudioRouteDef } from './lib/routes'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { ConversationPage } from './pages/ConversationPage'
import { HomePage } from './pages/HomePage'

/** Page of a route: the image studio's home and conversation (H4.3); the others are still provisional (`ComingSoonPage`). */
function pageOf(route: StudioRouteDef) {
  if (route.name === 'home') return <HomePage />
  if (route.name === 'conversation') return <ConversationPage />
  return <ComingSoonPage titleKey={route.titleKey} />
}

/**
 * Routes of the studio for `components/Router.tsx`. Each H4 task replaces the element of its route.
 * `fullscreen`: PageLayout renders the studio shell (not the template's header/sidebar) around them.
 */
export const studioRoutes: PluginRoute[] = STUDIO_ROUTES.map((route) => ({
  path: route.path,
  layout: 'fullscreen' as const,
  element: pageOf(route),
}))
