/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { Box, MenuItem, Select } from '@mui/material'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { localeService } from '@/modules_shared/common/services/LocaleService'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { LANGUAGE_OPTIONS, SETTINGS_HELP } from '../lib/settingsConfig'
import { SectionText, SectionTitle } from './SettingsSection'

/**
 * Interface language (French or English). Same switch as the sidebar button: the target language's labels are fetched
 * first, then the choice is remembered in the browser. Without a choice, the app follows the system language.
 */
export function LanguageField() {
  const t = useT()
  const lang = useLang()
  const choose = (code: string): void => {
    void localeService.ensureLangLoaded(code).finally(() => i18n.setLang(code))
  }
  return (
    <section>
      <SectionTitle title={t('settings.language.title')} help={SETTINGS_HELP.language} />
      <Box sx={{ mb: 1.5 }}>
        <SectionText>{t('settings.language.description')}</SectionText>
      </Box>
      <Select size="small" fullWidth value={lang} onChange={(event) => choose(event.target.value)} inputProps={{ 'aria-label': t('settings.language.title') }}>
        {LANGUAGE_OPTIONS.map((option) => <MenuItem key={option.code} value={option.code}>{option.label}</MenuItem>)}
      </Select>
    </section>
  )
}
