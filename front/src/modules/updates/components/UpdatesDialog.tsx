/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Switch, ToggleButton, ToggleButtonGroup } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useDownloadStore, useSizeLabel } from '@/modules/model-catalog'
import { useInstallStore } from '@/modules/engines'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useAdvisor, type Advisor } from '../hooks/useAdvisor'
import { useAdvisories } from '../hooks/useAdvisories'
import { useUpdatesCheck } from '../hooks/useUpdatesCheck'
import { analysisJobs, discouragedItems, dropAdvisory, findingsText, isFresh, makeJob, type AnalysisJob } from '../lib/advice'
import { findItem } from '../lib/queue'
import { pendingItems, progressOf, toEngineItem, toModelItem, visibleRows } from '../lib/updateItems'
import { updatesKeys } from '../lib/updatesKeys'
import { updatesApi } from '../services/updatesApi'
import { useAdviceStore, useUpdatesPrefs } from '../state/adviceStore'
import { useUpdatesStore } from '../state/updatesStore'
import type { EngineUpdate, KindFilter, ModelUpdate, UpdateAdvisory, UpdateItem, UpdatesReport } from '../types'
import { AdviceSlot } from './AdviceSlot'
import { LocalAiInvite } from './LocalAiInvite'
import { SavedAdvisories } from './SavedAdvisories'
import { UpdateRow, type RowAction } from './UpdateRow'
import { UpdateSection } from './UpdateSection'

const FILTERS: KindFilter[] = ['all', 'image', 'audio', 'video']

function engineRemark(e: EngineUpdate, t: ReturnType<typeof useT>): string {
  const base = e.reason === 'recipe'
    ? t('updates.engine.recipe', [e.installed])
    : e.state === 'update'
      ? t('updates.engine.pinned', [e.installed, e.target ?? '?'])
      : t('updates.engine.installed', [e.installed])
  return base
}

function modelRemark(m: ModelUpdate, t: ReturnType<typeof useT>, size: (gb: number) => string): string {
  if (m.state === 'error') return m.error ?? t('updates.state.checkFailed')
  return m.state === 'update' ? t('updates.model.changed', [m.files, size(m.size_gb)]) : t('updates.model.current')
}

/** The warning shown with, and in the confirmation of, an untested release: the regressions documented for it and what the adviser found, else the plain fact it is untested. */
function latestWarning(e: EngineUpdate, t: ReturnType<typeof useT>): { text: string; strong: boolean } {
  const known = e.latest?.regressions ?? []
  const advice = e.latest?.advice && isFresh(e.latest.advice) && e.latest.advice.verdict === 'discouraged' ? e.latest.advice : null
  const found = advice ? ` ${t('updates.latest.advice', [findingsText(advice)])}` : ''
  if (known.length === 0) return { text: t('updates.latest.warning', [e.latest?.tag ?? '?']) + found, strong: !!advice }
  return { text: known.map((r) => t('updates.latest.regression', [e.latest?.tag ?? '?', r.effect, r.source])).join(' ') + found, strong: true }
}

interface AdviceTools {
  advisor: Advisor
  forget: (id: string) => void
}

function engineActions(e: EngineUpdate, t: ReturnType<typeof useT>, enqueue: (items: UpdateItem[]) => void, tools: AdviceTools): RowAction[] {
  const actions: RowAction[] = []
  if (e.latest) {
    const warning = latestWarning(e, t)
    const run = async () => {
      const ok = await confirm({
        titleId: 'updates.latest.confirm.title',
        messageId: warning.strong ? 'updates.latest.confirm.messageRegression' : 'updates.latest.confirm.message',
        params: [e.name, e.latest?.tag ?? '?', warning.text],
        confirmLabelId: 'updates.latest.confirm.ok',
      })
      if (ok) enqueue([toEngineItem(e, 'latest')])
    }
    const slot = rowAdvice(e.latest.advice, makeJob('engine', e.id, `${e.name} ${e.latest.tag}`, 'latest'), true, tools)
    actions.push({ key: 'latest', label: t('updates.latest.action'), onClick: () => void run(), note: warning.text, tone: 'caution', extra: slot })
  }
  if (e.rollback) actions.push({ key: 'rollback', label: t('updates.rollback.action', [e.target ?? '?']), onClick: () => enqueue([toEngineItem(e, 'pinned')]), note: t('updates.rollback.note'), tone: 'plain' })
  return actions
}

