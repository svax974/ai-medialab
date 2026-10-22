/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button } from '@mui/material'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import { LocalAiProgress, DISK_MARGIN_GB, type LocalAiSetup } from '@/modules/engines'
import { formatGb } from '@/modules/hardware'
import { Section } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'

/**
 * The invitation to install the local adviser (llama.cpp and a small chat model) when updates are waiting and no local model is ready.
 * Nothing is started without a click; the disk is checked first; the progress and errors are those of `useLocalAiSetup`.
 */
export function LocalAiInvite({ setup }: { setup: LocalAiSetup }) {
  const t = useT()
  const { state } = setup
  if (state === 'ready' || state === 'unknown') return null
  const busy = state === 'installing' || state === 'downloading'
  return (
    <Section title={t('updates.advice.invite.title')}>
      <Box sx={{ display: 'grid', gap: 1.25 }}>
        <Box component="p" sx={{ m: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>{t('updates.advice.invite.body')}</Box>
        {!busy && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
            <Button variant="contained" size="small" startIcon={<CloudDownloadOutlined />} disabled={state === 'no-space'} onClick={() => void setup.start({ withModel: true })}>
              {t(state === 'error' ? 'updates.retry' : 'updates.advice.invite.button', [formatGb(setup.neededGb)])}
            </Button>
            <Box component="span" sx={{ fontSize: 11.5, color: 'var(--faint)' }}>
              {t(setup.modelSizeGb === 0 ? 'updates.advice.invite.partsPresent' : 'updates.advice.invite.parts', [String(setup.engineSizeMb), formatGb(setup.modelSizeGb), setup.modelName ?? ''])}
            </Box>
          </Box>
        )}
        {state === 'no-space' && (
          <Box role="alert" sx={{ fontSize: 12, color: 'var(--danger)' }}>
            {t('engines.localAi.noSpace', [formatGb(setup.neededGb), String(DISK_MARGIN_GB), formatGb(setup.freeGb ?? 0)])}
          </Box>
        )}
        <LocalAiProgress setup={setup} />
      </Box>
    </Section>
  )
}
