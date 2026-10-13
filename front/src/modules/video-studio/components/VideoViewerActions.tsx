/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined'
import MovieOutlined from '@mui/icons-material/MovieOutlined'
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import type { Asset } from '@/modules/studio-core'
import { useVideoInputs } from '../hooks/useVideoInputs'

/**
 * What the viewer offers in the video studio, in place of "use as reference": for a clip, use it as the video to edit or take its
 * last frame as the start of the next one; for an image, use it as the start image.
 */
export function VideoViewerActions({ asset }: { asset: Asset }) {
  const { takeAsSource, continueFromLastFrame, assignAsset } = useVideoInputs()
  const close = useLightboxStore((s) => s.close)
  if (asset.media === 'video') {
    return (
      <>
        <TipIconButton labelId="videoStudio.viewer.asSource" onClick={() => takeAsSource(asset)} sx={{ color: 'inherit' }}>
          <MovieOutlined fontSize="small" />
        </TipIconButton>
        <TipIconButton labelId="videoStudio.viewer.lastFrame" onClick={() => void continueFromLastFrame(asset)} sx={{ color: 'inherit' }}>
          <SubdirectoryArrowRightRounded fontSize="small" />
        </TipIconButton>
      </>
    )
  }
  return (
    <TipIconButton
      labelId="videoStudio.viewer.asStart"
      onClick={() => {
        close()
        assignAsset(asset)
      }}
      sx={{ color: 'inherit' }}
    >
      <AddPhotoAlternateOutlined fontSize="small" />
    </TipIconButton>
  )
}
