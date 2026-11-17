import { describe, expect, it } from 'vitest'
import type { Asset } from '@/modules/media-library/types'
import { buildMeshRequest, canSendMesh } from './composerRules'

const textModel = { id: 'text', compatible: true, ready: true, requires_references: false, reference_mode: 'none' as const }
const imageModel = { ...textModel, id: 'image', requires_references: true, reference_mode: 'init' as const }
const image = { id: 'reference' } as Asset
const defaults = { prompt: '', reference: null, privateMode: false, busy: false }

describe('3D composer', () => {
  it('requires text for a text model and an image for an image model', () => {
    expect(canSendMesh(textModel, defaults)).toBe(false)
    expect(canSendMesh(textModel, { ...defaults, prompt: '  chair  ' })).toBe(true)
    expect(canSendMesh(imageModel, { ...defaults, prompt: 'chair' })).toBe(false)
    expect(canSendMesh(imageModel, { ...defaults, reference: image })).toBe(true)
  })
  it('refuses private, busy, incompatible and unready requests', () => {
    const input = { ...defaults, prompt: 'chair' }
    expect(canSendMesh(textModel, { ...input, privateMode: true })).toBe(false)
    expect(canSendMesh(textModel, { ...input, busy: true })).toBe(false)
    expect(canSendMesh({ ...textModel, compatible: false }, input)).toBe(false)
    expect(canSendMesh({ ...textModel, ready: false }, input)).toBe(false)
  })
  it('builds one output with only supported references and the selected seed', () => {
    const input = { conversationId: 'c1', prompt: ' chair ', params: { steps: 32 }, seed: 42, reference: image }
    expect(buildMeshRequest({ ...input, model: textModel })).toEqual({ conversation_id: 'c1', prompt: 'chair', model_id: 'text', params: { steps: 32, seed: 42 }, reference_ids: [], count: 1 })
    expect(buildMeshRequest({ ...input, model: imageModel }).reference_ids).toEqual(['reference'])
  })
})
