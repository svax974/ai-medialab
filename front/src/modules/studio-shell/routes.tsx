/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { PluginRoute } from '@/modules_shared/common/plugins/AppPlugin'
import { STUDIO_ROUTES } from './lib/routes'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { ConversationPage } from './pages/ConversationPage'

/**
 * Routes of the studio for `components/Router.tsx`. Provisional pages (`ComingSoonPage`); each H4 task replaces the
 * element of its route. `fullscreen`: PageLayout renders the studio shell (not the template's header/sidebar) around them.
 */
export const studioRoutes: PluginRoute[] = STUDIO_ROUTES.map((route) => ({
  path: route.path,
  layout: 'fullscreen' as const,
  element: route.name === 'conversation' ? <ConversationPage /> : <ComingSoonPage titleKey={route.titleKey} />,
}))
