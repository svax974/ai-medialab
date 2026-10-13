/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { Asset } from '../types'
import { assetModelId, assetPrompt, viewerDetails } from './viewerDetails'

const t = (key: string, params?: (string | number)[]) => (params ? `${key}:${params.join(',')}` : key)
const asset = (extra: Partial<Asset> = {}): Asset =>
  ({ id: 'a', kind: 'generated', media: 'image', url: '', thumb_url: '', width: 1024, height: 768, seed: 42, original_name: null, favorite: false, meta: {}, duration: null, created_at: new Date(2026, 9, 13, 9, 30).getTime() / 1000, ...extra }) as Asset

const labels = (rows: { labelKey: string }[]) => rows.map((row) => row.labelKey.replace('thread.viewer.', ''))

describe('viewerDetails', () => {
  it('lists model, size, seed, steps, guidance, strength and date for a generated image', () => {
    const rows = viewerDetails(asset({ meta: { steps: 8, guidance: 3.5, strength: 0.7 } }), { modelName: 'Flux', t, lang: 'fr' })
    expect(labels(rows)).toEqual(['model', 'size', 'seed', 'steps', 'guidance', 'strength', 'date'])
    expect(rows.find((r) => r.labelKey.endsWith('seed'))).toMatchObject({ value: '42', copyable: true, mono: true })
    expect(rows.find((r) => r.labelKey.endsWith('size'))?.value).toBe('1024 × 768 px')
    expect(rows.find((r) => r.labelKey.endsWith('seed'))?.help?.titleId).toBe('thread.help.seed.title')
  })

  it('shows the file of an import (or a generic name) and no seed', () => {
    const named = viewerDetails(asset({ kind: 'upload', seed: null, original_name: 'photo.jpg' }), { modelName: null, t, lang: 'fr' })
    expect(named.find((r) => r.labelKey.endsWith('file'))?.value).toBe('photo.jpg')
    expect(labels(named)).not.toContain('seed')
    expect(viewerDetails(asset({ kind: 'upload', original_name: null }), { modelName: null, t, lang: 'fr' }).find((r) => r.labelKey.endsWith('file'))?.value).toBe('thread.viewer.importedImage')
  })

  it('shows the length and the frame rate of a video, and the compute time of an image', () => {
    const video = viewerDetails(asset({ media: 'video', duration: 5.5, fps: 24, meta: { seconds: 90 } }), { modelName: null, t, lang: 'fr' })
    expect(video.find((r) => r.labelKey.endsWith('length'))?.value).toMatch(/^5,5\s+s$/)
    expect(video.find((r) => r.labelKey.endsWith('fps'))?.value).toBe('thread.viewer.fpsValue:24')
    expect(labels(video)).not.toContain('computeTime')
    const image = viewerDetails(asset({ meta: { seconds: 90 } }), { modelName: null, t, lang: 'fr' })
    expect(image.find((r) => r.labelKey.endsWith('computeTime'))?.value).toMatch(/^1\s+min/)
  })

  it('reads the prompt and the model from the meta, then from the gallery fields', () => {
    expect(assetPrompt(asset({ meta: { prompt: 'a' }, prompt: 'b' }))).toBe('a')
    expect(assetPrompt(asset({ prompt: 'b' }))).toBe('b')
    expect(assetPrompt(asset())).toBeNull()
    expect(assetModelId(asset({ meta: { model_id: 'm1' }, model_id: 'm2' }))).toBe('m1')
    expect(assetModelId(asset({ model_id: 'm2' }))).toBe('m2')
  })
})
