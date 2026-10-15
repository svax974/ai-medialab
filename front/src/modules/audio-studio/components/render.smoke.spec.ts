/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Smoke test of the audio and voice screens: server-side render (no DOM) with a filled query cache, to catch runtime
// errors (bad imports, undefined props) and raw locale keys. Not a visual check, and the interactions are not exercised
// (Zustand stores are read at their initial state, the popovers are closed, the dialog is closed).
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
import { assetKeys } from '@/modules/media-library/lib/assetKeys'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import type { Asset, ConversationDetail, Message } from '@/modules/studio-core/types'
import { ConversationView } from '@/modules/studio-core/components/ConversationView'
import { UserMessage } from '@/modules/studio-core/components/UserMessage'
import { VoiceCard } from '@/modules/voices/components/VoiceCard'
import { VoicesLibrary } from '@/modules/voices/components/VoicesLibrary'
import { VoicePicker } from './VoicePicker'
import { voiceKeys } from '@/modules/voices/lib/voiceKeys'
import type { Voice } from '@/modules/voices/types'
import type { ModelInfo } from '@/modules/model-catalog'
import { audioStudioAdapter } from '../audioStudioAdapter'
import { AudioAssistantMessage } from './AudioAssistantMessage'
import { AudioGallery } from './AudioGallery'
import { AudioHome } from './AudioHome'
import { CastPanel } from './CastPanel'
import { TakeCard } from './TakeCard'

for (const dir of ['modules/studio-core', 'modules/audio-studio', 'modules/voices', 'modules/image-studio', 'modules/studio-shell', 'modules/model-catalog', 'modules/engines', 'modules/hardware', 'modules/chat', 'modules/media-library', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const take = (id: string, extra: Partial<Asset> = {}): Asset =>
  ({
    id, kind: 'generated', media: 'audio', duration: 12.5, url: `/media/outputs/${id}.wav`, thumb_url: '', width: null, height: null, seed: 42, original_name: null, favorite: false, conversation_id: 'c1', message_id: 'a1', created_at: 1_700_000_000,
    meta: { model_id: 'kokoro', prompt: 'Alice : Bonjour\nMarc : Salut', language: 'fr', voice: 'Siwis', peaks: Array.from({ length: 60 }, (_, i) => (i % 10) / 10), markers: [{ start: 0, label: 'Alice' }, { start: 6, label: 'Marc' }] },
    ...extra,
  }) as Asset

const assistant = (extra: Partial<Message> = {}): Message =>
  ({ id: 'a1', conversation_id: 'c1', parent_id: 'u1', role: 'assistant', prompt: 'Alice : Bonjour\nMarc : Salut', model_id: 'kokoro', params: { count: 2, language: 'fr', seeds: [1, 2] }, status: 'done', error: null, created_at: 1_700_000_000, started_at: 1_700_000_001, finished_at: 1_700_000_031, references: [], outputs: [take('t1'), take('t2', { seed: 43, meta: { voice: 'Siwis', peaks: [] } })], ...extra }) as Message
const user = (): Message => ({ ...assistant({ id: 'u1', role: 'user', parent_id: null, params: {}, model_id: null, outputs: [] }) })

const voice = (id: string, extra: Partial<Voice> = {}): Voice => ({ id, name: 'Ma voix', kind: 'clone', transcript: 'Le texte lu.', description: '', language: 'fr', duration: 18.2, peaks: [0.1, 0.4, 0.8, 0.3], url: `/media/uploads/voice_${id}.wav`, created_at: 1_700_000_000, ...extra })

const model = {
  id: 'kokoro', kind: 'audio', engine_pack: 'tts', engine_name: 'Kokoro', engine_detail: '', name: 'Kokoro 82M', family: 'kokoro', description: '', reference_mode: 'none', max_references: 0, requires_references: false, text_to_image: false,
  audio: { task: 'tts', languages: [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }], clone: 'optional', instruct: true, instruct_help: 'ex. : chuchoté', design: false, speed: true, tags: [], max_chars: 500, sample_rate: 24000, voices: [{ id: 'ff_siwis', name: 'Siwis', language: 'fr', gender: 'f', description: 'Voix posée' }, { id: 'fm_pierre', name: 'Pierre', language: 'fr', gender: 'm', description: '' }] },
  params: [{ key: 'speed', label: 'Vitesse', type: 'float', default: 1, min: 0.5, max: 2, step: 0.05, help: '', advanced: false, requires_references: false }],
  size_multiple: 16, min_side: 256, max_side: 2048, default_megapixels: 1, quantize_options: [], default_quantize: null, quantize: null, hf_repo: null, download_size_gb: 0.3, license: 'apache-2.0', gated: false, memory_hint: '', tags: [], backend: 'pack', engine_available: true, engine_reason: null, compatible: true,
  plan: { fits: true, strategy: 'full', note: '' }, install: 'installed', installed_gb: 0.3, download: null, ready: true, needs_engine_install: false, engine_install_size_mb: null, precision: '', custom: false, variants: [], variant: '',
} as unknown as ModelInfo

function render(element: ReactElement, prime: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(modelCatalogKeys.models, { models: [model], default_model_id: null, recommended_model_id: null, ready: false, audio: { default_model_id: 'kokoro', recommended_model_id: 'kokoro', ready: true }, video: { default_model_id: null, recommended_model_id: null, ready: false } })
  client.setQueryData(hardwareKeys.status, { state: 'ready', model_id: null, quantize: null, load_started_at: null, current_message_id: null, queue: [], last_error: null })
  client.setQueryData(voiceKeys.all, [voice('v1'), voice('v2', { name: 'Voix inventée', kind: 'design', transcript: '', description: 'Une voix grave', language: null, duration: null })])
  client.setQueryData(assetKeys.recent('audio'), { items: [take('t1', { prompt: 'Alice : Bonjour' })], next_before: null })
  prime(client)
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MemoryRouter, null, element))))
  return html.replace(/<!-- -->/g, '')
}

