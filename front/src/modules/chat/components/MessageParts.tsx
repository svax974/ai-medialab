/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, ButtonBase, CircularProgress } from '@mui/material'
import ArticleOutlined from '@mui/icons-material/ArticleOutlined'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import PsychologyOutlined from '@mui/icons-material/PsychologyOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import TravelExploreOutlined from '@mui/icons-material/TravelExploreOutlined'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { displayName } from '../lib/attachments'
import { branchPosition } from '../lib/branches'
import { useModelName } from '../hooks/useModelName'
import { hostOf, isSafeHref } from '../lib/markdownSafety'
import type { ChatAttachment, ChatMessage, ToolRun } from '../types'

const mono = { fontFamily: 'var(--font-mono)', fontSize: 11 }

/** `‹ 2/3 ›`: the other versions of a message (answers regenerated, messages edited); a click shows that branch. */
export function BranchNav({ message, onSwitch, disabled }: { message: Pick<ChatMessage, 'sibling_ids' | 'sibling_index'>; onSwitch: (id: string) => void; disabled?: boolean }) {
  const t = useT()
  const position = branchPosition(message)
  if (!position) return null
  return (
    <Box role="group" aria-label={t('chat.branch.aria')} sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <TipIconButton labelId="chat.branch.previous" size="small" disabled={disabled || !position.previousId} onClick={() => position.previousId && onSwitch(position.previousId)} sx={{ width: 24, height: 24 }}>
        <ChevronLeftRounded sx={{ fontSize: 16 }} />
      </TipIconButton>
      <Box component="span" aria-live="polite" sx={{ ...mono, color: 'var(--muted)', minWidth: 28, textAlign: 'center' }}>{position.index}/{position.total}</Box>
      <TipIconButton labelId="chat.branch.next" size="small" disabled={disabled || !position.nextId} onClick={() => position.nextId && onSwitch(position.nextId)} sx={{ width: 24, height: 24 }}>
        <ChevronRightRounded sx={{ fontSize: 16 }} />
      </TipIconButton>
    </Box>
  )
}

/** The thinking of the model: open while it thinks, folded once the answer starts (the reader can open it). */
export function ReasoningBlock({ text, thinking }: { text: string; thinking: boolean }) {
  const t = useT()
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? thinking
  return (
    <Box sx={{ mb: 1.25, borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 70%, transparent)' }}>
      <ButtonBase onClick={() => setManual(!open)} aria-expanded={open} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: '8px', px: 1.5, py: '6px', borderRadius: '12px', fontSize: 12.5, color: 'var(--muted)' }}>
        {thinking ? <CircularProgress size={12} color="inherit" /> : <PsychologyOutlined sx={{ fontSize: 14 }} />}
        <Box component="span">{t(thinking ? 'chat.reasoning.thinking' : 'chat.reasoning.title')}</Box>
        <ExpandMoreRounded sx={{ ml: 'auto', fontSize: 16, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </ButtonBase>
      {open && <Box sx={{ borderTop: '1px solid var(--line)', px: 1.5, py: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', maxHeight: 320, overflowY: 'auto' }}>{text}</Box>}
    </Box>
  )
}

function runLabel(run: ToolRun, t: ReturnType<typeof useT>): string {
  const args = run.arguments
  if (run.name === 'web_search') return t('chat.tool.search', [String(args['query'] ?? '')])
  return t('chat.tool.fetch', [hostOf(String(args['url'] ?? ''))])
}

/** The tools an answer used: what was searched or fetched (the query that left the machine), the state and the sources. */
export function ToolRuns({ runs }: { runs: ToolRun[] }) {
  const t = useT()
  if (runs.length === 0) return null
  return (
    <Box sx={{ mb: 1.25, display: 'grid', gap: '6px' }}>
      {runs.map((run) => (
        <Box key={run.id} sx={{ borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 70%, transparent)', px: 1.5, py: '6px', fontSize: 12.5, color: 'var(--ink-2)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {run.name === 'web_search' ? <TravelExploreOutlined sx={{ fontSize: 14 }} /> : <ArticleOutlined sx={{ fontSize: 14 }} />}
            <Box component="span" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{runLabel(run, t)}</Box>
            {run.status === 'running' && <CircularProgress size={12} color="inherit" aria-label={t('chat.tool.running')} />}
            {run.status === 'done' && <CheckRounded sx={{ fontSize: 14, color: 'var(--ok)' }} />}
            {run.status === 'error' && <ReportProblemOutlined sx={{ fontSize: 14, color: 'var(--warn)' }} aria-label={t('chat.tool.failed')} />}
          </Box>
          {run.sources && run.sources.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: '4px', pl: 2.5, display: 'grid', gap: '2px' }}>
              {run.sources.map((source) => (
                <li key={source.url}>
                  {isSafeHref(source.url) ? (
                    <Box component="a" href={source.url} target="_blank" rel="noopener noreferrer nofollow" sx={{ color: 'var(--safe)', overflowWrap: 'anywhere' }}>{source.title || hostOf(source.url)}</Box>
                  ) : (
                    source.title
                  )}
                  <Box component="span" sx={{ ml: '6px', ...mono, color: 'var(--faint)' }}>{hostOf(source.url)}</Box>
                </li>
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

/** Model · tokens · speed · time of an answer. */
export function StatsLine({ message }: { message: ChatMessage }) {
  const t = useT()
  const model = useModelName(message.model_id)
  const s = message.stats
  const parts = [
    model,
    s ? t('chat.stats.tokens', [s.completion_tokens]) : null,
    s?.tokens_per_second ? t('chat.stats.speed', [s.tokens_per_second.toFixed(1)]) : null,
    s ? t('chat.stats.seconds', [(s.elapsed_ms / 1000).toFixed(1)]) : null,
  ].filter(Boolean)
  return parts.length > 0 ? <Box component="span" sx={{ ...mono, color: 'var(--faint)' }}>{parts.join(' · ')}</Box> : null
}

/** What was attached to a message: image thumbnails and text file chips. */
export function AttachmentList({ attachments, onRemove }: { attachments: ChatAttachment[]; onRemove?: (name: string) => void }) {
  const t = useT()
  if (attachments.length === 0) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 1 }}>
      {attachments.map((a) => (
        <Box key={a.name} sx={{ position: 'relative' }}>
          {a.kind === 'image' && a.url ? (
            <Box component="img" src={resolveMediaUrl(a.url)} alt={displayName(a)} loading="lazy" sx={{ display: 'block', width: 72, height: 72, objectFit: 'cover', borderRadius: '12px', boxShadow: '0 0 0 1px var(--line-strong)' }} />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', height: 36, maxWidth: 220, borderRadius: '10px', border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-2)', px: 1.25, fontSize: 12, color: 'var(--ink-2)' }}>
              <ArticleOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(a)}</Box>
            </Box>
          )}
          {onRemove && (
            <Box component="button" type="button" onClick={() => onRemove(a.name)} aria-label={t('chat.attach.remove', [displayName(a)])} sx={{ position: 'absolute', top: -6, right: -6, display: 'grid', width: 20, height: 20, placeItems: 'center', borderRadius: '50%', border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface-3)', color: 'var(--ink)', fontSize: 12, lineHeight: 1, cursor: 'pointer' }}>×</Box>
          )}
        </Box>
      ))}
    </Box>
  )
}
