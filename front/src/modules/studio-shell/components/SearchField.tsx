/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, InputAdornment, TextField } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { Kbd } from '@/modules_shared/common/components/ui/kbd'
import { registerFocusTarget } from '../lib/focusRegistry'
import { SHORTCUT_LABELS } from '../lib/shortcuts'
import { useT } from '../hooks/useT'

const DEBOUNCE_MS = 200

/** Search field of the conversation list. `onSearch` receives the trimmed text, 200 ms after the last key. */
export function SearchField({ onSearch }: { onSearch: (query: string) => void }) {
  const t = useT()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value, onSearch])

  useEffect(() => {
    registerFocusTarget('search', inputRef.current)
    return () => registerFocusTarget('search', null)
  }, [])

  return (
    <Box sx={{ mx: 1.5, mt: 1.5 }}>
      <TextField
        fullWidth
        size="small"
        value={value}
        placeholder={t('studio.search.placeholder')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setValue('')
            inputRef.current?.blur()
          }
        }}
        inputRef={inputRef}
        slotProps={{
          htmlInput: { 'aria-label': t('studio.search.aria') },
          input: {
            startAdornment: (
              <InputAdornment position="start" sx={{ mr: 0.5 }}>
                <SearchRounded sx={{ fontSize: 14, color: 'var(--faint)' }} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                {value ? (
                  <IconButton size="small" aria-label={t('studio.search.clear')} onClick={() => setValue('')} sx={{ width: 22, height: 22 }}>
                    <CloseRounded sx={{ fontSize: 14 }} />
                  </IconButton>
                ) : (
                  <Kbd>{SHORTCUT_LABELS.focusSearch}</Kbd>
                )}
              </InputAdornment>
            ),
          },
        }}
      />
    </Box>
  )
}
