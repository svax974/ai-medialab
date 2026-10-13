/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { randomBytes } from 'crypto';

/** Time-sortable id: 11 hex digits of the millisecond timestamp + 10 random hex digits (same format as the legacy `new_id`). */
export function newId(now: number = Date.now()): string {
  return `${now.toString(16).padStart(11, '0')}${randomBytes(5).toString('hex')}`;
}

/** Current time as epoch seconds (float), the unit of every timestamp column of the studio tables. */
export function nowSeconds(): number {
  return Date.now() / 1000;
}
