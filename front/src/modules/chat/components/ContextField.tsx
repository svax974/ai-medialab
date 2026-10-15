/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { Box, Button } from '@mui/material'
import AutorenewRounded from '@mui/icons-material/AutorenewRounded'
import { InfoTip } from '@/modules_shared/common/components/ui/help'
import type { LlmCaps } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { CONTEXT_MIN, contextChangeReloads } from '../lib/context'
import type { LlmStatus } from '../types'

interface Props {
  /** The context set for the conversation (`null`: the model's default). */
  value: number | null
  caps: LlmCaps | null | undefined
  modelId: string | null
  /** State of the chat model as the engine reports it. */
  status: LlmStatus | null
  onChange: (value: number | null) => void
}

const QUICK = [8192, 16384, 32768, 65536, 131072]

const clamp = (n: number, caps: LlmCaps | null | undefined): number => Math.min(Math.max(Math.round(n), CONTEXT_MIN), caps?.context_max ?? 1_048_576)

/**
 * The context of the conversation, in tokens. The context cache is allocated when the model loads, so changing it
 * reloads the model: while the typed value differs from the one the loaded model has, a notice (role `status`) says so.
 * No confirmation blocks the change; the next message reloads the model.
 */
export function ContextField({ value, caps, modelId, status, onChange }: Props) {
  const t = useT()
  const standard = caps?.context_default ?? null
  const [text, setText] = useState(String(value ?? standard ?? ''))
  useEffect(() => setText(String(value ?? standard ?? '')), [value, standard])
  const typed = Number(text)
  const wanted = Number.isFinite(typed) && text.trim() !== '' ? clamp(typed, caps) : (value ?? standard)
  const reloads = contextChangeReloads(wanted, status, modelId)
  const commit = (n: number) => {
    const next = clamp(n, caps)
    setText(String(next))
    onChange(standard !== null && next === standard ? null : next)
  }
  return (
    <Box>
      <Box sx={{ mb: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--ink-2)' }}>
          {t('chat.params.context')} <InfoTip titleId="chat.params.context" bodyId="chat.params.context.help" />
        </Box>
        {standard !== null && <Box component="span" sx={{ fontSize: 11, color: 'var(--faint)' }}>{t('chat.params.context.default', [standard])}</Box>}
      </Box>
      <Box
        component="input"
        type="number"
        min={CONTEXT_MIN}
        max={caps?.context_max}
        step={1024}
        value={text}
        aria-label={t('chat.params.context')}
        aria-describedby={reloads ? 'chat-context-reload' : undefined}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
        onBlur={() => Number.isFinite(typed) && text.trim() !== '' ? commit(typed) : setText(String(value ?? standard ?? ''))}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
        sx={{ width: '100%', height: 36, borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', px: 1.25, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--ink)', '&:focus': { borderColor: 'var(--line-strong)', outline: 'none' } }}
      />
      <Box sx={{ mt: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {QUICK.filter((n) => !caps || n <= caps.context_max).map((n) => (
          <Button key={n} size="small" variant={wanted === n ? 'contained' : 'outlined'} color="inherit" onClick={() => commit(n)} sx={{ minWidth: 0, px: 1, py: 0, fontSize: 11.5 }}>{n / 1024}k</Button>
        ))}
      </Box>
      {reloads && (
        <Box id="chat-context-reload" role="status" sx={{ mt: 1, display: 'flex', alignItems: 'flex-start', gap: '8px', borderRadius: '10px', border: '1px solid color-mix(in oklab, var(--warn) 35%, transparent)', backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)', px: 1.25, py: '8px', fontSize: 12, lineHeight: 1.45, color: 'var(--ink-2)' }}>
          <AutorenewRounded sx={{ mt: '1px', fontSize: 15, flexShrink: 0, color: 'var(--warn)' }} />
          <span>{t('chat.params.context.reload')}</span>
        </Box>
      )}
    </Box>
  )
}
