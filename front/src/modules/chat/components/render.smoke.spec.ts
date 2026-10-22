/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

// Smoke test of the chat screens: server-side render (no DOM) with a filled query cache and stores, to catch runtime
// errors (bad imports, undefined props) and raw locale keys. Not a visual check: popovers are closed, the Markdown
// renderer is a lazy chunk (the plain-text fallback is what a server render shows), and interactions are not exercised.
// The logic is tested in `lib/`, `services/` and `state/`.
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
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import type { ModelInfo } from '@/modules/model-catalog'
import { chatKeys } from '../lib/chatKeys'
import { conversation, message } from '../lib/fixtures'
import { useChatDefaultsStore, BASE_SETTINGS } from '../state/chatDefaultsStore'
import { useChatDraftStore } from '../state/chatDraftStore'
import { useChatLiveStore } from '../state/chatLiveStore'
import type { ChatConversation, ChatGeneration } from '../types'
import { ChatErrorNotice } from './ChatErrorNotice'
import { ChatHome } from './ChatHome'
import { ChatComposer } from './ChatComposer'
import { ChatStatusLine } from './ChatStatusLine'
import { ChatThread } from './ChatThread'
import { CompareView } from './CompareView'
import { ContextField } from './ContextField'
import { ExportMenu } from './ExportMenu'
import { Generations } from './GenerationCard'
import { LlmStatusChip, LlmStatusView } from './LlmStatusChip'

for (const dir of ['modules/chat', 'modules/studio-core', 'modules/studio-shell', 'modules/model-catalog', 'modules/engines', 'modules/hardware', 'modules/settings', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const base = {
  kind: 'llm', audio: null, engine_pack: null, engine_name: 'llama.cpp', engine_detail: '', family: 'Qwen', description: 'Un modèle de chat.', reference_mode: 'none', max_references: 0, requires_references: false, text_to_image: false, params: [],
  size_multiple: 1, min_side: 0, max_side: 0, default_megapixels: 0, quantize_options: [], default_quantize: null, quantize: null, hf_repo: 'Qwen/Qwen3-8B-GGUF', download_size_gb: 4.7, license: 'Apache 2.0', gated: false, memory_hint: '', tags: [], backend: 'llamacpp',
  engine_available: true, engine_reason: null, compatible: true, plan: { fits: true, strategy: 'full', note: '' }, install: 'installed', installed_gb: 4.7, download: null, ready: true, needs_engine_install: false, engine_install_size_mb: null, precision: 'Q4_K_M', custom: false, variants: [], variant: 'Q4_K_M',
}
const caps = { context_default: 16384, context_max: 32768, vision: true, tools: true, reasoning: 'toggle', moe: false, params_b: 8, active_params_b: null }
const qwen = { ...base, id: 'qwen', name: 'Qwen3 8B', llm: caps } as unknown as ModelInfo
const gemma = { ...base, id: 'gemma', name: 'Gemma 4 12B', llm: { ...caps, tools: false, vision: false } } as unknown as ModelInfo

function render(element: ReactElement, models: ModelInfo[] = [qwen, gemma], prime: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(modelCatalogKeys.models, { models, default_model_id: null, recommended_model_id: null, ready: false, audio: { default_model_id: null, recommended_model_id: null, ready: false }, video: { default_model_id: null, recommended_model_id: null, ready: false }, llm: { default_model_id: models[0].id, recommended_model_id: models[0].id, ready: true } })
  client.setQueryData(hardwareKeys.status, { state: 'idle', model_id: null, quantize: null, load_started_at: null, current_message_id: null, queue: [], last_error: null })
  prime(client)
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MemoryRouter, null, element))))
  return html.replace(/<!-- -->/g, '').replace(/[\u00a0\u202f]/g, ' ')
}

const noRawKeys = (html: string) => expect(html).not.toMatch(/(chat|thread|studio|models|engines|settings|common)\.[a-z][A-Za-z]+\.[a-zA-Z]/)

