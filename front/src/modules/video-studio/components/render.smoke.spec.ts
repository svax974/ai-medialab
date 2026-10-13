/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Smoke test of the video screens: server-side render (no DOM) with a filled query cache and stores, to catch runtime errors
// (bad imports, undefined props) and raw locale keys. Not a visual check, and the interactions are not exercised (popovers
// are closed, the player is not started, the viewer is not opened). Server rendering reads a Zustand store at its initial
// state, so what depends on a store (slots filled, live progress, queue position) is tested through the presentational
// parts that take it as props (`FilledTile`, `UploadingTile`, `VideoStatusView`) and through the pure logic in `lib/`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { useModelSelectionStore } from '@/modules/model-catalog/state/modelSelectionStore'
import { assetKeys } from '@/modules/media-library/lib/assetKeys'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import type { Asset, ConversationDetail, Message } from '@/modules/studio-core/types'
import { ConversationView } from '@/modules/studio-core/components/ConversationView'
import type { ModelInfo } from '@/modules/model-catalog'
import { videoStudioAdapter } from '../videoStudioAdapter'
import { useVideoDraftStore } from '../state/videoDraftStore'
import { ClipTile, PendingClip } from './ClipTile'
import { FilledTile, SlotTile, UploadingTile } from './SlotTile'
import { VideoStatusView } from './VideoStatusLine'
import { VideoAssistantMessage } from './VideoAssistantMessage'
import { VideoComposer } from './VideoComposer'
import { VideoGallery } from './VideoGallery'
import { VideoHome } from './VideoHome'
import { VideoViewerActions } from './VideoViewerActions'
import { ClipCountPicker, DurationPicker, FormatPicker } from './VideoPickers'

for (const dir of ['modules/studio-core', 'modules/video-studio', 'modules/image-studio', 'modules/studio-shell', 'modules/model-catalog', 'modules/engines', 'modules/hardware', 'modules/media-library', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const clip = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({ id, kind: 'generated', media: 'video', duration: 5.06, fps: 16, url: `/media/outputs/${id}.mp4`, thumb_url: `/media/thumbs/${id}.webp`, width: 832, height: 480, seed: 42, original_name: null, favorite: false, conversation_id: 'c1', message_id: 'a1', created_at: 1_700_000_000, prompt: 'un chat qui court', meta: { model_id: 'wan', prompt: 'un chat qui court' }, ...extra }) as Asset
const image = (id: string): Asset => ({ ...clip(id), media: 'image', kind: 'upload', duration: null, fps: null, original_name: `${id}.png`, url: `/media/uploads/${id}.png` }) as Asset

const assistant = (extra: Partial<Message> = {}): Message =>
  ({ id: 'a1', conversation_id: 'c1', parent_id: 'u1', role: 'assistant', prompt: 'un chat qui court', model_id: 'wan', params: { count: 2, aspect: '16:9', width: 832, height: 480, seconds: 5.06, steps: 40, resolution: '480p', seeds: [1, 2] }, status: 'done', error: null, created_at: 1_700_000_000, started_at: 1_700_000_001, finished_at: 1_700_000_091, references: [], outputs: [clip('c1'), clip('c2', { seed: 43 })], ...extra }) as Message
const user = (): Message => ({ ...assistant({ id: 'u1', role: 'user', parent_id: null, params: {}, model_id: null, outputs: [], references: [image('start')] }) })

const base = {
  kind: 'video', audio: null, engine_pack: null, engine_name: null, engine_detail: '', family: 'Wan', description: '', reference_mode: 'none', max_references: 0, requires_references: false, text_to_image: false,
  params: [
    { key: 'steps', label: 'Étapes', type: 'int', default: 40, min: 10, max: 60, step: 1, help: '', advanced: false, requires_references: false },
    { key: 'strength', label: 'Influence', type: 'float', default: 0.7, min: 0, max: 1, step: 0.05, help: '', advanced: true, requires_references: true },
  ],
  size_multiple: 16, min_side: 256, max_side: 2048, default_megapixels: 1, quantize_options: [], default_quantize: null, quantize: null, hf_repo: null, download_size_gb: 8, license: 'apache-2.0', gated: false, memory_hint: '', tags: [], backend: 'torch',
  engine_available: true, engine_reason: null, compatible: true, plan: { fits: true, strategy: 'full', note: '' }, install: 'installed', installed_gb: 8, download: null, ready: true, needs_engine_install: false, engine_install_size_mb: null, precision: '', custom: false, variants: [], variant: '',
}
const caps = { tasks: ['t2v', 'i2v'], fps: 16, frame_step: 4, default_seconds: 5, min_seconds: 1, max_seconds: 5, resolutions: [{ id: '480p', label: '480p', short_side: 480, long_side: 832 }, { id: '720p', label: '720p', short_side: 704, long_side: 1280 }], default_resolution: '480p', image_input: 'optional', last_frame: true, image_role: 'start', video_input: 'optional', audio_out: true, english_only: true, license_warning: '' }
const wan = { ...base, id: 'wan', name: 'Wan 2.2', video: caps } as unknown as ModelInfo
const textOnly = { ...base, id: 'cog', name: 'CogVideoX', video: { ...caps, tasks: ['t2v'], image_input: 'none', last_frame: false, video_input: 'none', audio_out: false, english_only: false } } as unknown as ModelInfo

function render(element: ReactElement, models: ModelInfo[] = [wan], prime: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(modelCatalogKeys.models, { models, default_model_id: null, recommended_model_id: null, ready: false, audio: { default_model_id: null, recommended_model_id: null, ready: false }, video: { default_model_id: models[0].id, recommended_model_id: models[0].id, ready: true } })
  client.setQueryData(hardwareKeys.status, { state: 'ready', model_id: null, quantize: null, load_started_at: null, current_message_id: null, queue: [], last_error: null })
  client.setQueryData(assetKeys.recent('video'), { items: [clip('c1')], next_before: null })
  prime(client)
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MemoryRouter, null, element))))
  return html.replace(/<!-- -->/g, '').replace(/[\u00a0\u202f]/g, ' ')
}

