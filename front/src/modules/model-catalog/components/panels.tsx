/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import InfoIcon from '@mui/icons-material/ErrorOutlineRounded'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'

const MONO = 'var(--font-mono, monospace)'

/** Bordered card of the models dialog (machine, engines, search, token). */
export function Section({ title, hint, children, sx }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box component="section" sx={{ border: '1px solid var(--line)', borderRadius: '16px', backgroundColor: 'color-mix(in oklab, var(--surface-2) 50%, transparent)', p: 2, ...sx }}>
      {title && (
        <Box className="cn-eyebrow" sx={{ mb: hint ? '4px' : 1.5 }}>
          {title}
        </Box>
      )}
      {hint && (
        <Box component="p" sx={{ m: 0, mb: 1.5, fontSize: 12, lineHeight: 1.4, color: 'var(--faint)' }}>
          {hint}
        </Box>
      )}
      {children}
    </Box>
  )
}

type TagTone = 'plain' | 'strong' | 'soft' | 'warn' | 'ok' | 'danger'

const TONES: Record<TagTone, { color: string; background: string; ring: boolean }> = {
  plain: { color: 'var(--muted)', background: 'var(--surface)', ring: true },
  strong: { color: 'var(--ink-2)', background: 'var(--surface)', ring: true },
  soft: { color: 'var(--ink-2)', background: 'var(--safe-soft)', ring: false },
  warn: { color: 'var(--warn)', background: 'color-mix(in oklab, var(--warn) 12%, transparent)', ring: false },
  ok: { color: 'var(--ok)', background: 'color-mix(in oklab, var(--ok) 15%, transparent)', ring: false },
  danger: { color: 'var(--danger)', background: 'color-mix(in oklab, var(--danger) 10%, transparent)', ring: false },
}

interface TagProps {
  children: ReactNode
  tone?: TagTone
  /** Smaller text (picker rows) or the status pill (uppercase, rounded). */
  size?: 'sm' | 'md'
  pill?: boolean
  help?: boolean
  title?: string
}

/** Small monospace badge (engine, precision, size, tags, status). */
export function Tag({ children, tone = 'plain', size = 'md', pill, help, title }: TagProps) {
  const t = TONES[tone]
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '6px',
        py: '1px',
        borderRadius: pill ? '999px' : '6px',
        fontFamily: MONO,
        fontSize: pill ? 9.5 : size === 'sm' ? 9.5 : 10,
        textTransform: pill ? 'uppercase' : 'none',
        letterSpacing: pill ? '0.06em' : 0,
        color: t.color,
        backgroundColor: t.background,
        boxShadow: t.ring ? 'inset 0 0 0 1px var(--line)' : 'none',
        cursor: help ? 'help' : 'default',
      }}
    >
      {children}
    </Box>
  )
}

type NoticeTone = 'danger' | 'warn' | 'neutral' | 'plain'

const NOTICE_COLOR: Record<NoticeTone, string> = { danger: 'var(--danger)', warn: 'var(--warn)', neutral: 'var(--muted)', plain: 'var(--muted)' }

/** Icon + sentence, optionally in a tinted frame (errors, warnings, hints). */
export function Notice({ children, tone = 'plain', framed, icon, sx }: { children: ReactNode; tone?: NoticeTone; framed?: boolean; icon?: ReactNode; sx?: SxProps<Theme> }) {
  const frame =
    framed && tone === 'danger'
      ? { border: '1px solid color-mix(in oklab, var(--danger) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--danger) 10%, transparent)' }
      : framed && tone === 'warn'
        ? { backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)' }
        : framed
          ? { border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-2)' }
          : {}
  return (
    <Box
      role={tone === 'danger' ? 'alert' : undefined}
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, fontSize: 12.5, lineHeight: 1.4, color: framed ? 'var(--ink-2)' : NOTICE_COLOR[tone], ...(framed ? { borderRadius: '12px', px: 1.5, py: 1 } : {}), ...frame, ...sx }}
    >
      <Box component="span" sx={{ display: 'flex', mt: '2px', flexShrink: 0, color: tone === 'plain' ? 'var(--muted)' : NOTICE_COLOR[tone] }}>
        {icon ?? (tone === 'danger' ? <WarningAmberRounded sx={{ fontSize: 16 }} /> : <InfoIcon sx={{ fontSize: 14 }} />)}
      </Box>
      <Box component="span" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
        {children}
      </Box>
    </Box>
  )
}
