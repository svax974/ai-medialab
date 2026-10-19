/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ComponentInfo, ComponentKind } from '../types'
import { formatSize } from './setupDialog'

export interface ComponentGroup {
  kind: ComponentKind
  items: ComponentInfo[]
}

/** The components in two groups, base data first; an empty group is left out. Order inside a group is the engine's. */
export function groupComponents(components: ComponentInfo[]): ComponentGroup[] {
  return (['base', 'engine'] as const)
    .map((kind) => ({ kind, items: components.filter((c) => c.kind === kind) }))
    .filter((g) => g.items.length > 0)
}

/** Locale key and parameters of the line under a component's name: its state, size and the models that depend on it. */
export function componentRemark(component: ComponentInfo, lang: string): { key: string; params: (string | number)[] } {
  if (component.installed) {
    const size = formatSize(component.disk_mb, lang)
    if (!component.removable) return { key: 'engines.manage.builtIn', params: [] }
    if (component.dependants.length) return { key: 'engines.manage.installedUsed', params: [size, component.dependants.length] }
    return { key: 'engines.manage.installed', params: [size] }
  }
  if (component.blocked) return { key: 'engines.manage.blocked', params: [component.blocked] }
  return { key: 'engines.manage.notInstalled', params: [formatSize(component.size_mb, lang)] }
}