const user = message('u1', { content: 'Quel temps fait-il à Lyon ?', sibling_ids: ['u1', 'u1b'], sibling_index: 0 })
const answer = message('a1', {
  role: 'assistant', parent_id: 'u1', model_id: 'qwen', content: 'Il pleut à Lyon.', reasoning: 'Je cherche la météo.',
  sibling_ids: ['a1', 'a2', 'a3'], sibling_index: 1,
  tool_runs: [{ id: 'r1', name: 'web_search', arguments: { query: 'météo Lyon' }, status: 'done', sources: [{ title: 'Météo-France', url: 'https://meteofrance.com/lyon' }] }],
  stats: { prompt_tokens: 40, completion_tokens: 12, tokens_per_second: 31.5, context_size: 16384, elapsed_ms: 2400 },
})
const primeConversation = (data: ChatConversation) => (client: QueryClient) => client.setQueryData(chatKeys.conversation('c1'), data)

beforeEach(() => {
  useModelSelectionStore.setState({ selected: { image: null, audio: null, video: null, llm: null } })
  useChatDraftStore.setState({ texts: {}, attachments: {}, pending: null, seen: {} })
  useChatDefaultsStore.setState({ settings: BASE_SETTINGS })
  useChatLiveStore.setState({ streams: {}, status: null })
})