const noRawKeys = (html: string) => expect(html).not.toMatch(/(thread|audioStudio|voices|library|studio|models|engines|common)\.[a-z][A-Za-z]+\.[a-zA-Z]/)

describe('audio screens render without error and without raw keys', () => {
  it('shows a take with its player, speakers on the timeline, label and actions', () => {
    const html = render(createElement(TakeCard, { asset: take('t1'), index: 1, total: 3 }))
    expect(html).toContain('Alice')
    expect(html).toContain('Marc')
    expect(html).toContain('prise 2 · Siwis · seed 42')
    expect(html).toContain('0:12')
    expect(html).toContain('Télécharger (WAV)')
    expect(html).toContain('1×')
    noRawKeys(html)
  })

  it('shows a finished synthesis with its takes, summary and actions', () => {
    const html = render(createElement(AudioAssistantMessage, { message: assistant(), siblings: [assistant()] }))
    expect(html).toContain('Kokoro 82M')
    expect(html).toContain('Français')
    expect(html).toContain('généré en')
    expect(html).toContain('Refaire')
    expect(html).toContain('prise 1')
    expect(html).toContain('prise 2')
    noRawKeys(html)
  })

  it('shows the waiting, loading, running, error and cancelled states', () => {
    const queued = render(createElement(AudioAssistantMessage, { message: assistant({ status: 'queued', outputs: [] }) }))
    expect(queued).toContain('en file d&#x27;attente')
    expect(queued).toContain('en attente')
    const loading = render(createElement(AudioAssistantMessage, { message: assistant({ status: 'loading', outputs: [] }) }))
    expect(loading).toContain('chargement du modèle en mémoire')
    const running = render(createElement(AudioAssistantMessage, { message: assistant({ status: 'running', outputs: [take('t1')] }) }))
    expect(running).toContain('synthèse…')
    expect(running).toContain('prise 1/2')
    expect(running).toContain('Annuler')
    const error = render(createElement(AudioAssistantMessage, { message: assistant({ status: 'error', error: 'Voix introuvable.', outputs: [] }) }))
    expect(error).toContain('Voix introuvable.')
    const cancelled = render(createElement(AudioAssistantMessage, { message: assistant({ status: 'cancelled', outputs: [], params: { count: 1 } }) }))
    expect(cancelled).toContain('Synthèse annulée.')
    for (const html of [queued, loading, running, error, cancelled]) noRawKeys(html)
  })

  it('shows the home page with its headline, composer (style, text, counter, voice, language, takes), suggestions and latest takes', () => {
    const html = render(createElement(AudioHome))
    expect(html).toContain('entendre')
    expect(html).toContain('Kokoro 82M')
    expect(html).toContain('Style')
    expect(html).toContain('ex. : chuchoté')
    expect(html).toContain('0 caractères')
    expect(html).toContain('Siwis')
    expect(html).toContain('Français')
    expect(html).toContain('Narration')
    expect(html).toContain('Dernières prises')
    expect(html).toContain('Alice : Bonjour')
    expect(html).toContain('Nouveautés') // the « What's new ? » button next to the model picker
    expect(html).toContain('pour améliorer vos prompts') // the ✨ button, off while no chat model is installed
    noRawKeys(html)
  })

  it('shows a conversation of the audio mode with its thread and composer', () => {
    const conversation: ConversationDetail = { id: 'c1', mode: 'audio', title: 'Mon texte', pinned: false, created_at: 1, updated_at: 2, cover: null, generation_count: 1, busy: false, messages: [user(), assistant()] }
    const html = render(createElement(ConversationView, { id: 'c1', adapters: { audio: audioStudioAdapter } }), (client) => client.setQueryData(studioKeys.conversation('c1'), conversation))
    expect(html).toContain('Mon texte')
    expect(html).toContain('1 synthèse(s)')
    expect(html).toContain('Copier le texte')
    expect(html).toContain('Synthétiser')
    noRawKeys(html)
  })

  it('shows the user text with the audio wording', () => {
    const html = render(createElement(UserMessage, { message: user(), kind: 'audio', onReuse: () => undefined }))
    expect(html).toContain('Alice : Bonjour')
    noRawKeys(html)
  })

  it('shows the cast of a dialogue with a picker per character, and the voice picker', () => {
    const cast = render(createElement(CastPanel, { model, language: 'fr', speakers: ['Alice', 'Marc'], voiceOf: (_n, i) => ({ source: 'preset', id: i === 0 ? 'ff_siwis' : 'fm_pierre' }), onCast: () => undefined, onPlainText: () => undefined }))
    expect(cast).toContain('Scénario à 2 voix')
    expect(cast).toContain('Alice')
    expect(cast).toContain('Pierre')
    expect(cast).toContain('C&#x27;est un simple texte')
    const picker = render(createElement(VoicePicker, { model, language: 'fr', value: { source: 'library', id: 'v1' }, onChange: () => undefined }))
    expect(picker).toContain('Ma voix')
    noRawKeys(cast + picker)
  })

  it('shows a voice that is designed from a description as a reminder, not a choice', () => {
    const design = { ...model, audio: { ...model.audio, design: true } } as unknown as ModelInfo
    const html = render(createElement(VoicePicker, { model: design, language: 'fr', value: undefined, onChange: () => undefined }))
    expect(html).toContain('Voix décrite ci-dessus')
  })

  it('shows the audio library page (empty here: the gallery loads on the client)', () => {
    const html = render(createElement(AudioGallery))
    expect(html).toContain('Bibliothèque')
    expect(html).toContain('prises')
    noRawKeys(html)
  })
})

