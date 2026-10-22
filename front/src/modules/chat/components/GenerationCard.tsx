/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, LinearProgress } from '@mui/material'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import MovieOutlined from '@mui/icons-material/MovieOutlined'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { homePathForMode } from '@/modules/studio-shell/lib/routes'
import { useLightboxStore } from '@/modules/media-library'
import { messagesApi, useLiveStore, usePromptHandoffStore } from '@/modules/studio-core'
import { useModelName } from '../hooks/useModelName'
import { generationView } from '../lib/creation'
import type { ChatGeneration, ChatMessage, CreationKind } from '../types'
import { DurationChoice, VoiceChoice } from './GenerationChoice'

const ICONS: Record<CreationKind, React.ReactNode> = {
  image: <ImageOutlined sx={{ fontSize: 14 }} />,
  video: <MovieOutlined sx={{ fontSize: 14 }} />,
  audio: <GraphicEqRounded sx={{ fontSize: 14 }} />,
}

const frame = { borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 70%, transparent)', px: 1.5, py: 1.25 }

/** What a finished generation produced: the images (they open in the viewer), the clip or the sound with their native controls. */
function Results({ generation }: { generation: ChatGeneration }) {
  const t = useT()
  const show = useLightboxStore((s) => s.show)
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {generation.assets.map((asset, index) => {
        const src = resolveMediaUrl(asset.url)
        if (asset.media === 'video') return <Box key={asset.id} component="video" controls preload="metadata" src={src} poster={resolveMediaUrl(asset.thumb_url)} sx={{ display: 'block', maxWidth: '100%', width: 420, borderRadius: '10px', backgroundColor: '#000' }} />
        if (asset.media === 'audio') return <Box key={asset.id} component="audio" controls preload="metadata" src={src} sx={{ display: 'block', width: '100%', maxWidth: 420 }} />
        return (
          <Box key={asset.id} component="button" type="button" onClick={() => show(generation.assets, index)} aria-label={t('chat.generation.enlarge')} sx={{ display: 'block', p: 0, border: 0, background: 'none', cursor: 'zoom-in' }}>
            <Box component="img" src={resolveMediaUrl(asset.thumb_url)} alt={generation.prompt} loading="lazy" sx={{ display: 'block', maxWidth: '100%', maxHeight: 360, borderRadius: '10px', boxShadow: '0 0 0 1px var(--line-strong)' }} />
          </Box>
        )
      })}
    </Box>
  )
}

/** Progress of a running generation: a bar when the engine says how far it is, indeterminate otherwise, and a way to cancel. */
function Running({ generation }: { generation: ChatGeneration }) {
  const t = useT()
  const progress = useLiveStore((s) => (generation.message_id ? s.progress[generation.message_id] : undefined))
  const ratio = progress?.total ? Math.min(1, (progress.step ?? 0) / progress.total) : null
  const cancel = () => generation.message_id && void messagesApi.cancel(generation.message_id).catch((error: Error) => toast.error(error.message))
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 12.5, color: 'var(--ink-2)' }}>
        <Box component="span" sx={{ flex: 1 }}>{t(progress?.phase === 'loading' ? 'chat.generation.loading' : 'chat.generation.running')}</Box>
        <Button size="small" color="inherit" onClick={cancel}>{t('chat.generation.cancel')}</Button>
      </Box>
      <LinearProgress variant={ratio === null ? 'indeterminate' : 'determinate'} value={(ratio ?? 0) * 100} aria-label={t('chat.generation.progress')} />
    </Box>
  )
}

function Body({ message, generation }: { message: ChatMessage; generation: ChatGeneration }) {
  const t = useT()
  const view = generationView(generation)
  if (view === 'pending') return generation.pending === 'voice' ? <VoiceChoice messageId={message.id} generation={generation} /> : <DurationChoice messageId={message.id} generation={generation} />
  if (view === 'waiting') return <Box role="status" sx={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('chat.generation.waiting')}</Box>
  if (view === 'running') return <Running generation={generation} />
  if (view === 'failed') return <Box role="alert" sx={{ fontSize: 12.5, color: 'var(--danger)' }}>{generation.error ?? t('chat.generation.failed')}</Box>
  if (view === 'stopped') return <Box sx={{ fontSize: 12.5, color: 'var(--faint)' }}>{t('chat.generation.stopped')}</Box>
  return <Results generation={generation} />
}

/**
 * One generation an answer started: what was asked and with which model, then its state (a choice to make, waiting for the
 * engine, running with its progress, the result, a failure), and a way to carry on in the studio of its kind.
 */
export function GenerationCard({ message, generation }: { message: ChatMessage; generation: ChatGeneration }) {
  const t = useT()
  const navigate = useNavigate()
  const model = useModelName(generation.model_id)
  const openInStudio = () => {
    usePromptHandoffStore.getState().send(generation.kind, generation.prompt)
    navigate(homePathForMode(generation.kind))
  }
  return (
    <Box sx={frame}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: 1, fontSize: 12.5, color: 'var(--ink-2)' }}>
        {ICONS[generation.kind]}
        <Box component="span" sx={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={generation.prompt}>{t(`chat.generation.${generation.kind}`, [model])}</Box>
        <Button size="small" color="inherit" startIcon={<OpenInNewRounded sx={{ fontSize: 14 }} />} onClick={openInStudio}>{t('chat.generation.openInStudio')}</Button>
      </Box>
      <Body message={message} generation={generation} />
    </Box>
  )
}

/** The generations of an answer, one card each. */
export function Generations({ message }: { message: ChatMessage }) {
  if (!message.generations?.length) return null
  return (
    <Box sx={{ mb: 1.25, display: 'grid', gap: 1 }}>
      {message.generations.map((generation) => <GenerationCard key={generation.id} message={message} generation={generation} />)}
    </Box>
  )
}
