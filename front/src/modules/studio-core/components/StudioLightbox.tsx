/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button } from '@mui/material'
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRounded from '@mui/icons-material/FavoriteRounded'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { Lightbox, type LightboxItem } from '@/modules_shared/common/components/ui/media'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { useModels } from '@/modules/model-catalog'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import type { StudioMode } from '@/modules/studio-shell/types'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useDeleteAsset, useToggleFavorite } from '../hooks/useAssetActions'
import { copyText, downloadAsset } from '../lib/clipboard'
import { addAsReference } from '../lib/draftActions'
import { viewerActionsMode } from '../lib/viewerActionsMode'
import { assetModelId, assetPrompt, viewerDetails } from '../lib/viewerDetails'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import type { Asset } from '../types'

/** The mode's own actions when it has some, else "use as reference" for an image (nothing for a clip of a mode without actions). */
function ModeActions({ asset, modeActions, mode }: { asset: Asset; modeActions: ViewerModeActions | undefined; mode: StudioMode }) {
  const Own = modeActions?.[viewerActionsMode(asset, mode)]
  if (Own) return <Own asset={asset} />
  if (asset.media === 'video') return null
  return (
    <TipIconButton labelId="thread.viewer.useAsReference" onClick={() => addAsReference(asset)} sx={{ color: 'inherit' }}>
      <AddPhotoAlternateOutlined fontSize="small" />
    </TipIconButton>
  )
}

const toItem = (asset: Asset): LightboxItem => ({
  id: asset.id,
  type: asset.media === 'video' ? 'video' : 'image',
  url: resolveMediaUrl(asset.url),
  thumbUrl: resolveMediaUrl(asset.thumb_url),
  alt: assetPrompt(asset) ?? '',
})

/** Toggles the "details" panel of the common viewer, which has no keyboard binding of its own, by pressing its button. */
function toggleDetailsPanel(): void {
  for (const key of ['common.ui.media.lightbox.hideDetails', 'common.ui.media.lightbox.showDetails']) {
    const button = document.querySelector<HTMLElement>(`[role="dialog"] button[aria-label="${i18n.get(key)}"]`)
    if (button) {
      button.click()
      return
    }
  }
}

/** `F` toggles the favorite of the current image, `I` the details panel (same keys as before; ← → and Esc are the viewer's). */
function useViewerKeys(current: Asset | undefined, onFavorite: (asset: Asset) => void): void {
  useEffect(() => {
    if (!current) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'f' && current.kind === 'generated') onFavorite(current)
      else if (key === 'i') toggleDetailsPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, onFavorite])
}

function Details({ asset }: { asset: Asset }) {
  const t = useT()
  const lang = useLang()
  const navigate = useNavigate()
  const close = useLightboxStore((s) => s.close)
  const deleteAsset = useDeleteAsset()
  const { data: catalog } = useModels()
  const prompt = assetPrompt(asset)
  const modelId = assetModelId(asset)
  const modelName = catalog?.models.find((m) => m.id === modelId)?.name ?? null
  const rows = viewerDetails(asset, { modelName, t, lang })
  const label = { fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.45 } as const
  return (
    <Box sx={{ display: 'flex', minHeight: '100%', flexDirection: 'column', gap: 2.5 }}>
      {prompt && (
        <Box component="section">
          <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box component="span" sx={label}>{t('thread.viewer.prompt')}</Box>
            <TipIconButton labelId="thread.viewer.copyPrompt" size="small" onClick={() => copyText(prompt)} sx={{ color: 'inherit', width: 28, height: 28 }}>
              <ContentCopyOutlined sx={{ fontSize: 14 }} />
            </TipIconButton>
          </Box>
          <Box component="p" sx={{ m: 0, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6, opacity: 0.9 }}>{prompt}</Box>
        </Box>
      )}
      <Box component="section">
        <Box sx={{ ...label, mb: 1 }}>{t('thread.viewer.details')}</Box>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: '6px', fontSize: 13 }}>
          {rows.map((row) => (
            <Box key={row.labelKey} sx={{ display: 'contents' }}>
              <Box component="dt" sx={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.55 }}>
                {t(row.labelKey)}
                {row.help && <InfoTip {...row.help} />}
              </Box>
              <Box component="dd" sx={{ m: 0, display: 'flex', alignItems: 'center', gap: '4px', fontFamily: row.mono ? 'var(--font-mono)' : undefined, overflowWrap: 'anywhere' }}>
                {row.value}
                {row.copyable && (
                  <TipIconButton labelId="thread.viewer.copy" size="small" onClick={() => copyText(row.value)} sx={{ color: 'inherit', width: 22, height: 22 }}>
                    <ContentCopyOutlined sx={{ fontSize: 12 }} />
                  </TipIconButton>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ mt: 'auto', display: 'grid', gap: 1 }}>
        {asset.conversation_id && (
          <Button variant="outlined" color="inherit" startIcon={<ChatBubbleOutlineRounded />} onClick={() => { close(); navigate(studioPaths.conversation(asset.conversation_id as string)) }}>
            {t('thread.viewer.openConversation')}
          </Button>
        )}
        {asset.kind === 'generated' && (
          <Button variant="contained" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => void deleteAsset(asset)}>
            {t(asset.media === 'video' ? 'thread.viewer.delete.video' : 'thread.viewer.delete.image')}
          </Button>
        )}
      </Box>
    </Box>
  )
}

/** What a creation mode puts in the viewer's toolbar in place of "use as reference" (the video studio: use as the video to edit, last frame as the start). */
export type ViewerModeActions = Partial<Record<StudioMode, ComponentType<{ asset: Asset }>>>

/**
 * The media viewer (common `Lightbox`) wired to the studio: use as reference (or, in a mode that has its own actions, those),
 * favorite (`F`), download, details panel (`I`) with prompt, model, size, seed, steps..., open the conversation, delete.
 * Mounted once by the shell; opened with `useLightboxStore().show(items, index)`.
 */
export function StudioLightbox({ modeActions }: { modeActions?: ViewerModeActions }) {
  const { open, items, index, setIndex, close } = useLightboxStore()
  const mode = useStudioStore((s) => s.mode)
  const toggle = useToggleFavorite()
  useViewerKeys(open ? items[index] : undefined, (asset) => toggle.mutate(asset))
  if (!open || items.length === 0) return null
  return (
    <Lightbox
      items={items.map(toItem)}
      index={index}
      onIndexChange={setIndex}
      onClose={close}
      actions={(_item, position) => {
        const asset = items[position]
        if (!asset) return null
        return (
          <>
            <ModeActions asset={asset} modeActions={modeActions} mode={mode} />
            {asset.kind === 'generated' && (
              <TipIconButton labelId={asset.favorite ? 'thread.tile.unfavorite' : 'thread.tile.favorite'} kbd="F" active={asset.favorite} onClick={() => toggle.mutate(asset)} sx={{ color: asset.favorite ? 'var(--safe)' : 'inherit' }}>
                {asset.favorite ? <FavoriteRounded fontSize="small" /> : <FavoriteBorderRounded fontSize="small" />}
              </TipIconButton>
            )}
            <TipIconButton labelId="thread.tile.download" onClick={() => downloadAsset(asset)} sx={{ color: 'inherit' }}>
              <FileDownloadOutlined fontSize="small" />
            </TipIconButton>
          </>
        )
      }}
      sidePanel={(_item, position) => (items[position] ? <Details asset={items[position]} /> : null)}
    />
  )
}
