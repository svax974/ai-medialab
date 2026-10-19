/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { uiLanguage } from 'src/modules/i18n';

/** `Accept-Language` of the outbound web requests: the interface language first, the other one as a fallback. */
export function acceptLanguage(): string {
  return uiLanguage() === 'en' ? 'en,fr;q=0.8' : 'fr,en;q=0.8';
}
