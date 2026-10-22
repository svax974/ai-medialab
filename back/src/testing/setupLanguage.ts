/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

// Jest setup: the server's messages follow the interface language (src/modules/i18n); the specs read them in French, as
// the code's original texts, unless one asks for another language.
import { resetUiLanguage } from '../modules/i18n/uiLanguage';

resetUiLanguage('fr');
