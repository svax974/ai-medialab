/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import { useModels } from '@/modules/model-catalog'
import { usePrivateStore } from '@/modules/private'
import type { Message } from '@/modules/studio-core'
import { StatusLine } from '@/modules/studio-core/components/StatusLine'
import { useMessageActions } from '@/modules/studio-core/hooks/useMessageActions'
import { isActive } from '@/modules/studio-core/lib/messageState'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { MeshPreview } from './MeshPreview'

export function MeshAssistant({ message }: { message: Message }) {
  const t = useT()
  const { data } = useModels()
  const privateMode = usePrivateStore((s) => s.active)
  const { retry, cancel, confirmRemove, confirmContinueAnyway } = useMessageActions()
  const model = data?.models.find((m) => m.id === message.model_id)
  const active = isActive(message.status)
  return <Box className="msg" sx={{ pl: 1, pb: 2 }}><Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mb: 1 }}><strong>{model?.name ?? message.model_id}</strong><StatusLine message={message} model={model} /></Box>
    {message.outputs.filter((a) => a.media === 'mesh').map((asset) => <MeshPreview key={asset.id} asset={asset} />)}
    {message.status === 'error' && <Box role="alert" sx={{ color: 'var(--danger)' }}>{message.error ?? t('thread.error.unknown')}</Box>}
    {message.status === 'error' && message.error_code === 'memory' && <Button size="small" disabled={privateMode} onClick={() => void confirmContinueAnyway(message)}>{t('thread.forceMemory.button')}</Button>}
    {message.status === 'cancelled' && <Box>{t('videoStudio.cancelled')}</Box>}
    {active ? <Button size="small" onClick={() => cancel.mutate(message.id)} disabled={cancel.isPending}>{t('thread.footer.cancel')}</Button> : <Box><Button size="small" onClick={() => retry.mutate({ id: message.id })} disabled={privateMode || retry.isPending}>{t('thread.footer.vary')}</Button><Button size="small" onClick={() => retry.mutate({ id: message.id, keepSeed: true })} disabled={privateMode || retry.isPending}>{t('thread.footer.sameSeeds')}</Button><Button size="small" onClick={() => void confirmRemove(message, 'mesh')}>{t('thread.delete')}</Button></Box>}
  </Box>
}

