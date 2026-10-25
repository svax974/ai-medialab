/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded'
import { IndeterminateBar, ProgressBar } from '@/modules_shared/common/components/ui/progress'
import { Notice, VariantPicker, useModels, type ModelInfo } from '@/modules/model-catalog'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { dialogPhase, formatSize, hasKnownTotal, missingSteps, stepKindKey, type DialogPhase } from '../lib/setupDialog'
import { enginesApi } from '../services/enginesApi'
import { useSetupStore } from '../state/setupStore'
import type { InstallPlan, SetupRun, SetupRunStep } from '../types'

// Includes the selected variant: switching it (see `Confirm`) must refetch the plan for the newly chosen quantization.
const planKey = (modelId: string, variant: string) => ['engines', 'setup-plan', modelId, variant] as const

function StepIcon({ state }: { state: SetupRunStep['state'] | 'todo' }) {
  if (state === 'done') return <CheckRounded sx={{ fontSize: 16, color: 'var(--ok)' }} aria-hidden />
  if (state === 'running') return <CircularProgress size={14} aria-hidden />
  if (state === 'error') return <ErrorOutlineRounded sx={{ fontSize: 16, color: 'var(--danger)' }} aria-hidden />
  return <RadioButtonUncheckedRounded sx={{ fontSize: 16, color: 'var(--faint)' }} aria-hidden />
}

/** One line per thing to download: what it is ("Données de base"…), its name, its size. */
function StepRow({ kind, name, sizeMb, state, purpose }: { kind: SetupRunStep['kind']; name: string; sizeMb: number; state: SetupRunStep['state'] | 'todo'; purpose?: SetupRunStep['purpose'] }) {
  const t = useT()
  const lang = useLang()
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: 13.5, lineHeight: 1.4 }}>
      <StepIcon state={state} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box component="span" sx={{ color: 'var(--muted)' }}>{t(stepKindKey(kind))}</Box>
        <Box component="span" sx={{ color: 'var(--faint)' }}> · </Box>
        <Box component="span" sx={{ color: 'var(--ink)' }}>{name}</Box>
        {purpose && <Box component="span" sx={{ color: 'var(--faint)' }}> ({t(`engines.setup.purpose.${purpose}`)})</Box>}
      </Box>
      <Box component="span" sx={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'var(--muted)' }}>{formatSize(sizeMb, lang)}</Box>
    </Box>
  )
}

function StepList({ children }: { children: React.ReactNode }) {
  return <Box component="ul" sx={{ m: 0, mt: 1.5, p: 0, listStyle: 'none', display: 'grid', gap: '10px' }}>{children}</Box>
}

function Confirm({ plan, model, busy }: { plan: InstallPlan; model: ModelInfo; busy: boolean }) {
  const t = useT()
  const lang = useLang()
  return (
    <>
      <Box component="p" sx={{ m: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>{t('engines.setup.dialog.intro', [model.name])}</Box>
      {model.variants.length > 1 && <VariantPicker model={model} disabled={busy} />}
      <StepList>
        {missingSteps(plan).map((step) => <StepRow key={step.id} kind={step.kind} name={step.name} sizeMb={step.size_mb} state="todo" purpose={step.purpose} />)}
      </StepList>
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--ink)' }}>
        <Box component="strong" sx={{ fontWeight: 600 }}>{t('engines.setup.dialog.total')}</Box>
        <Box component="strong" sx={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>{formatSize(plan.total_mb, lang)}</Box>
      </Box>
      <Box component="p" sx={{ m: 0, mt: 1.5, fontSize: 12, color: 'var(--faint)' }}>{t('engines.setup.dialog.note')}</Box>
    </>
  )
}

function Running({ run }: { run: SetupRun }) {
  const t = useT()
  return (
    <>
      <StepList>
        {run.steps.map((step) => <StepRow key={step.id} kind={step.kind} name={step.name} sizeMb={step.size_mb} state={step.state} purpose={step.purpose} />)}
      </StepList>
      {hasKnownTotal(run)
        ? <ProgressBar done={run.done} total={run.total} rate={run.rate} etaSeconds={run.eta} />
        : <IndeterminateBar message={run.message} detail={run.detail} sinceEpochSeconds={run.started_at ?? undefined} />}
      <Box component="p" sx={{ m: 0, mt: 1.5, fontSize: 12, color: 'var(--faint)' }}>{t('engines.setup.dialog.cancelNote')}</Box>
    </>
  )
}

function Body({ phase, modelName, model, plan, run, busy }: { phase: DialogPhase; modelName: string; model?: ModelInfo; plan?: InstallPlan; run: SetupRun; busy: boolean }) {
  const t = useT()
  if (phase === 'loading') return <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'var(--muted)' }}><CircularProgress size={14} /> {t('engines.setup.dialog.loading')}</Box>
  if (phase === 'blocked') return <Notice framed tone="danger">{plan?.blocked}</Notice>
  if (phase === 'ready') return <Box sx={{ fontSize: 14, color: 'var(--muted)' }}>{t('engines.setup.dialog.ready', [modelName])}</Box>
  if (phase === 'confirm') return plan && model ? <Confirm plan={plan} model={model} busy={busy} /> : null
  if (phase === 'running') return <Running run={run} />
  if (phase === 'cancelled') return <Box sx={{ fontSize: 14, color: 'var(--muted)' }}>{t('engines.setup.dialog.cancelled')}</Box>
  if (phase === 'failed') return <Notice framed tone="danger">{run.error ?? t('engines.setup.dialog.failed')}</Notice>
  return <Box sx={{ fontSize: 14, color: 'var(--muted)' }}>{t('engines.setup.dialog.done', [modelName])}</Box>
}

