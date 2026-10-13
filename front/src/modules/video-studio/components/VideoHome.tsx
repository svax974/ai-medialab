/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import { useQuery } from '@tanstack/react-query'
import { formatClock } from '@/modules_shared/common/components/ui/progress'
import { WelcomeSetup } from '@/modules/engines'
import { assetKeys, assetsApi, useLightboxStore } from '@/modules/media-library'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { VIDEO_SUGGESTIONS } from '../lib/videoHelp'
import { useVideoDraftStore } from '../state/videoDraftStore'
import { VideoComposer } from './VideoComposer'

const RECENT = 10
const rise = (delay: number) => ({ animation: 'var(--animate-rise)', animationDelay: `${delay}ms` })

function Suggestions() {
  const t = useT()
  const setPrompt = useVideoDraftStore((s) => s.setPrompt)
  return (
    <Box sx={{ mt: 2.5, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, ...rise(240) }}>
      {VIDEO_SUGGESTIONS.map((suggestion) => (
        <ButtonBase key={suggestion.labelKey} onClick={() => { setPrompt(t(suggestion.promptKey)); focusTarget('composer') }} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, borderRadius: '16px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', px: 2, py: 1.5, textAlign: 'left', transition: 'border-color 0.15s, background-color 0.15s', '&:hover': { borderColor: 'var(--line-strong)', backgroundColor: 'var(--surface)' }, '&:hover .arrow': { color: 'var(--ink)' } }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box className="cn-eyebrow" sx={{ mb: '4px', color: 'var(--safe)' }}>{t(suggestion.labelKey)}</Box>
            <Box sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 13, lineHeight: 1.35, color: 'var(--ink-2)' }}>{t(suggestion.promptKey)}</Box>
          </Box>
          <ArrowOutwardRounded className="arrow" sx={{ mt: '2px', fontSize: 16, flexShrink: 0, color: 'var(--faint)', transition: 'color 0.15s' }} />
        </ButtonBase>
      ))}
    </Box>
  )
}

/** "Latest clips": a row of the ten latest generated clips (poster and duration); a click opens the viewer on them. */
function RecentClips() {
  const t = useT()
  const show = useLightboxStore((s) => s.show)
  const { data } = useQuery({ queryKey: assetKeys.recent('video'), queryFn: () => assetsApi.list({ media: 'video' }) })
  if (!data || data.items.length === 0) return null
  return (
    <Box sx={{ mt: 6, ...rise(300) }}>
      <Box className="cn-eyebrow" sx={{ mb: 1.5 }}>{t('videoStudio.home.recent')}</Box>
      <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1 }}>
        {data.items.slice(0, RECENT).map((asset, index) => (
          <ButtonBase key={asset.id} onClick={() => show(data.items, index)} aria-label={t('videoStudio.home.openClip')} sx={{ position: 'relative', aspectRatio: '16 / 9', height: 96, flexShrink: 0, overflow: 'hidden', borderRadius: '12px', boxShadow: '0 0 0 1px var(--line)', transition: 'transform 0.15s', '&:hover': { transform: 'translateY(-2px)' } }}>
            <Box component="img" src={resolveMediaUrl(asset.thumb_url)} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box component="span" sx={{ position: 'absolute', bottom: 4, right: 4, display: 'flex', alignItems: 'center', gap: '2px', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.6)', px: '4px', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.9)' }}>
              <PlayArrowRounded sx={{ fontSize: 10 }} /> {asset.duration ? formatClock(asset.duration) : ''}
            </Box>
          </ButtonBase>
        ))}
      </Box>
    </Box>
  )
}

/**
 * Home page of the video studio: the headline, the first-launch card (a model to install), the hero composer, four starter
 * prompts that fill it, and the latest clips. A safelight glow floats behind.
 */
export function VideoHome() {
  const t = useT()
  return (
    <Box sx={{ position: 'relative', display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column', overflowY: 'auto' }}>
      <Box sx={{ pointerEvents: 'none', position: 'absolute', left: '50%', top: '-20%', width: '80vw', height: '60vh', transform: 'translateX(-50%)', borderRadius: '50%', background: 'radial-gradient(closest-side, var(--safe-soft), transparent)', filter: 'blur(40px)' }} />
      <Box sx={{ position: 'relative', mx: 'auto', display: 'flex', width: '100%', maxWidth: 820, flex: 1, flexDirection: 'column', justifyContent: 'center', px: 2.5, py: 8 }}>
        <Box sx={{ mb: 4.5, textAlign: 'center' }}>
          <Box className="cn-eyebrow" sx={{ mb: 2, ...rise(0) }}>{t('videoStudio.home.eyebrow')}</Box>
          <Box component="h1" sx={{ m: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(40px, 6vw, 68px)', lineHeight: 0.95, letterSpacing: '-0.02em', color: 'var(--ink)', ...rise(60) }}>
            {t('videoStudio.home.title.before')} <Box component="em" sx={{ color: 'var(--safe)' }}>{t('videoStudio.home.title.accent')}</Box>{t('videoStudio.home.title.after')}
          </Box>
          <Box component="p" sx={{ mx: 'auto', mb: 0, mt: 2, maxWidth: 448, fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', ...rise(120) }}>{t('videoStudio.home.subtitle')}</Box>
        </Box>
        <Box sx={rise(180)}>
          <WelcomeSetup kind="video" />
          <VideoComposer conversationId={null} hero />
        </Box>
        <Suggestions />
        <RecentClips />
      </Box>
    </Box>
  )
}