describe('chat screens render without error and without raw keys', () => {
  it('shows the home page: headline, hero composer with the model and its tools, starter messages, privacy note', () => {
    const html = render(createElement(ChatHome))
    expect(html).toContain('Conversation locale')
    expect(html).toContain('reste chez vous')
    expect(html).toContain('Posez une question, collez un texte, déposez une image…')
    expect(html).toContain('Qwen3 8B')
    expect(html).toContain('Nouveautés')
    expect(html).toContain('Comprendre')
    expect(html).toContain('Prompt d&#x27;image')
    expect(html).toContain('Rien ne sort de votre machine')
    noRawKeys(html)
  })

  it('shows the composer of a conversation: send, attach, settings, system prompt, web search', () => {
    const html = render(createElement(ChatComposer, { conversationId: 'c1' }), [qwen, gemma], primeConversation(conversation([user, answer])))
    expect(html).toContain('Écrivez votre message…')
    expect(html).toContain('aria-label="Envoyer"')
    expect(html).toContain('Joindre des images ou des fichiers texte')
    expect(html).toContain('Réglages du modèle (température, contexte…)')
    expect(html).toContain('Instruction système et personas')
    expect(html).toContain('aria-label="Recherche web"')
    expect(html).toContain('role="meter"')
    noRawKeys(html)
  })

  it('disables the web search for a model that does not call tools, and says why', () => {
    const html = render(createElement(ChatComposer, { conversationId: 'c1' }), [qwen, gemma], primeConversation(conversation([], { model_id: 'gemma' })))
    expect(html).toContain('Gemma 4 12B')
    expect(html).toContain("Recherche web indisponible : ce modèle n&#x27;appelle pas d&#x27;outils")
    noRawKeys(html)
  })

  it('asks to install what a model that is not ready needs', () => {
    const missing = { ...qwen, ready: false, install: 'missing', installed_gb: 0, needs_engine_install: true, engine_install_size_mb: 11 } as unknown as ModelInfo
    const html = render(createElement(ChatComposer, { conversationId: null }), [missing])
    expect(html).toContain('n&#x27;est pas encore prêt')
    noRawKeys(html)
  })

  it('draws the thread: messages, branch navigator, thinking, tool runs with sources, statistics', () => {
    const html = render(createElement(ChatThread, { conversationId: 'c1', data: conversation([user, answer]) }), [qwen, gemma], primeConversation(conversation([user, answer])))
    expect(html).toContain('Quel temps fait-il à Lyon ?')
    expect(html).toContain('Il pleut à Lyon.')
    expect(html).toContain('Réflexion')
    expect(html).toContain('Recherche : météo Lyon')
    expect(html).toContain('Météo-France')
    expect(html).toContain('meteofrance.com')
    expect(html).toContain('2/3')
    expect(html).toContain('31.5 tok/s')
    expect(html).toContain('Qwen3 8B')
    expect(html).toContain('Envoyer vers Image, Vidéo, Audio ou Diagrammes') // the hand-off of an answer to another studio
    noRawKeys(html)
  })

  it('draws the suggestions of an empty conversation, and a waiting answer', () => {
    expect(render(createElement(ChatThread, { conversationId: 'c1', data: conversation([]) }), [qwen], primeConversation(conversation([])))).toContain('Cette conversation est vide')
    const waiting = conversation([user, message('a2', { role: 'assistant', parent_id: 'u1', status: 'streaming', model_id: 'qwen' })])
    const html = render(createElement(ChatThread, { conversationId: 'c1', data: waiting }), [qwen], primeConversation(waiting))
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Le modèle prépare sa réponse')
    expect(html).toContain('Arrêter la réponse')
  })

  it('shows the loading of the model, and the reload after a change of context', () => {
    const stream = { controller: new AbortController(), startedAt: Date.now() / 1000 - 12, error: null, active: true }
    expect(render(createElement(ChatStatusLine, { stream: { ...stream, loading: { phase: 'loading', modelId: 'qwen', elapsed: 12, reloadContext: null } } }))).toContain('Chargement du modèle…')
    const html = render(createElement(ChatStatusLine, { stream: { ...stream, loading: { phase: 'loading', modelId: 'qwen', elapsed: 12, reloadContext: 32768 } } }))
    expect(html).toContain('Rechargement du modèle avec un contexte de 32768 tokens…')
    expect(html).toContain('role="status"')
    noRawKeys(html)
  })

  it('warns, under the context field, that changing the context reloads the model, only when it differs from the loaded one', () => {
    const field = (value: number | null, context: number) => render(createElement(ContextField, { value, caps, modelId: 'qwen', status: { state: 'ready', model_id: 'qwen', context_size: context }, onChange: () => undefined }))
    const differs = field(32768, 16384)
    expect(differs).toContain('Changer le contexte recharge le modèle')
    expect(differs).toContain('role="status"')
    expect(field(null, 16384)).not.toContain('recharge le modèle')
    expect(field(16384, 16384)).not.toContain('recharge le modèle')
    expect(render(createElement(ContextField, { value: 32768, caps, modelId: 'qwen', status: null, onChange: () => undefined }))).not.toContain('recharge le modèle')
  })

  it('shows the error of a failed answer with the action that helps', () => {
    const html = render(createElement(ChatErrorNotice, { conversationId: 'c1', failure: { code: 'no_engine', message: 'llama-server introuvable' }, onRaiseContext: () => undefined }))
    expect(html).toContain('Le moteur de chat (llama.cpp) n&#x27;est pas installé.')
    expect(html).toContain('llama-server introuvable')
    expect(html).toContain('Installer')
    const full = render(createElement(ChatErrorNotice, { conversationId: 'c1', failure: { code: 'context_exceeded', message: '' }, onRaiseContext: () => undefined }))
    expect(full).toContain('Augmenter le contexte')
    noRawKeys(html + full)
  })

  it('shows the model in memory, and nothing while the engine has not said', () => {
    expect(render(createElement(LlmStatusChip))).toBe('')
    expect(render(createElement(LlmStatusView, { status: null }))).toBe('')
    expect(render(createElement(LlmStatusView, { status: { state: 'ready', model_id: 'qwen', context_size: 16384 } }))).toContain('Qwen3 8B · contexte 16k')
    expect(render(createElement(LlmStatusView, { status: { state: 'generating', model_id: 'qwen', context_size: 16384 } }))).toContain('écrit')
    expect(render(createElement(LlmStatusView, { status: { state: 'idle', model_id: null, context_size: null } }))).toContain('Aucun modèle chargé')
    const ready = { state: 'ready' as const, model_id: 'qwen', context_size: 16384 }
    expect(render(createElement(LlmStatusView, { status: ready }))).not.toContain('Décharger')
    expect(render(createElement(LlmStatusView, { status: ready, onUnload: () => undefined }))).toContain('Décharger le modèle de la mémoire')
    expect(render(createElement(LlmStatusView, { status: { ...ready, state: 'generating' }, onUnload: () => undefined }))).not.toContain('Décharger')
  })

  it('compares the answers of two models side by side', () => {
    const other = message('a2', { role: 'assistant', parent_id: 'u1', model_id: 'gemma', content: 'Averses.', sibling_ids: ['a1', 'a2', 'a3'], sibling_index: 1 })
    const html = render(createElement(CompareView, { group: [answer, other], activeId: 'a1', onChoose: () => undefined, onClose: () => undefined }))
    expect(html).toContain('Comparaison des réponses')
    expect(html).toContain('Il pleut à Lyon.')
    expect(html).toContain('Averses.')
    expect(html).toContain('Gemma 4 12B')
    expect(html).toContain('Affichée')
    noRawKeys(html)
  })

  it('shows the creation switch and its commands next to the web search, and hides them from a model without tools', () => {
    const on = render(createElement(ChatComposer, { conversationId: 'c1' }), [qwen, gemma], primeConversation(conversation([user, answer])))
    expect(on).toContain('aria-label="Outils de création"')
    const off = render(createElement(ChatComposer, { conversationId: 'c1' }), [qwen, gemma], primeConversation(conversation([], { model_id: 'gemma' })))
    expect(off).toContain('Outils de création indisponibles')
    noRawKeys(on + off)
  })

  it('shows each state of a generation: a choice to make, waiting, running, a result, a failure, stopped', () => {
    const generation = (extra: Partial<ChatGeneration>): ChatGeneration => ({ id: 'g1', kind: 'image', model_id: 'qwen', message_id: 'job1', prompt: 'un chat roux', params: {}, state: 'queued', error: null, assets: [], conversation_id: 'c1', ...extra })
    const show = (...list: ChatGeneration[]) => render(createElement(Generations, { message: message('a9', { role: 'assistant', generations: list }) }))
    const waiting = show(generation({}))
    expect(waiting).toContain('Image · Qwen3 8B')
    expect(waiting).toContain('En attente : la génération démarre dès que le moteur est libre.')
    expect(waiting).toContain('Ouvrir dans le studio')
    expect(show(generation({ state: 'running' }))).toContain('Génération en cours…')
    expect(show(generation({ state: 'error', error: 'Mémoire insuffisante' }))).toContain('Mémoire insuffisante')
    expect(show(generation({ state: 'cancelled' }))).toContain('Génération arrêtée.')
    const asset = { id: 'a1', media: 'image', url: '/media/outputs/a1.png', thumb_url: '/media/thumbs/a1.webp' } as ChatGeneration['assets'][number]
    expect(show(generation({ state: 'done', assets: [asset] }))).toContain('aria-label="Agrandir l&#x27;image"')
    const video = show(generation({ kind: 'video', state: 'pending', pending: 'duration', message_id: null }))
    expect(video).toContain('Quelle durée pour cette vidéo ?')
    expect(video).toContain('Lancer la génération')
    expect(show(generation({ kind: 'audio', state: 'pending', pending: 'voice', message_id: null }))).toContain('Ce modèle a besoin d&#x27;une voix')
    noRawKeys(waiting + video)
  })

  it('offers the export of the conversation', () => {
    expect(render(createElement(ExportMenu, { conversationId: 'c1' }))).toContain('Exporter la conversation')
  })
})