describe('voice screens render without error and without raw keys', () => {
  it('shows the library with a card per voice, the count and the add button', () => {
    const html = render(createElement(VoicesLibrary, { onUse: () => undefined }))
    expect(html).toContain('Mes voix')
    expect(html).toContain('2 voix')
    expect(html).toContain('Ajouter une voix')
    expect(html).toContain('Ma voix')
    expect(html).toContain('voix clonée')
    expect(html).toContain('FR')
    expect(html).toContain('0:18')
    expect(html).toContain('« Le texte lu. »')
    expect(html).toContain('voix inventée')
    expect(html).toContain('sans transcription')
    expect(html).toContain('« Une voix grave »')
    expect(html).toContain('Écrire avec cette voix')
    noRawKeys(html)
  })

  it('shows the invitation when the library is empty', () => {
    const html = render(createElement(VoicesLibrary, { onUse: () => undefined }), (client) => client.setQueryData(voiceKeys.all, []))
    expect(html).toContain('votre')
    expect(html).toContain('Enregistrer ma voix')
    noRawKeys(html)
  })

  it('shows one voice card with its actions', () => {
    const html = render(createElement(VoiceCard, { voice: voice('v9'), onEdit: () => undefined, onDelete: () => undefined, onUse: () => undefined }))
    expect(html).toContain('Modifier')
    expect(html).toContain('Supprimer')
    expect(html).toContain('Écouter')
    noRawKeys(html)
  })
})