function Summary({ updates, failed }: { updates: number; failed: number }) {
  const t = useT()
  const text = [updates > 0 ? t('updates.summary.some', [updates]) : t('updates.summary.none'), failed > 0 ? t('updates.summary.failed', [failed]) : ''].filter(Boolean).join(' ')
  return <Box role="status" sx={{ fontSize: 13, color: updates > 0 ? 'var(--ink)' : 'var(--muted)' }}>{text}</Box>
}

/** The advice slot of a row that installs something: its advice, the analysis under way, or the button asking for one. */
function rowAdvice(advice: UpdateAdvisory | null, job: AnalysisJob, updatable: boolean, tools: AdviceTools): ReactNode {
  const { advisor } = tools
  return <AdviceSlot advice={advice} job={advisor.jobFor(job.kind, job.id, job.target)} canAnalyse={advisor.ready && updatable} onAnalyse={() => useAdviceStore.getState().enqueue([job])} onForget={advice ? () => tools.forget(advice.id) : undefined} />
}

function AdviceControls({ advisor, jobs, updatable }: { advisor: Advisor; jobs: AnalysisJob[]; updatable: number }) {
  const t = useT()
  const auto = useUpdatesPrefs((s) => s.autoAdvice)
  const setAuto = useUpdatesPrefs((s) => s.setAutoAdvice)
  const progress = advisor.progress
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', flex: 1 }}>
      <FormControlLabel
        control={<Switch size="small" checked={auto} onChange={(_event, value) => setAuto(value)} />}
        label={<Box component="span" sx={{ fontSize: 12.5 }}>{t('updates.advice.auto')}</Box>}
        title={t('updates.advice.auto.tip')}
        sx={{ m: 0 }}
      />
      {progress ? (
        <>
          <Box role="status" sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('updates.advice.progress', [progress.current.name, progress.position, progress.total])}</Box>
          <Button size="small" variant="text" onClick={() => useAdviceStore.getState().dropQueued()}>{t('updates.advice.cancel')}</Button>
        </>
      ) : (
        advisor.ready && updatable > 0 && <Button size="small" variant="outlined" disabled={jobs.length === 0} onClick={() => useAdviceStore.getState().enqueue(jobs)}>{t('updates.advice.analyseAll', [jobs.length])}</Button>
      )}
    </Box>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const t = useT()
  const sizeLabel = useSizeLabel()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<KindFilter>('all')
  const check = useUpdatesCheck()
  const advisories = useAdvisories()
  const advisor = useAdvisor(check.data)
  const queue = useUpdatesStore((s) => s.queue)
  const enqueue = useUpdatesStore((s) => s.enqueue)
  const downloads = useDownloadStore((s) => s.downloads)
  const engineInstall = useInstallStore((s) => s.engineInstall)
  const packInstall = useInstallStore((s) => s.packInstall)
  const ctx = { downloads, engineInstall, packInstall }
  const rows = visibleRows(check.data, filter)
  const all = pendingItems(rows, queue)
  const jobs = analysisJobs(rows)
  const failed = [...rows.engines, ...rows.models].filter((r) => r.state === 'error').length
  const updatable = [...rows.engines, ...rows.models].filter((r) => r.state === 'update').length
  const busy = check.isFetching
  const forget = (id: string) => {
    void updatesApi.removeAdvisory(id).then(() => queryClient.invalidateQueries({ queryKey: updatesKeys.advisories }))
    queryClient.setQueryData<UpdatesReport>(updatesKeys.check, (report) => (report ? dropAdvisory(report, id) : report))
  }
  const tools: AdviceTools = { advisor, forget }
  /** An update the analysis discourages only asks for one more confirmation (it quotes what was found): nothing is ever blocked. */
  const start = async (items: UpdateItem[]) => {
    const risky = discouragedItems(items, check.data)
    if (risky.length > 0) {
      const ok = await confirm({ titleId: 'updates.advice.confirm.title', messageId: 'updates.advice.confirm.message', params: [risky.map((r) => `${r.name} : ${findingsText(r.advice)}`).join(' — ')], confirmLabelId: 'updates.advice.confirm.ok' })
      if (!ok) return
    }
    enqueue(items)
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 3 }}>
        <DialogTitle id="updates-title">{t('updates.title')}</DialogTitle>
        <Box sx={{ display: 'flex', gap: '4px' }}>
          <TipIconButton labelId="updates.recheck" onClick={() => void check.refetch()} disabled={busy} sx={{ borderRadius: '8px' }}>
            {busy ? <CircularProgress size={14} color="inherit" /> : <RefreshRounded sx={{ fontSize: 16 }} />}
          </TipIconButton>
          <TipIconButton labelId="updates.close" onClick={onClose} sx={{ borderRadius: '8px' }}>
            <CloseRounded sx={{ fontSize: 16 }} />
          </TipIconButton>
        </Box>
      </Box>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_event, value: KindFilter | null) => value && setFilter(value)} aria-label={t('updates.filter.aria')}>
            {FILTERS.map((f) => (
              <ToggleButton key={f} value={f}>{t(`updates.filter.${f}`)}</ToggleButton>
            ))}
          </ToggleButtonGroup>
          {check.isPending && (
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 96, justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
              <CircularProgress size={18} aria-hidden />
              {t('updates.checking')}
            </Box>
          )}
          {check.isError && (
            <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 13, color: 'var(--danger)' }}>
              {t('updates.error')}
              <Button size="small" variant="text" onClick={() => void check.refetch()}>{t('updates.retry')}</Button>
            </Box>
          )}
          {!check.data && <SavedAdvisories advisories={advisories.data ?? []} onForget={forget} />}
          {check.data && (
            <>
              <Summary updates={updatable} failed={failed} />
              {updatable > 0 && <LocalAiInvite setup={advisor.setup} />}
              <UpdateSection title={t('updates.section.engines')} allLabel={t('updates.section.updateEngines', [pendingItems(rows, queue, 'engines').length])} pending={pendingItems(rows, queue, 'engines').length} onUpdateAll={() => void start(pendingItems(rows, queue, 'engines'))} empty={t('updates.section.noEngines')}>
                {rows.engines.map((e) => (
                  <UpdateRow key={e.id} name={e.name} kinds={e.kinds} state={e.state} remark={engineRemark(e, t)} advice={rowAdvice(e.advice, makeJob('engine', e.id, `${e.name} ${e.target ?? ''}`, 'pinned'), e.state === 'update' && e.reason === 'pinned', tools)} actions={engineActions(e, t, (items) => void start(items), tools)} item={findItem(queue, toEngineItem(e).key)} progress={progressOf({ kind: 'engine', id: e.id }, ctx)} onUpdate={() => void start([toEngineItem(e)])} />
                ))}
              </UpdateSection>
              <UpdateSection title={t('updates.section.models')} allLabel={t('updates.section.updateModels', [pendingItems(rows, queue, 'models').length])} pending={pendingItems(rows, queue, 'models').length} onUpdateAll={() => void start(pendingItems(rows, queue, 'models'))} empty={t('updates.section.noModels')}>
                {rows.models.map((m) => (
                  <UpdateRow key={m.id} name={m.name} kinds={[m.kind]} state={m.state} remark={modelRemark(m, t, sizeLabel)} advice={rowAdvice(m.advice, makeJob('model', m.id, m.name, 'pinned'), m.state === 'update', tools)} item={findItem(queue, toModelItem(m).key)} progress={progressOf({ kind: 'model', id: m.id }, ctx)} onUpdate={() => void start([toModelItem(m)])} />
                ))}
              </UpdateSection>
              <Box component="p" sx={{ m: 0, fontSize: 11.5, lineHeight: 1.4, color: 'var(--faint)' }}>{t('updates.note')}</Box>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, justifyContent: 'space-between' }}>
        <AdviceControls advisor={advisor} jobs={jobs} updatable={updatable} />
        <Button variant="contained" disabled={all.length === 0 || busy} onClick={() => void start(all)}>
          {t('updates.updateAll', [all.length])}
        </Button>
      </DialogActions>
    </>
  )
}

/**
 * Dialog "Check updates": the installed engines (stable-diffusion.cpp, audio.cpp, Python packs) and the installed models, with the
 * ones that can be updated, a button per row, per section and for everything, and the progress of what is running. The kind
 * filter (all, image, audio, video) narrows the rows, and with them what the "update all" buttons start. The check runs
 * when the dialog opens; the updates run one after the other (`useUpdateRunner`) and go on when it is closed.
 *
 * The adviser: the advice kept from earlier analyses is shown at once (even without a network) and attached to the rows once the check
 * is read; a local model can analyse the risks of each update on a click, or on its own when "automatic analysis" is on. The advice is
 * informative (« automatic advice, to be checked »): a discouraged update asks for one more confirmation, nothing is ever blocked.
 */
export function UpdatesDialog() {
  const open = useUpdatesStore((s) => s.open)
  const setOpen = useUpdatesStore((s) => s.setOpen)
  return (
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth aria-labelledby="updates-title" slotProps={{ paper: { sx: { maxWidth: 760 } } }}>
      <Body onClose={() => setOpen(false)} />
    </Dialog>
  )
}
