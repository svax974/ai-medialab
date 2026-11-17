import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ privateMode: false, imageModel: false, gatedRepos: false }))
vi.mock('@/modules/studio-shell/hooks/useT', () => ({ useT: () => (key: string) => key }))
vi.mock('@/modules/private', () => ({ usePrivateStore: (select: (s: { active: boolean }) => boolean) => select({ active: state.privateMode }) }))
vi.mock('@/modules/model-catalog', () => ({ useActiveModel: () => ({ id: 'm1', name: 'Mesh model', reference_mode: state.imageModel ? 'init' : 'none', requires_references: state.imageModel, compatible: true, ready: true, license: 'MIT', params: [], gated_repos: state.gatedRepos ? ['facebook/dinov3-test', 'briaai/RMBG-2.0'] : [] }) }))
vi.mock('@/modules/model-catalog/components/ModelBadges', () => ({ GatedNotice: () => null }))
vi.mock('@/modules/engines', () => ({ SetupPrompt: () => null, WelcomeSetup: () => null }))
vi.mock('@/modules/studio-core', () => ({
  GenerationParams: () => createElement('button', { type: 'button' }, 'settings'),
  StudioModelPicker: () => createElement('button', { type: 'button' }, 'model picker'),
  messagesApi: { send: vi.fn() }, upsertMessage: vi.fn(),
}))
vi.mock('./MeshAssistant', () => ({ MeshAssistant: () => null }))

import { meshStudioAdapter } from './meshStudioAdapter'

function renderComposer(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(meshStudioAdapter.Composer, { conversationId: 'c1' }))))
}

beforeEach(() => { state.privateMode = false; state.imageModel = false; state.gatedRepos = false })
describe('3D composer rendering', () => {
  it('renders the text model controls without an image attachment', () => {
    const html = renderComposer()
    expect(html).toContain('meshStudio.prompt')
    expect(html).toContain('model picker')
    expect(html).toContain('settings')
    expect(html).not.toContain('meshStudio.attachImage')
  })
  it('explains the required reference for an image model', () => {
    state.imageModel = true
    const html = renderComposer()
    expect(html).toContain('meshStudio.imageRequired')
    expect(html).toContain('meshStudio.attachImage')
    expect(html).toContain('type="file"')
  })
  it('links each gated dependency to its own license page', () => {
    state.gatedRepos = true
    const html = renderComposer()
    expect(html).toContain('meshStudio.gatedRepos')
    expect(html).toContain('https://huggingface.co/facebook/dinov3-test')
    expect(html).toContain('https://huggingface.co/briaai/RMBG-2.0')
  })
  it('disables creation and image upload in private mode', () => {
    state.privateMode = true
    state.imageModel = true
    const html = renderComposer()
    expect(html).toContain('meshStudio.privateUnavailable')
    expect(html).toMatch(/disabled[^>]*>meshStudio\.attachImage/)
    expect(html).toMatch(/disabled[^>]*>meshStudio\.generate/)
  })
})
