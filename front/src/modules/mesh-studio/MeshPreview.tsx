/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress } from '@mui/material'
import type { Asset } from '@/modules/media-library/types'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { validateGlb } from './validateGlb'

export function MeshPreview({ asset }: { asset: Asset }) {
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    let viewer: HTMLElement | undefined
    setError(false)
    setLoading(true)
    void (async () => {
      if (!asset.url.startsWith('/media/outputs/')) throw new Error('Invalid media path')
      const response = await fetch(resolveMediaUrl(asset.url), { signal: controller.signal })
      if (!response.ok) throw new Error('GLB fetch failed')
      const bytes = await response.arrayBuffer()
      if (!validateGlb(bytes)) throw new Error('Invalid or external GLB')
      await import('@google/model-viewer')
      if (controller.signal.aborted || !host.current) return
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }))
      viewer = document.createElement('model-viewer')
      viewer.addEventListener('load', () => setLoading(false))
      viewer.addEventListener('error', () => { setLoading(false); setError(true) })
      viewer.setAttribute('src', objectUrl)
      viewer.setAttribute('camera-controls', '')
      viewer.setAttribute('alt', t('meshStudio.preview'))
      viewer.style.width = '100%'; viewer.style.height = '360px'
      host.current.appendChild(viewer)
    })().catch(() => { if (!controller.signal.aborted) { setLoading(false); setError(true) } })
    return () => { controller.abort(); viewer?.remove(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [asset.url, t])
  return <Box sx={{ maxWidth: 600, borderRadius: '16px', overflow: 'hidden', backgroundColor: 'var(--surface-2)', border: '1px solid var(--line)' }}><Box ref={host} />{loading && <Box role="status" sx={{ p: 2, color: 'var(--muted)' }}><CircularProgress size={16} color="inherit" /> {t('meshStudio.loadingPreview')}</Box>}{error && <Box role="alert" sx={{ p: 2 }}>{t('meshStudio.previewError')}</Box>}<Button component="a" href={resolveMediaUrl(asset.url)} download size="small" sx={{ m: 1 }}>{t('meshStudio.download')}</Button></Box>
}

