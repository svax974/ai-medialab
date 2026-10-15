/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, CircularProgress } from '@mui/material'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import CheckRounded from '@mui/icons-material/CheckRounded'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import MemoryOutlined from '@mui/icons-material/MemoryOutlined'
import { IndeterminateBar, ProgressBar } from '@/modules_shared/common/components/ui/progress'
import { formatGb } from '@/modules/hardware'
import { Notice, activeDownload, downloadError, modelCatalogApi, useDownloadStore, useWelcomeModel, type ModelInfo, type ModelKind } from '@/modules/model-catalog'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { useCancelInstall } from '../hooks/useEngineInstaller'
import { startSetup } from '../hooks/useModelSetup'
import { setupPlan, type SetupPlan } from '../lib/installState'
import { setupButtonKey, setupParts } from '../lib/setupLabels'
import { useInstallStore } from '../state/installStore'
import type { EngineInstallState, InstallStatus, PackInstallState } from '../types'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'

function Steps({ plan, engineState }: { plan: SetupPlan; engineState: InstallStatus }) {
  const t = useT()
  if (!(plan.needEngine && plan.needModel)) return null
  return (
    <Box sx={{ mt: '6px', display: 'flex', flexWrap: 'wrap', gap: '2px 16px', fontSize: 12, color: 'var(--muted)' }}>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {engineState === 'done' ? <CheckRounded sx={{ fontSize: 14, color: 'var(--ok)' }} /> : engineState === 'running' ? <CircularProgress size={12} /> : <MemoryOutlined sx={{ fontSize: 14 }} />}
        {t('engines.setup.step1')}
      </Box>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <CloudDownloadOutlined sx={{ fontSize: 14 }} /> {t('engines.setup.step2')}
      </Box>
    </Box>
  )
}

/** The state of the engine this model needs: its pack's installer, llama.cpp's (chat models), or the shared stable-diffusion.cpp one. */
function useEngineOf(model: ModelInfo): EngineInstallState | PackInstallState {
  const sd = useInstallStore((s) => s.engineInstall)
  const llama = useInstallStore((s) => s.llamacppInstall)
  const pack = useInstallStore((s) => s.packInstall)
  if (model.backend === 'llamacpp') return llama
  if (!model.engine_pack) return sd
  return pack.pack === model.engine_pack ? pack : { state: 'idle' }
}

function SetupProgress({ model, engine, download }: { model: ModelInfo; engine: EngineInstallState | PackInstallState; download: ReturnType<typeof activeDownload> }) {
  const running = engine.state === 'running'
  const pack = engine as PackInstallState
  const sd = engine as EngineInstallState
  return (
    <>
      {running && !model.engine_pack && <ProgressBar done={sd.done ?? 0} total={sd.total ?? 0} />}
      {running && !model.engine_pack && sd.message && (
        <Box component="p" sx={{ m: 0, mt: '4px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--faint)' }}>
          {sd.message}
        </Box>
      )}
      {running && model.engine_pack && <IndeterminateBar message={pack.message} detail={pack.detail} sinceEpochSeconds={pack.started_at} />}
      {download && <ProgressBar done={download.done} total={download.total} rate={download.rate} etaSeconds={download.eta} />}
    </>
  )
}

/**
 * What is missing to use a model, with one button to install it all (engine, then model), the progress of each step,
 * cancel, and the readable error. `welcome` is the first-launch card (recommended model for this machine).
 * Nothing when the model is ready.
 */
export function SetupPrompt({ model, welcome = false }: { model: ModelInfo; welcome?: boolean }) {
  const t = useT()
  const lang = useLang()
  const engine = useEngineOf(model)
  const live = useDownloadStore((s) => s.downloads[model.id])
  const pending = useInstallStore((s) => s.pendingModelId)
  const cancelInstall = useCancelInstall(model.engine_pack ? 'pack' : model.backend === 'llamacpp' ? 'llamacpp' : 'sdcpp')
  const [busy, setBusy] = useState(false)
  const plan = setupPlan(model)
  if (!plan) return null

  const download = activeDownload(live, model)
  const engineError = engine.state === 'error' && plan.needEngine ? (engine as { error?: string | null }).error : null
  const error = engineError || downloadError(live, model)
  const working = engine.state === 'running' || !!download || busy || !!pending
  const total = setupParts(plan, model.engine_name, (gb) => formatGb(gb, lang)).map((p) => t(p.key, p.params)).join(' + ')
  const cancel = () => {
    useInstallStore.getState().setPending(null)
    if (engine.state === 'running') cancelInstall.mutate()
    else if (download) void modelCatalogApi.cancelDownload(model.id).catch(() => undefined)
  }
  return (
    <Box sx={{ borderRadius: '16px', border: '1px solid', px: 2, py: 1.75, ...(welcome ? { borderColor: 'color-mix(in oklab, var(--safe) 40%, transparent)', backgroundColor: 'var(--safe-soft)' } : { mx: 2, mb: '4px', borderColor: 'color-mix(in oklab, var(--warn) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)' }) }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        {welcome ? <AutoAwesomeOutlined sx={{ fontSize: 16, flexShrink: 0, color: 'var(--safe)' }} /> : <CloudDownloadOutlined sx={{ fontSize: 16, flexShrink: 0, color: 'var(--warn)' }} />}
        <Box sx={{ minWidth: 0, flex: 1, fontSize: 13, lineHeight: 1.4, color: 'var(--ink-2)' }}>
          <Box component="b" sx={{ fontWeight: 500, color: 'var(--ink)' }}>
            {t(welcome ? 'engines.welcome.lead' : 'engines.setup.notReady', [model.name])}
          </Box>{' '}
          {t(welcome ? 'engines.welcome.rest' : 'engines.setup.toInstall', [total])}
          <Steps plan={plan} engineState={engine.state} />
        </Box>
        {!working && (
          <Button variant="contained" startIcon={<CloudDownloadOutlined />} onClick={async () => { setBusy(true); await startSetup(model); setBusy(false) }}>
            {t(setupButtonKey(plan))}
          </Button>
        )}
        {working && (
          <Button variant="outlined" onClick={cancel}>
            {t('engines.cancel')}
          </Button>
        )}
      </Box>
      <SetupProgress model={model} engine={engine} download={download} />
      {error && !working && (
        <Notice tone="danger" sx={{ mt: 1.25 }}>
          {error}
        </Notice>
      )}
    </Box>
  )
}

/** First-launch card: while nothing is ready, proposes the model recommended for this machine and what it needs. */
export function WelcomeSetup({ kind = 'image' }: { kind?: ModelKind }) {
  const t = useT()
  const model = useWelcomeModel(kind)
  const setModelsOpen = useStudioStore((s) => s.setModelsOpen)
  if (!model) return null
  return (
    <Box sx={{ mb: 2 }}>
      <SetupPrompt model={model} welcome />
      <Box component="p" sx={{ m: 0, mt: 1, textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>
        {t('engines.welcome.recommended', [model.name, model.license || t('engines.welcome.freeLicense')])}{' '}
        <Box component="button" type="button" onClick={() => setModelsOpen(true)} sx={{ border: 0, background: 'none', p: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', '&:hover': { color: 'var(--ink)', textDecoration: 'underline' } }}>
          {t('engines.welcome.chooseOther')}
        </Box>
      </Box>
    </Box>
  )
}
