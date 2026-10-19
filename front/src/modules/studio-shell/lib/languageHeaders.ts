/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { i18n } from '@/modules_shared/common/core/i18n/I18n'

/** Header naming the interface language, for the `fetch` calls (the `HttpService` ones get it from `registerModuleLocales`). */
export function languageHeaders(): Record<string, string> {
  const lang = i18n.getLang()
  return lang ? { 'Accept-Language': lang } : {}
}
