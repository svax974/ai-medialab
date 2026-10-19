/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Dialog, DialogContent, DialogTitle, Tab, Tabs } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { ComponentsManager } from '@/modules/engines'
import { ModelsManager } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { GeneralSettings } from './GeneralSettings'

type SettingsTab = 'general' | 'engines' | 'models'
const TABS: readonly SettingsTab[] = ['general', 'engines', 'models']

/**
 * Settings of the studio, in three tabs: "General" (memory, previews, tokens, shortcuts), "Engines" (what the app downloaded
 * besides the models, with delete) and "Models" (the catalogue by category, with delete). Only the shown tab is mounted, so
 * nothing is loaded before it is opened.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [tab, setTab] = useState<SettingsTab>('general')

  return (
    <Dialog open={open} onClose={onClose} fullWidth aria-labelledby="settings-title" slotProps={{ paper: { sx: { maxWidth: 680 } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 3 }}>
        <DialogTitle id="settings-title">{t('settings.title')}</DialogTitle>
        <TipIconButton labelId="settings.close" onClick={onClose} sx={{ borderRadius: '8px' }}>
          <CloseRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
      <Tabs value={tab} onChange={(_event, value: SettingsTab) => setTab(value)} sx={{ px: 3, borderBottom: '1px solid var(--line)' }}>
        {TABS.map((id) => <Tab key={id} value={id} label={t(`settings.tabs.${id}`)} id={`settings-tab-${id}`} aria-controls="settings-panel" />)}
      </Tabs>
      <DialogContent id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} sx={{ pt: 3 }}>
        {open && tab === 'general' && <GeneralSettings />}
        {open && tab === 'engines' && <ComponentsManager />}
        {open && tab === 'models' && <ModelsManager />}
      </DialogContent>
    </Dialog>
  )
}
