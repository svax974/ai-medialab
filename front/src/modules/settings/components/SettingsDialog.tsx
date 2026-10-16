/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useLocalAiPromptStore } from '@/modules/engines'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useSaveSettings, useSettings } from '../hooks/useSettings'
import { SETTINGS_HELP, SHORTCUT_ROWS } from '../lib/settingsConfig'
import { BraveKeyField } from './BraveKeyField'
import { ChatVoiceField } from './ChatVoiceField'
import { HfTokenField } from './HfTokenField'
import { KeepAliveControl } from './KeepAliveControl'
import { SectionText, SectionTitle, SwitchRow } from './SettingsSection'

function ShortcutList() {
  const t = useT()
  return (
    <section>
      <Box component="h3" className="cn-eyebrow" sx={{ m: 0, mb: 1 }}>
        {t('settings.shortcuts.title')}
      </Box>
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: '6px', fontSize: 13 }}>
        {SHORTCUT_ROWS.map((row) => (
          <Box key={row.labelId} sx={{ display: 'contents' }}>
            <Box component="dt" sx={{ color: 'var(--muted)' }}>
              {t(row.labelId)}
            </Box>
            <Box component="dd" sx={{ m: 0, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-2)' }}>
              {row.keys}
            </Box>
          </Box>
        ))}
      </Box>
    </section>
  )
}

/**
 * Settings of the studio: model memory (keep-alive, memory saving), previews, the optional Hugging Face token and the
 * shortcut reminders. Loaded when opened; each change is saved at once and the answer replaces the displayed state.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const { data: settings, isPending, isError, refetch } = useSettings(open)
  const save = useSaveSettings()
  const localAiOptOut = useLocalAiPromptStore((s) => s.optOut)
  const setLocalAiOptOut = useLocalAiPromptStore((s) => s.setOptOut)

  return (
    <Dialog open={open} onClose={onClose} fullWidth aria-labelledby="settings-title" slotProps={{ paper: { sx: { maxWidth: 560 } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 3 }}>
        <DialogTitle id="settings-title">{t('settings.title')}</DialogTitle>
        <TipIconButton labelId="settings.close" onClick={onClose} sx={{ borderRadius: '8px' }}>
          <CloseRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
      <DialogContent>
        {isPending && (
          <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'var(--muted)' }}>
            <CircularProgress size={14} /> {t('settings.loading')}
          </Box>
        )}
        {isError && (
          <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'var(--danger)' }}>
            {t('settings.error')}
            <Button size="small" variant="text" onClick={() => void refetch()}>
              {t('settings.retry')}
            </Button>
          </Box>
        )}
        {settings && (
          <Box sx={{ display: 'grid', gap: 3.5 }}>
            <section>
              <SectionTitle title={t('settings.memory.title')} help={SETTINGS_HELP.keepAlive} />
              <Box sx={{ mb: 1.5 }}>
                <SectionText>{t('settings.memory.description')}</SectionText>
              </Box>
              <KeepAliveControl value={settings.keep_alive_minutes} onChange={(minutes) => save.mutate({ keep_alive_minutes: minutes })} />
            </section>
            <SwitchRow
              title={t('settings.previews.title')}
              description={t('settings.previews.description')}
              help={SETTINGS_HELP.previews}
              checked={settings.previews}
              onChange={(previews) => save.mutate({ previews })}
            />
            <SwitchRow
              title={t('settings.lowMemory.title')}
              description={t('settings.lowMemory.description')}
              help={SETTINGS_HELP.lowMemory}
              checked={settings.low_memory}
              onChange={(lowMemory) => save.mutate({ low_memory: lowMemory })}
            />
            <SwitchRow
              title={t('engines.localAi.launch.settings.title')}
              description={t('engines.localAi.launch.settings.description')}
              help={SETTINGS_HELP.localAi}
              checked={!localAiOptOut}
              onChange={(offered) => setLocalAiOptOut(!offered)}
            />
            <HfTokenField />
            <BraveKeyField />
            <ChatVoiceField />
            <ShortcutList />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
