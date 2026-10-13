/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditNoteRounded from '@mui/icons-material/EditNoteRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useMessageActions, type MessageKind } from '../hooks/useMessageActions'
import { copyText } from '../lib/clipboard'
import { formatTime } from '../lib/format'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import type { Message } from '../types'

/** What the user sent: reference thumbnails (open the viewer), the prompt, and hover actions (copy, reuse, delete). */
export function UserMessage({ message, kind, onReuse }: { message: Message; kind: MessageKind; onReuse: (message: Message) => void }) {
  const t = useT()
  const lang = useLang()
  const show = useLightboxStore((s) => s.show)
  const { confirmRemove } = useMessageActions()
  return (
    <Box className="user" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, animation: 'var(--animate-rise)' }}>
      {message.references.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 1 }}>
          {message.references.map((reference, index) => (
            <Box key={reference.id} component="button" type="button" onClick={() => show(message.references, index)} aria-label={t('thread.tile.enlarge')} sx={{ position: 'relative', width: 80, height: 80, overflow: 'hidden', borderRadius: '12px', border: 0, p: 0, boxShadow: '0 0 0 1px var(--line-strong)', transition: 'transform 0.15s', '&:hover': { transform: 'translateY(-2px)' } }}>
              <Box component="img" src={resolveMediaUrl(reference.thumb_url)} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <Box component="span" sx={{ position: 'absolute', bottom: 4, left: 4, borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.6)', px: '4px', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.9)' }}>
                {reference.media === 'video' ? t('thread.reference.video') : index + 1}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{ maxWidth: 'min(620px, 90%)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderRadius: '16px 16px 6px 16px', backgroundColor: 'var(--surface-3)', px: 2, py: 1.25, fontSize: 15, lineHeight: 1.6, color: 'var(--ink)' }}>
        {message.prompt}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', opacity: 0, transition: 'opacity 0.15s', '.user:hover &, &:focus-within': { opacity: 1 } }}>
        <Box component="span" sx={{ mr: '4px', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{formatTime(message.created_at, lang)}</Box>
        <TipIconButton labelId={`thread.user.copy.${kind}`} size="small" onClick={() => copyText(message.prompt)} sx={{ width: 28, height: 28 }}>
          <ContentCopyOutlined sx={{ fontSize: 14 }} />
        </TipIconButton>
        <TipIconButton labelId="thread.user.reuse" size="small" onClick={() => onReuse(message)} sx={{ width: 28, height: 28 }}>
          <EditNoteRounded sx={{ fontSize: 14 }} />
        </TipIconButton>
        <TipIconButton labelId="thread.user.delete" tone="danger" size="small" onClick={() => void confirmRemove(message, kind)} sx={{ width: 28, height: 28 }}>
          <DeleteOutlineRounded sx={{ fontSize: 14 }} />
        </TipIconButton>
      </Box>
    </Box>
  )
}
