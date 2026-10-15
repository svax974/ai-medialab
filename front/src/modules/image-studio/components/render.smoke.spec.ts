/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Smoke test of the screens: server-side render (no DOM) of the thread and the composer with a filled query cache, to
// catch runtime errors (bad imports, undefined props) and raw locale keys. Not a visual check.
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
import { hardwareKeys } from '@/modules/hardware/lib/hardwareKeys'
import { modelCatalogKeys } from '@/modules/model-catalog/lib/modelCatalogKeys'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import type { Asset, ConversationDetail, Message } from '@/modules/studio-core/types'
import { AssistantMessage } from '@/modules/studio-core/components/AssistantMessage'
import { ConversationView } from '@/modules/studio-core/components/ConversationView'
import { EngineCard } from '@/modules/studio-core/components/EngineCard'
import { UserMessage } from '@/modules/studio-core/components/UserMessage'
import type { ModelInfo } from '@/modules/model-catalog'
import { ImageHome } from '../components/ImageHome'
import { ReferenceStrip } from '../components/ReferenceStrip'
import { imageStudioAdapter } from '../imageStudioAdapter'

for (const [dir, module] of [['modules/studio-core', ''], ['modules/image-studio', ''], ['modules/studio-shell', ''], ['modules/model-catalog', ''], ['modules/engines', ''], ['modules/hardware', ''], ['modules/chat', '']] as const) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')), module ? {} : {})
}

const asset = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, kind: 'generated', media: 'image', duration: null, url: `/media/outputs/${id}.png`, thumb_url: `/media/thumbs/${id}.webp`, width: 1024, height: 768, seed: 11, original_name: null, favorite: false, meta: { prompt: 'un chat', model_id: 'flux', steps: 8 }, conversation_id: 'c1', message_id: 'a1', created_at: 1_700_000_000, ...extra }) as Asset

const assistant = (extra: Partial<Message> = {}): Message =>
  ({ id: 'a1', conversation_id: 'c1', parent_id: 'u1', role: 'assistant', prompt: 'un chat', model_id: 'flux', params: { count: 2, width: 1024, height: 768, steps: 8, seeds: [1, 2] }, status: 'done', error: null, created_at: 1_700_000_000, started_at: 1_700_000_001, finished_at: 1_700_000_031, references: [], outputs: [asset('i1'), asset('i2')], ...extra }) as Message

const user = (): Message => ({ ...assistant({ id: 'u1', role: 'user', parent_id: null, params: {}, model_id: null, outputs: [], references: [asset('r1', { kind: 'upload' })] }) })

const model = {
  id: 'flux', kind: 'image', audio: null, engine_pack: null, engine_name: 'GGUF', engine_detail: '', name: 'Flux Schnell', family: 'flux', description: 'Rapide', reference_mode: 'init', max_references: 1, requires_references: false, text_to_image: true,
  params: [
    { key: 'steps', label: 'Étapes', type: 'int', default: 8, min: 1, max: 50, step: 1, help: '', advanced: false, requires_references: false },
    { key: 'guidance', label: 'Guidance', type: 'float', default: 3.5, min: 0, max: 10, step: 0.5, help: 'Fidélité au prompt.', advanced: false, requires_references: false },
    { key: 'strength', label: 'Influence', type: 'float', default: 0.7, min: 0, max: 1, step: 0.05, help: '', advanced: true, requires_references: true },
  ],
  size_multiple: 16, min_side: 256, max_side: 2048, default_megapixels: 1, quantize_options: [], default_quantize: null, quantize: null, hf_repo: null, download_size_gb: 6, license: 'apache-2.0', gated: false, memory_hint: '', tags: [], backend: 'sdcpp', engine_available: true, engine_reason: null, compatible: true,
  plan: { fits: true, strategy: 'full', note: '' }, install: 'installed', installed_gb: 6, download: null, ready: true, needs_engine_install: false, engine_install_size_mb: null, precision: 'Q4_K', custom: false, variants: [], variant: '',
}

function render(element: ReactElement, prime: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(modelCatalogKeys.models, { models: [model], default_model_id: 'flux', recommended_model_id: 'flux', ready: true, audio: { default_model_id: null, recommended_model_id: null, ready: false }, video: { default_model_id: null, recommended_model_id: null, ready: false } })
  client.setQueryData(hardwareKeys.status, { state: 'ready', model_id: 'flux', quantize: 4, load_started_at: null, current_message_id: null, queue: [], last_error: null })
  client.setQueryData(['assets', 'recent', 'image'], { items: [asset('i1'), asset('i2')], next_before: null })
  prime(client)
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MemoryRouter, null, element))))
  return html.replace(/<!-- -->/g, '')
}

const noRawKeys = (html: string) => expect(html).not.toMatch(/(thread|imageStudio|models|engines|studio)\.[a-z][A-Za-z]+\.[a-zA-Z]/)

