/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box, Button, LinearProgress } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import { ProgressBar } from '@/modules_shared/common/components/ui/progress'
import type { ModelKind } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { UpdateProgress } from '../lib/updateItems'
import type { UpdateItem, UpdateState } from '../types'

const DOT: Record<UpdateState, string> = { update: 'var(--warn)', current: 'var(--ok)', error: 'var(--danger)' }
const MONO = 'var(--font-mono, monospace)'

/** A secondary action of a row (an untested release, going back to the tested one), with the warning that goes with it. */
export interface RowAction {
  key: string
  label: string
  onClick: () => void
  /** What the user should know before choosing it. */
  note: string
  /** `caution`: the note is drawn as a warning. */
  tone: 'plain' | 'caution'
  /** What the adviser says about it (its advice, or the button that asks for one), under the note. */
  extra?: ReactNode
}

export interface UpdateRowProps {
  name: string
  kinds: ModelKind[]
  state: UpdateState
  /** What the row says about the version, in plain words. */
  remark: ReactNode
  item: UpdateItem | undefined
  progress: UpdateProgress | null
  onUpdate: () => void
  /** The row's secondary actions; hidden while the row is queued, running or done. */
  actions?: RowAction[]
  /** What the adviser says about the update the row installs (`AdviceSlot`), when there is something to say. */
  advice?: ReactNode
}

function Kinds({ kinds }: { kinds: ModelKind[] }) {
  const t = useT()
  return (
    <>
      {kinds.map((kind) => (
        <Box key={kind} component="span" sx={{ ml: 1, border: '1px solid var(--line)', borderRadius: '6px', px: '6px', fontFamily: MONO, fontSize: 10.5, color: 'var(--muted)' }}>
          {t(`updates.kind.${kind}`)}
        </Box>
      ))}
    </>
  )
}

function Running({ progress }: { progress: UpdateProgress | null }) {
  const t = useT()
  if (!progress || (progress.total <= 0 && !progress.message)) return <LinearProgress aria-label={t('updates.state.running')} sx={{ mt: 1 }} />
  return (
    <Box sx={{ mt: 1 }}>
      {progress.total > 0 ? <ProgressBar done={progress.done} total={progress.total} rate={progress.rate} etaSeconds={progress.eta} /> : <LinearProgress aria-label={t('updates.state.running')} />}
      {progress.message && (
        <Box component="p" sx={{ m: 0, mt: '4px', fontFamily: MONO, fontSize: 11, color: 'var(--faint)' }}>
          {progress.message}
        </Box>
      )}
    </Box>
  )
}

function Status({ state, item, onUpdate }: Pick<UpdateRowProps, 'state' | 'item' | 'onUpdate'>) {
  const t = useT()
  const text = (key: string) => <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>{t(key)}</Box>
  if (item?.status === 'queued') return text('updates.state.queued')
  if (item?.status === 'running') return text('updates.state.running')
  if (item?.status === 'done') return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 12, color: 'var(--ok)' }}><CheckRounded sx={{ fontSize: 14 }} />{t('updates.state.done')}</Box>
  if (item?.status === 'error' || state === 'update') {
    return <Button variant={item ? 'outlined' : 'contained'} size="small" onClick={onUpdate}>{item ? t('updates.retry') : t('updates.update')}</Button>
  }
  return state === 'error' ? text('updates.state.checkFailed') : text('updates.state.current')
}

/** One engine or model: dot, name, kinds, what changed, and the button or state that fits (waiting, progress, done, failed). */
export function UpdateRow({ name, kinds, state, remark, item, progress, onUpdate, actions = [], advice = null }: UpdateRowProps) {
  const idle = !item || item.status === 'error'
  return (
    <Box sx={{ display: 'grid', gap: 0 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
        <Box component="span" aria-hidden sx={{ width: 8, height: 8, flexShrink: 0, borderRadius: '50%', backgroundColor: DOT[state] }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ fontSize: 13.5, color: 'var(--ink)' }}>
            {name}
            <Kinds kinds={kinds} />
          </Box>
          <Box sx={{ fontSize: 11.5, lineHeight: 1.4, color: item?.status === 'error' ? 'var(--danger)' : 'var(--faint)' }} role={item?.status === 'error' ? 'alert' : undefined}>
            {item?.status === 'error' && item.error ? item.error : remark}
          </Box>
        </Box>
        <Status state={state} item={item} onUpdate={onUpdate} />
      </Box>
      {advice}
      {idle && actions.map((action) => (
        <Box key={action.key} sx={{ mt: '6px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
          <Button size="small" variant="text" onClick={action.onClick} sx={{ px: 0.5 }}>{action.label}</Button>
          <Box sx={{ minWidth: 0, flex: 1, fontSize: 11.5, lineHeight: 1.4, color: action.tone === 'caution' ? 'var(--warn)' : 'var(--faint)' }}>{action.note}</Box>
          {action.extra && <Box sx={{ flexBasis: '100%' }}>{action.extra}</Box>}
        </Box>
      ))}
      {item?.status === 'running' && <Running progress={progress} />}
    </Box>
  )
}
