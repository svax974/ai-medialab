/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { NextFunction, Request, Response } from 'express';
import { noteUiLanguage } from './uiLanguage';

/** Reads `Accept-Language` on every request (the front sends the language chosen in the settings). */
export function uiLanguageMiddleware(req: Request, _res: Response, next: NextFunction): void {
  noteUiLanguage(req.headers['accept-language']);
  next();
}
