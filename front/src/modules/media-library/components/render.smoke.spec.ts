/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Smoke test of the gallery: server-side render (no DOM) with a filled query cache, to catch runtime errors (bad imports,
// undefined props) and raw locale keys. Not a visual check; the filter and pagination logic is in lib/*.spec.ts.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const fr = vi.hoisted(() => ({ texts: {} as Record<string, string> }))
vi.mock('@/modules_shared/common/core/i18n/I18n', () => ({
  i18n: {
    get: (key: string, params?: (string | number)[]) => (fr.texts[key] ?? key).replace(/\{(\d+)\}/g, (_m, i) => String(params?.[Number(i)] ?? '')),
    getLang: () => 'fr',
    addEventListener: () => 0,
    removeEventListerner: () => undefined,
  },
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { ImageGallery } from '@/modules/image-studio'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import { assetKeys } from '../lib/assetKeys'
import type { Asset, AssetMedia } from '../types'
import { AssetGallery } from './AssetGallery'
import { DropVeil } from './DropVeil'
import { VideoPosterTile } from './VideoPosterTile'

for (const dir of ['media-library', 'studio-core', 'studio-shell']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../..', dir, 'locales/locales.fr.json'), 'utf8')))
}

const asset = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, kind: 'generated', media: 'image', duration: null, url: `/media/outputs/${id}.png`, thumb_url: `/media/thumbs/${id}.webp`, width: 1024, height: 768, seed: 11, original_name: null, favorite: false, meta: {}, conversation_id: 'c1', message_id: 'a1', created_at: 1_700_000_000, prompt: `prompt ${id}`, conversation_title: 'Mon chat', model_id: 'flux', ...extra }) as Asset

function render(element: ReactElement, prime: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  prime(client)
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MemoryRouter, null, element))))
  return html.replace(/<!-- -->/g, '')
}

const noRawKeys = (html: string) => expect(html).not.toMatch(/(library|thread|studio)\.[a-z][A-Za-z]+\.[a-zA-Z]/)
const prime = (media: AssetMedia, items: Asset[], next: number | null = null) => (client: QueryClient) =>
  client.setQueryData(assetKeys.list(media, false, ''), { pages: [{ items, next_before: next }], pageParams: [null] })

describe('gallery screens render without error and without raw keys', () => {
  it('shows the image gallery with its title, count, filters and tiles', () => {
    const html = render(createElement(ImageGallery), prime('image', [asset('i1'), asset('i2')], 5))
    expect(html).toContain('Galerie')
    expect(html).toContain('2+ tirages')
    expect(html).toContain('Filtrer par prompt')
    expect(html).toContain('Favoris')
    expect(html).toContain('/api/media/thumbs/i1.webp')
    expect(html).toContain('prompt i2')
    expect(html).toContain('Agrandir')
    noRawKeys(html)
  })

  it('shows the empty message of an empty gallery', () => {
    const html = render(createElement(ImageGallery), prime('image', []))
    expect(html).toContain('Aucune image générée pour l&#x27;instant.')
    noRawKeys(html)
  })

  it('shows the library of the other media with their own texts', () => {
    const video = render(createElement(AssetGallery, { media: 'video', renderTile: (a, _i, open) => createElement(VideoPosterTile, { asset: a, onOpen: open }) }), prime('video', [asset('v1', { media: 'video', duration: 65 })]))
    expect(video).toContain('1 clips')
    expect(video).toContain('1:05')
    expect(video).toContain('/api/media/thumbs/v1.webp')
    const audio = render(createElement(AssetGallery, { media: 'audio', renderTile: (a) => createElement('i', null, a.id) }), prime('audio', []))
    expect(audio).toContain('Aucune prise audio pour l&#x27;instant.')
    noRawKeys(video)
    noRawKeys(audio)
  })

  it('shows the drop veil', () => {
    const html = render(createElement(DropVeil, { title: 'Déposez vos images', body: 'Elles serviront.' }))
    expect(html).toContain('Déposez vos images')
  })
})
