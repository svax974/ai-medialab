/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import { formatGb } from '@/modules/hardware'
import { useWelcomeModel, type ModelInfo, type ModelKind } from '@/modules/model-catalog'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { startSetup } from '../hooks/useModelSetup'
import { setupPlan } from '../lib/installState'
import { setupButtonKey, setupParts } from '../lib/setupLabels'
import { useSetupStore } from '../state/setupStore'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'

/**
 * What is missing to use a model, with one button that opens the confirmation (`SetupDialog`: base data, engine, model, sizes)
 * and, once it runs, follows it. `welcome` is the first-launch card (recommended model for this machine). Nothing when the model is ready.
 */
export function SetupPrompt({ model, welcome = false }: { model: ModelInfo; welcome?: boolean }) {
  const t = useT()
  const lang = useLang()
  const run = useSetupStore((s) => s.run)
  const plan = setupPlan(model)
  if (!plan) return null

  const working = run.state === 'running' && run.model_id === model.id
  const total = setupParts(plan, model.engine_name, (gb) => formatGb(gb, lang)).map((p) => t(p.key, p.params)).join(' + ')
  return (
    <Box sx={{ borderRadius: '16px', border: '1px solid', px: 2, py: 1.75, ...(welcome ? { borderColor: 'color-mix(in oklab, var(--safe) 40%, transparent)', backgroundColor: 'var(--safe-soft)' } : { mx: 2, mb: '4px', borderColor: 'color-mix(in oklab, var(--warn) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)' }) }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        {welcome ? <AutoAwesomeOutlined sx={{ fontSize: 16, flexShrink: 0, color: 'var(--safe)' }} /> : <CloudDownloadOutlined sx={{ fontSize: 16, flexShrink: 0, color: 'var(--warn)' }} />}
        <Box sx={{ minWidth: 0, flex: 1, fontSize: 13, lineHeight: 1.4, color: 'var(--ink-2)' }}>
          <Box component="b" sx={{ fontWeight: 500, color: 'var(--ink)' }}>
            {t(welcome ? 'engines.welcome.lead' : 'engines.setup.notReady', [model.name])}
          </Box>{' '}
          {t(welcome ? 'engines.welcome.rest' : 'engines.setup.toInstall', [total])}
        </Box>
        <Button variant="contained" startIcon={<CloudDownloadOutlined />} onClick={() => startSetup(model)}>
          {t(working ? 'engines.setup.follow' : setupButtonKey(plan))}
        </Button>
      </Box>
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