const noRawKeys = (html: string) => expect(html).not.toMatch(/(thread|videoStudio|library|studio|models|engines|common)\.[a-z][A-Za-z]+\.[a-zA-Z]/)

beforeEach(() => {
  useVideoDraftStore.setState({ prompt: '', start: null, end: null, source: null, uploads: [], paramsByModel: {}, count: 1, seed: null })
  useModelSelectionStore.setState({ selected: { image: null, audio: null, video: null } })
})

describe('video screens render without error and without raw keys', () => {
  it('shows the home page: headline, composer, starter prompts, latest clips', () => {
    const html = render(createElement(VideoHome))
    expect(html).toContain('Studio vidéo local')
    expect(html).toContain('tourner')
    expect(html).toContain('Wan 2.2')
    expect(html).toContain('Décrivez la scène à filmer')
    expect(html).toContain('Paysage')
    expect(html).toContain('Animation')
    expect(html).toContain('Derniers clips')
    expect(html).toContain('0:05')
    noRawKeys(html)
  })

  it('shows the composer with the slots the model accepts, the duration, the format with its definition, the settings and the clip count', () => {
    const html = render(createElement(VideoComposer, { conversationId: null }))
    expect(html).toContain('source')
    expect(html).toContain('départ')
    expect(html).toContain('fin')
    expect(html).toContain('option')
    expect(html).toContain('5 s')
    expect(html).toContain('16:9')
    expect(html).toContain('480p')
    expect(html).toContain('Réglages')
    expect(html).toContain('Nombre de clips')
    expect(html).toContain('Générer la vidéo')
    expect(html).toContain('comprend surtout l&#x27;anglais')
    expect(html).toContain('génère aussi une bande son')
    noRawKeys(html)
  })

  it('draws no slot for a text-only model', () => {
    const html = render(createElement(VideoComposer, { conversationId: null }), [textOnly])
    expect(html).not.toContain('départ')
    expect(html).not.toContain('Image de fin')
    expect(html).toContain('CogVideoX')
    noRawKeys(html)
  })

  it('shows a required start image in warning tone, with the notice', () => {
    const needStart = { ...wan, video: { ...caps, image_input: 'required' } } as unknown as ModelInfo
    const html = render(createElement(VideoComposer, { conversationId: null }), [needStart])
    expect(html).toContain('requis')
    expect(html).toContain('part d&#x27;une image : ajoutez l&#x27;image de départ.')
    noRawKeys(html)
  })

  it('shows the licence warning, the restricted access notice and a model that cannot run here', () => {
    const licensed = { ...wan, gated: true, video: { ...caps, license_warning: 'Usage interdit dans l\'Union européenne.' } } as unknown as ModelInfo
    const html = render(createElement(VideoComposer, { conversationId: null }), [licensed])
    expect(html).toContain('Licence')
    expect(html).toContain('Union européenne')
    expect(html).toContain('Accès restreint')
    const broken = render(createElement(VideoComposer, { conversationId: null }), [{ ...wan, compatible: false, ready: false, engine_reason: 'Moteur vidéo absent.' } as unknown as ModelInfo])
    expect(broken).toContain('Moteur vidéo absent.')
    noRawKeys(html + broken)
  })

  it('shows a filled slot with its role and a remove button, a source video, an input the model ignores, and an import in progress', () => {
    const drag = {}
    const start = render(createElement(FilledTile, { slot: 'start', asset: image('start'), label: 'Image de départ', short: 'départ', unused: false, over: false, dragProps: drag }))
    expect(start).toContain('Voir : Image de départ')
    expect(start).toContain('Retirer : Image de départ')
    expect(start).toContain('départ')
    const source = render(createElement(FilledTile, { slot: 'source', asset: clip('src'), label: 'Vidéo source', short: 'source', unused: false, over: false, dragProps: drag }))
    expect(source).toContain('MovieOutlinedIcon')
    const ignored = render(createElement(FilledTile, { slot: 'end', asset: image('end'), label: 'Image de fin', short: 'fin', unused: true, over: false, dragProps: drag }))
    expect(ignored).toContain('ignorée')
    const uploading = render(createElement(UploadingTile, { upload: { id: 'u', slot: 'end', name: 'fin.png', progress: 0.4 } }))
    expect(uploading).toContain('40 %')
    expect(uploading).toContain('Import de fin.png')
    noRawKeys(start + source + ignored + uploading)
  })

  it('shows one slot tile on its own: empty, with its name and whether it is optional', () => {
    const html = render(createElement(SlotTile, { slot: 'end', model: wan }))
    expect(html).toContain('Image de fin (facultative)')
    expect(html).toContain('option')
    noRawKeys(html)
  })

  it('shows the pickers closed: duration, format and definition, clip count', () => {
    const html = render(createElement('div', null, createElement(DurationPicker, { model: wan, seconds: 3, onChange: () => undefined }), createElement(FormatPicker, { model: wan, aspect: '9:16', resolution: '720p', onChange: () => undefined }), createElement(ClipCountPicker, { value: 2, onChange: () => undefined })))
    expect(html).toContain('3 s')
    expect(html).toContain('9:16')
    expect(html).toContain('720p')
    expect(html).toContain('aria-pressed="true"')
    noRawKeys(html)
  })

  it('shows a conversation of the video mode with its thread and composer', () => {
    const conversation: ConversationDetail = { id: 'c1', mode: 'video', title: 'Mon plan', pinned: false, created_at: 1, updated_at: 2, cover: null, generation_count: 2, busy: false, messages: [user(), assistant()] }
    const html = render(createElement(ConversationView, { id: 'c1', adapters: { video: videoStudioAdapter } }), [wan], (client) => client.setQueryData(studioKeys.conversation('c1'), conversation))
    expect(html).toContain('Mon plan')
    expect(html).toContain('2 clip(s)')
    expect(html).toContain('Copier le prompt')
    expect(html).toContain('Générer la vidéo')
    expect(html).toContain('<video')
    noRawKeys(html)
  })
})

