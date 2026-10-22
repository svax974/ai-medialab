/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, ButtonBase } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { AssetGallery } from '@/modules/media-library'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { Asset } from '@/modules/studio-core'
import { takeMeta } from '../lib/takes'
import { TakeCard } from './TakeCard'

/** One entry of the library: the start of the text (a click opens its conversation) and the conversation title above the take. */
function LibraryTake({ asset }: { asset: Asset }) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <Box sx={{ mx: 'auto', mb: 2, maxWidth: 760, animation: 'var(--animate-fade)' }}>
      <ButtonBase disabled={!asset.conversation_id} title={t('audioStudio.library.open')} onClick={() => asset.conversation_id && navigate(studioPaths.conversation(asset.conversation_id))} sx={{ display: 'block', maxWidth: '100%', mb: '6px', px: '4px', textAlign: 'left' }}>
        <Box component="span" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 13, lineHeight: 1.35, color: 'var(--ink-2)', '&:hover': { color: 'var(--ink)' } }}>{asset.prompt ?? takeMeta(asset).prompt}</Box>
        <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{asset.conversation_title}</Box>
      </ButtonBase>
      <TakeCard asset={asset} />
    </Box>
  )
}

/** `/audio/bibliotheque`: every generated take, newest first (the generic gallery of `media-library` in one column). */
export function AudioGallery() {
  return <AssetGallery media="audio" renderTile={(asset) => <LibraryTake asset={asset} />} />
}
