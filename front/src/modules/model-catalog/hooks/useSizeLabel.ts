/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { formatGb } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { modelSize } from '../lib/catalogFormat'

/** Localised size label (`650 Mo`, `4,5 Go`); empty when unknown. */
export function useSizeLabel(): (gb: number | null | undefined) => string {
  const t = useT()
  const lang = useLang()
  return (gb) => {
    const size = modelSize(gb)
    return size ? t(size.unit === 'mb' ? 'models.size.mb' : 'models.size.gb', [size.unit === 'mb' ? String(size.value) : formatGb(size.value, lang)]) : ''
  }
}
