/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { useConversationActions } from '@/modules/studio-shell/hooks/useConversations'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { resolveTitleEdit } from '../lib/scroll'

/** Title of the conversation, editable in place: Enter or leaving the field saves, Escape reverts. */
export function TitleEditor({ id, title }: { id: string; title: string }) {
  const t = useT()
  const [value, setValue] = useState(title)
  const { update } = useConversationActions()
  useEffect(() => setValue(title), [title])
  const save = () => {
    const edit = resolveTitleEdit(value, title)
    if (edit.action === 'revert') setValue(title)
    else if (edit.action === 'save') update.mutate({ id, patch: { title: edit.title } })
  }
  return (
    <Box
      component="input"
      value={value}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setValue(title)
          event.currentTarget.blur()
        }
      }}
      aria-label={t('thread.title.aria')}
      sx={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', borderRadius: '6px', border: 0, background: 'transparent', px: '4px', py: '2px', fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink)', outline: 'none', '&:hover, &:focus': { backgroundColor: 'var(--surface-2)' } }}
    />
  )
}
