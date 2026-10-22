/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { useI18nVersion } from '@/modules_shared/common/hooks/useI18nVersion'

/** Translate with the current language and re-render on language switch. No fallback: a missing key shows as itself. */
export function useT(): (key: string, params?: (string | number)[]) => string {
  const version = useI18nVersion()
  // `version` changes on language switch: it makes the returned function (and its consumers) update.
  return useCallback((key, params) => i18n.get(key, params), [version]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Current language code (`fr`, `en`), for `Intl` formatting; updates on language switch. */
export function useLang(): string {
  useI18nVersion()
  return i18n.getLang() || 'fr'
}
