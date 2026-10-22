/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, Tab, Tabs, useMediaQuery } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { ChatMessage } from '../types'
import { AssistantBody } from './AssistantBody'
import { useModelName } from '../hooks/useModelName'

function Column({ message, active, onChoose }: { message: ChatMessage; active: boolean; onChoose: (id: string) => void }) {
  const t = useT()
  const name = useModelName(message.model_id)
  return (
    <Box component="section" aria-label={name} sx={{ minWidth: 0, borderRadius: '16px', border: '1px solid', borderColor: active ? 'var(--safe)' : 'var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', p: 2 }}>
      <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box className="cn-eyebrow" sx={{ flex: 1, color: active ? 'var(--safe)' : undefined }}>{name}</Box>
        <Button size="small" variant={active ? 'text' : 'outlined'} disabled={active} onClick={() => onChoose(message.id)}>{t(active ? 'chat.compare.current' : 'chat.compare.choose')}</Button>
      </Box>
      <AssistantBody message={message} />
    </Box>
  )
}

/**
 * The answers of several models to the same question, side by side (tabs on a narrow window). Choosing one shows its
 * branch in the thread. Only the answers this browser has seen are here: the server sends the active branch only.
 */
export function CompareView({ group, activeId, onChoose, onClose }: { group: ChatMessage[]; activeId: string; onChoose: (id: string) => void; onClose: () => void }) {
  const t = useT()
  const narrow = useMediaQuery('(max-width: 900px)')
  const [tab, setTab] = useState(Math.max(0, group.findIndex((m) => m.id === activeId)))
  return (
    <Box component="section" aria-label={t('chat.compare.title')} sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box className="cn-eyebrow" sx={{ flex: 1 }}>{t('chat.compare.title')}</Box>
        <TipIconButton labelId="chat.compare.close" size="small" onClick={onClose} sx={{ width: 28, height: 28 }}>
          <CloseRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
      {narrow ? (
        <>
          <Tabs value={tab} onChange={(_e, value: number) => setTab(value)} variant="scrollable" aria-label={t('chat.compare.title')}>
            {group.map((m, i) => <CompareTab key={m.id} message={m} index={i} />)}
          </Tabs>
          <Column message={group[Math.min(tab, group.length - 1)]} active={group[Math.min(tab, group.length - 1)].id === activeId} onChoose={onChoose} />
        </>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: `repeat(${Math.min(group.length, 3)}, minmax(0, 1fr))` }}>
          {group.map((m) => <Column key={m.id} message={m} active={m.id === activeId} onChoose={onChoose} />)}
        </Box>
      )}
    </Box>
  )
}

function CompareTab({ message, index, ...rest }: { message: ChatMessage; index: number }) {
  const name = useModelName(message.model_id)
  return <Tab {...rest} value={index} label={name} />
}
