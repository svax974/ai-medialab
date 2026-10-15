/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import { useNavigate } from 'react-router-dom'
import { Notice } from '@/modules/model-catalog'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { shouldPromptLocalAi } from '../lib/launchPrompt'
import { useLocalAiSetup, type LocalAiSetup } from '../hooks/useLocalAiSetup'
import { useLocalAiPromptStore } from '../state/localAiPromptStore'
import { LocalAiProgress } from './LocalAiProgress'

const BENEFITS = ['chat', 'updates', 'prompts', 'local'] as const

/** An extra choice the host adds to the invitation (the update adviser's automatic analysis lives in another module): applied on install only. */
export interface LaunchExtraOption {
  label: string
  defaultChecked: boolean
  onApply: (checked: boolean) => void
}

function Benefits() {
  const t = useT()
  return (
    <Box component="ul" sx={{ m: 0, mt: 1.5, p: 0, listStyle: 'none', display: 'grid', gap: '10px' }}>
      {BENEFITS.map((id) => (
        <Box component="li" key={id} sx={{ display: 'flex', gap: '10px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
          <CheckRounded sx={{ fontSize: 16, mt: '2px', color: 'var(--safe)', flexShrink: 0 }} aria-hidden />
          <span>
            <Box component="strong" sx={{ color: 'var(--ink)', fontWeight: 600 }}>{t(`engines.localAi.launch.benefit.${id}.title`)}</Box>
            {' — '}
            {t(`engines.localAi.launch.benefit.${id}.text`)}
          </span>
        </Box>
      ))}
    </Box>
  )
}

function Sizes({ setup, withModel }: { setup: LocalAiSetup; withModel: boolean }) {
  const t = useT()
  const model = setup.modelName ? ` · ${t('engines.localAi.launch.sizes.model', [setup.modelName, setup.modelSizeGb.toFixed(1)])}` : ''
  const free = setup.freeGb !== null ? ` · ${t('engines.localAi.launch.sizes.free', [setup.freeGb.toFixed(0)])}` : ''
  return (
    <Box component="p" sx={{ m: 0, mt: 2, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--faint)' }}>
      {t('engines.localAi.launch.sizes.engine', [setup.engineSizeMb])}
      {withModel ? model : ''}
      {free}
    </Box>
  )
}

interface ChoicesProps {
  setup: LocalAiSetup
  withModel: boolean
  onWithModel: (v: boolean) => void
  extra?: { label: string; checked: boolean; onChange: (v: boolean) => void }
}

function Choices({ setup, withModel, onWithModel, extra }: ChoicesProps) {
  const t = useT()
  return (
    <Box sx={{ mt: 1, display: 'grid' }}>
      {!setup.modelInstalled && setup.modelName && (
        <FormControlLabel
          control={<Checkbox size="small" checked={withModel} onChange={(_e, v) => onWithModel(v)} />}
          label={t('engines.localAi.launch.withModel', [setup.modelName, setup.modelSizeGb.toFixed(1)])}
        />
      )}
      {extra && <FormControlLabel control={<Checkbox size="small" checked={extra.checked} onChange={(_e, v) => extra.onChange(v)} />} label={extra.label} />}
    </Box>
  )
}

function Done({ onChat, onClose }: { onChat: () => void; onClose: () => void }) {
  const t = useT()
  return (
    <>
      <DialogContent>
        <Notice framed tone="neutral">{t('engines.localAi.launch.done')}</Notice>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={onClose}>{t('engines.localAi.launch.close')}</Button>
        <Button variant="contained" onClick={onChat}>{t('engines.localAi.launch.openChat')}</Button>
      </DialogActions>
    </>
  )
}

/**
 * The invitation shown at each launch while llama.cpp (the chat engine) is not installed: what the local AI brings (chat at once,
 * smarter updates, improved prompts, everything local), what it costs on disk, a choice to fetch the recommended chat model too,
 * the install with its progress, and a "do not offer it again" box. The chat models stay downloadable from the Chat model list.
 * `suppressed`: hold it back (a private session is on). `extraOption`: one more box from the host.
 */
export function LocalAiLaunchDialog({ suppressed = false, extraOption }: { suppressed?: boolean; extraOption?: LaunchExtraOption }) {
  const t = useT()
  const navigate = useNavigate()
  const setup = useLocalAiSetup()
  const { optOut, dismissed, setOptOut, dismiss } = useLocalAiPromptStore()
  const [engaged, setEngaged] = useState(false)
  const [withModel, setWithModel] = useState(true)
  const [never, setNever] = useState(false)
  const [extraChecked, setExtraChecked] = useState(extraOption?.defaultChecked ?? false)
  const due = shouldPromptLocalAi({ state: setup.state, engineInstalled: setup.engineInstalled, optOut, dismissed, privateMode: suppressed })
  const open = !dismissed && !suppressed && (engaged || due)
  const finish = () => {
    if (never) setOptOut(true)
    dismiss()
  }
  const install = () => {
    setEngaged(true)
    if (never) setOptOut(true)
    extraOption?.onApply(extraChecked)
    void setup.start({ withModel })
  }
  const busy = setup.state === 'installing' || setup.state === 'downloading'
  const finished = engaged && setup.state === 'ready'

  return (
    <Dialog open={open} onClose={busy ? undefined : finish} fullWidth aria-labelledby="local-ai-title" slotProps={{ paper: { sx: { maxWidth: 520 } } }}>
      <DialogTitle id="local-ai-title">{t('engines.localAi.launch.title')}</DialogTitle>
      {finished ? (
        <Done onChat={() => { finish(); navigate(studioPaths.chatHome) }} onClose={finish} />
      ) : (
        <>
          <DialogContent>
            <Box component="p" sx={{ m: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>{t('engines.localAi.launch.intro')}</Box>
            <Benefits />
            <Sizes setup={setup} withModel={withModel} />
            {!busy && <Choices setup={setup} withModel={withModel} onWithModel={setWithModel} extra={extraOption && { label: extraOption.label, checked: extraChecked, onChange: setExtraChecked }} />}
            {setup.state === 'no-space' && <Box sx={{ mt: 1.5 }}><Notice framed tone="danger">{t('engines.localAi.noSpace', [setup.neededGb.toFixed(1), '2', setup.freeGb?.toFixed(1) ?? '?'])}</Notice></Box>}
            <Box sx={{ mt: 1.5 }}><LocalAiProgress setup={setup} /></Box>
            <Box component="p" sx={{ m: 0, mt: 2, fontSize: 12, color: 'var(--faint)' }}>{t('engines.localAi.launch.models')}</Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
            <FormControlLabel control={<Checkbox size="small" checked={never} onChange={(_e, v) => setNever(v)} />} label={<Box component="span" sx={{ fontSize: 13 }}>{t('engines.localAi.launch.never')}</Box>} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="text" onClick={finish} disabled={busy}>{t('engines.localAi.launch.later')}</Button>
              <Button variant="contained" onClick={install} disabled={busy || setup.state === 'no-space'}>{t('engines.localAi.launch.install')}</Button>
            </Box>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