/**
 * Confirmation of everything a model needs, then the install with one progress and one cancel. Lists, with their sizes, the
 * "Données de base" (shared by several engines), the "Moteur d'exécution" and the "Modèle" that are not installed yet: what is
 * already there is never downloaded again. Cancelling removes what was only partly downloaded. Mounted once by the shell.
 */
export function SetupDialog() {
  const t = useT()
  const lang = useLang()
  const modelId = useSetupStore((s) => s.dialogModelId)
  const run = useSetupStore((s) => s.run)
  const close = useSetupStore((s) => s.close)
  const [busy, setBusy] = useState(false)
  const catalog = useModels().data
  const model = catalog?.models.find((m) => m.id === modelId)
  const planQuery = useQuery({ queryKey: planKey(modelId ?? '', model?.variant ?? ''), queryFn: () => enginesApi.installPlan(modelId ?? ''), enabled: !!modelId, staleTime: 0, gcTime: 0 })
  const phase = modelId ? dialogPhase(modelId, planQuery.data, run) : 'loading'
  const modelName = model?.name ?? run.model_name ?? modelId ?? ''

  useEffect(() => {
    if (modelId && phase === 'done') {
      toast.success(t('engines.setup.dialog.done', [modelName]))
      close()
    }
  }, [modelId, phase, modelName, close, t])

  if (!modelId) return null
  const start = async () => {
    setBusy(true)
    try {
      useSetupStore.getState().setRun(await enginesApi.startSetup(modelId))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => void enginesApi.cancelSetup().catch((error: Error) => toast.error(error.message))
  const running = phase === 'running'
  const total = planQuery.data?.total_mb ?? 0

  return (
    <Dialog open onClose={running ? undefined : close} fullWidth aria-labelledby="setup-title" slotProps={{ paper: { sx: { maxWidth: 520 } } }}>
      <DialogTitle id="setup-title">{t(running ? 'engines.setup.dialog.titleRunning' : 'engines.setup.dialog.title', [modelName])}</DialogTitle>
      <DialogContent>
        <Body phase={phase} modelName={modelName} model={model} plan={planQuery.data} run={run} busy={busy} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {running ? (
          <Button variant="outlined" onClick={cancel}>{t('engines.cancel')}</Button>
        ) : (
          <>
            <Button variant="text" onClick={close}>{t(phase === 'confirm' ? 'engines.cancel' : 'engines.setup.dialog.close')}</Button>
            {phase === 'confirm' && <Button variant="contained" disabled={busy} onClick={() => void start()}>{t('engines.setup.dialog.start', [formatSize(total, lang)])}</Button>}
            {(phase === 'failed' || phase === 'cancelled') && <Button variant="contained" disabled={busy} onClick={() => void start()}>{t('engines.setup.dialog.retry')}</Button>}
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