describe('video messages render all their states', () => {
  it('shows a finished generation with two clips, its summary and actions', () => {
    const html = render(createElement(VideoAssistantMessage, { message: assistant(), siblings: [user(), assistant()] }))
    expect(html).toContain('Wan 2.2')
    expect(html).toContain('832×480')
    expect(html).toContain('5,1 s')
    expect(html).toContain('40 étapes')
    expect(html).toContain('généré en')
    expect(html.match(/<video/g)).toHaveLength(2)
    expect(html).toContain('Télécharger (MP4)')
    expect(html).toContain('Utiliser comme vidéo source (modifier)')
    expect(html).toContain('Dernière image comme départ (poursuivre le plan)')
    expect(html).toContain('Varier')
    expect(html).toContain('Reprendre ces réglages dans le composer')
    noRawKeys(html)
  })

  it('shows the waiting, loading, running (step, stage, fast decoding) and finished lines, and the error and cancelled messages', () => {
    const view = (status: Parameters<typeof VideoStatusView>[0]['status'], clips = 2) => render(createElement(VideoStatusView, { status, clips }))
    expect(view({ kind: 'queued', position: null })).toContain('en file d&#x27;attente')
    expect(view({ kind: 'queued', position: 2 })).toContain('position 2')
    const loading = view({ kind: 'loading', elapsed: 65, downloadable: true })
    expect(loading).toContain('chargement du modèle en mémoire · 1:05')
    expect(loading).toContain('téléchargement possible')
    const running = view({ kind: 'running', step: 8, total: 40, stageKey: 'thread.status.preparing', clip: 1, eta: 120 })
    expect(running).toContain('étape 8/40')
    expect(running).toContain('clip 1/2')
    expect(running).toContain('~2 min')
    expect(view({ kind: 'running', step: null, total: null, stageKey: 'videoStudio.stage.decodeFast', clip: null, eta: null })).toContain('décodage rapide de la vidéo…')
    expect(view({ kind: 'running', step: null, total: null, stageKey: 'videoStudio.stage.decode', clip: null, eta: null })).toContain('peut durer plusieurs minutes')
    expect(view({ kind: 'running', step: null, total: null, stageKey: 'videoStudio.stage.encode', clip: null, eta: null })).toContain('encodage MP4…')
    expect(view({ kind: 'running', step: null, total: null, stageKey: 'videoStudio.stage.fetch', clip: null, eta: null })).toContain('décodeur rapide (23 Mo)')
    const meta = view({ kind: 'meta', size: '832×480', seconds: 5.06, steps: 40, duration: 90, createdAt: 1_700_000_000 })
    expect(meta).toContain('832×480 · 5,1 s · 40 étapes · généré en')
    const error = render(createElement(VideoAssistantMessage, { message: assistant({ status: 'error', error: 'Mémoire insuffisante.', outputs: [] }) }))
    expect(error).toContain('Mémoire insuffisante.')
    const cancelled = render(createElement(VideoAssistantMessage, { message: assistant({ status: 'cancelled', outputs: [], params: { count: 1 } }) }))
    expect(cancelled).toContain('Génération annulée.')
    for (const html of [loading, running, meta, error, cancelled]) noRawKeys(html)
  })

  it('shows the pending cells of a message that waits or loads, and the cancel button', () => {
    const queued = render(createElement(VideoAssistantMessage, { message: assistant({ status: 'queued', outputs: [] }) }))
    expect(queued.match(/en attente/g)).toHaveLength(2)
    expect(queued).toContain('Annuler')
    const loading = render(createElement(VideoAssistantMessage, { message: assistant({ status: 'loading', outputs: [], params: { count: 1 } }) }))
    expect(loading).toContain('chargement du modèle')
    noRawKeys(queued + loading)
  })

  it('shows a clip tile, a favorite one, and a pending tile', () => {
    const html = render(createElement('div', null, createElement(ClipTile, { asset: clip('c9', { favorite: true }), ratio: 16 / 9, fresh: true, onOpen: () => undefined }), createElement(PendingClip, { ratio: 16 / 9, fraction: 0.5, active: true, label: 'étape 5/10' })))
    expect(html).toContain('Retirer des favoris')
    expect(html).toContain('étape 5/10')
    expect(html).toContain('/media/outputs/c9.mp4')
    expect(html).toContain('poster="')
    noRawKeys(html)
  })

  it('shows the viewer actions for a clip and for an image', () => {
    const forClip = render(createElement(VideoViewerActions, { asset: clip('c1') }))
    expect(forClip).toContain('Utiliser comme vidéo source (modifier)')
    expect(forClip).toContain('Dernière image comme départ')
    const forImage = render(createElement(VideoViewerActions, { asset: image('i1') }))
    expect(forImage).toContain('Utiliser comme image de départ')
    noRawKeys(forClip + forImage)
  })

  it('shows the library page (empty here: the gallery loads on the client)', () => {
    const html = render(createElement(VideoGallery))
    expect(html).toContain('Bibliothèque')
    expect(html).toContain('clips')
    expect(html).toContain('Filtrer par prompt')
    noRawKeys(html)
  })
})