describe('screens render without error and without raw keys', () => {
  it('shows a prompt with its references and its actions', () => {
    const html = render(createElement(UserMessage, { message: user(), kind: 'image', onReuse: () => undefined }))
    expect(html).toContain('un chat')
    expect(html).toContain('Copier le prompt')
    expect(html).toContain('/api/media/thumbs/r1.webp')
    noRawKeys(html)
  })

  it('shows a finished generation with its images, summary and actions', () => {
    const html = render(createElement(AssistantMessage, { message: assistant(), siblings: [assistant()] }))
    expect(html).toContain('Flux Schnell')
    expect(html).toContain('1024×768')
    expect(html).toContain('8 étapes')
    expect(html).toContain('Varier')
    expect(html).toContain('/api/media/thumbs/i1.webp')
    noRawKeys(html)
  })

  // (A server render reads the initial state of a Zustand store, so the live progress and the draft are not exercised here:
  // their logic is covered by messageState.spec.ts and stores.spec.ts.)
  it('shows a running generation, still preparing, with Cancel and the developing cells', () => {
    const html = render(createElement(AssistantMessage, { message: assistant({ status: 'running', outputs: [] }), siblings: [] }))
    expect(html).toContain('préparation…')
    expect(html).toContain('image 1/2')
    expect(html).toContain('Annuler')
    noRawKeys(html)
  })

  it('shows the waiting, loading, error and cancelled states', () => {
    const queued = render(createElement(AssistantMessage, { message: assistant({ status: 'queued', outputs: [] }), siblings: [] }))
    expect(queued).toContain("en file d&#x27;attente")
    const loading = render(createElement(AssistantMessage, { message: assistant({ status: 'loading', outputs: [] }), siblings: [] }))
    expect(loading).toContain('chargement du modèle en mémoire')
    const error = render(createElement(AssistantMessage, { message: assistant({ status: 'error', error: 'Plus de mémoire.', outputs: [] }), siblings: [] }))
    expect(error).toContain('Plus de mémoire.')
    const cancelled = render(createElement(AssistantMessage, { message: assistant({ status: 'cancelled', outputs: [], params: { count: 1 } }), siblings: [] }))
    expect(cancelled).toContain('Génération annulée.')
    for (const html of [queued, loading, error, cancelled]) noRawKeys(html)
  })

  it('shows the engine card with the loaded model', () => {
    const html = render(createElement(EngineCard))
    expect(html).toContain('Flux Schnell')
    expect(html).toContain('4 bits · en mémoire')
    noRawKeys(html)
  })

  it('shows the home page with its headline, composer, suggestions and latest images', () => {
    const html = render(createElement(ImageHome))
    expect(html).toContain('révéler')
    expect(html).toContain('Flux Schnell')
    expect(html).toContain('Portrait')
    expect(html).toContain('Derniers tirages')
    expect(html).toContain('1024×1024')
    expect(html).toContain('Nouveautés') // the « What's new ? » button next to the model picker
    expect(html).toContain('pour améliorer vos prompts') // the ✨ button, off while no chat model is installed
    noRawKeys(html)
  })

  it('shows the reference strip with the role of each image for an img2img model', () => {
    const html = render(createElement(ReferenceStrip, { model: model as unknown as ModelInfo, references: [asset('r1', { kind: 'upload' }), asset('r2', { kind: 'upload' })], uploading: [{ tempId: 't', previewUrl: 'blob:x', name: 'x.png' }], onRemove: () => undefined }))
    expect(html).toContain('départ')
    expect(html).toContain('ignorée')
    expect(html).toContain('blob:x')
    expect(html).toContain('Retirer l&#x27;image')
    noRawKeys(html)
  })

  it('shows a conversation with its title, its messages and the composer', () => {
    const conversation: ConversationDetail = { id: 'c1', mode: 'image', title: 'Mon chat', pinned: true, created_at: 1, updated_at: 2, cover: null, generation_count: 1, busy: false, messages: [user(), assistant()] }
    const html = render(createElement(ConversationView, { id: 'c1', adapters: { image: imageStudioAdapter } }), (client) => client.setQueryData(studioKeys.conversation('c1'), conversation))
    expect(html).toContain('Mon chat')
    expect(html).toContain('1 génération(s)')
    expect(html).toContain('Flux Schnell')
    noRawKeys(html)
  })

  it('shows a notice for a conversation of a mode that has no studio yet', () => {
    const conversation = { id: 'c2', mode: 'audio', title: 'Voix', pinned: false, created_at: 1, updated_at: 2, cover: null, generation_count: 0, busy: false, messages: [] } as ConversationDetail
    const html = render(createElement(ConversationView, { id: 'c2', adapters: { image: imageStudioAdapter } }), (client) => client.setQueryData(studioKeys.conversation('c2'), conversation))
    expect(html).toContain('sera repris dans la nouvelle interface')
  })
})
