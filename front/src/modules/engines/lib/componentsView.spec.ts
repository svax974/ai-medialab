/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ComponentInfo } from '../types'
import { componentRemark, groupComponents } from './componentsView'

const component = (over: Partial<ComponentInfo> = {}): ComponentInfo => ({
  id: 'sdcpp', kind: 'engine', name: 'stable-diffusion.cpp', contents: '', installed: false, removable: false, size_mb: 30, blocked: null,
  disk_mb: 0, dependants: [], ...over,
})

describe('groupComponents', () => {
  it('puts the base data before the engines and drops an empty group', () => {
    const all = [component({ id: 'sdcpp' }), component({ id: 'ffmpeg', kind: 'base' }), component({ id: 'llamacpp' })]
    expect(groupComponents(all).map((g) => [g.kind, g.items.map((c) => c.id)])).toEqual([['base', ['ffmpeg']], ['engine', ['sdcpp', 'llamacpp']]])
    expect(groupComponents([component()]).map((g) => g.kind)).toEqual(['engine'])
  })
})

describe('componentRemark', () => {
  it('says what a missing component will cost, or why it cannot be installed', () => {
    expect(componentRemark(component(), 'fr')).toEqual({ key: 'engines.manage.notInstalled', params: ['30 Mo'] })
    expect(componentRemark(component({ blocked: 'Aucun GPU' }), 'fr')).toEqual({ key: 'engines.manage.blocked', params: ['Aucun GPU'] })
  })

  it('gives the disk usage of an installed component and how many models use it', () => {
    const installed = component({ installed: true, removable: true, disk_mb: 2048 })
    expect(componentRemark(installed, 'fr')).toEqual({ key: 'engines.manage.installed', params: ['2 Go'] })
    expect(componentRemark({ ...installed, dependants: [{ id: 'm', name: 'M', kind: 'image' }] }, 'fr')).toEqual({ key: 'engines.manage.installedUsed', params: ['2 Go', 1] })
  })

  it('flags a build shipped with the application, which cannot be removed', () => {
    expect(componentRemark(component({ installed: true, removable: false }), 'fr').key).toBe('engines.manage.builtIn')
  })
})
