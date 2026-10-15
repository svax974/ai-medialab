/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { BadRequestException } from '@nestjs/common';
import type { UpdateTarget } from '../types/updatesTypes';

/** The targets an engine update accepts (white list: nothing else reaches the engine). */
export const UPDATE_TARGETS: readonly UpdateTarget[] = ['pinned', 'latest'];

/**
 * Body of `POST /api/updates/engines/:id`: optional `{ target }`, `pinned` when it is absent (the auth layer adds its own keys to
 * the body, which are ignored). A `target` that is not on the white list is a 400.
 */
export function parseUpdateEngineBody(body: unknown): UpdateTarget {
  if (typeof body !== 'object' || body === null || !('target' in body)) return 'pinned';
  const { target } = body as { target: unknown };
  if (typeof target === 'string' && (UPDATE_TARGETS as readonly string[]).includes(target)) return target as UpdateTarget;
  throw new BadRequestException(`"target" must be one of: ${UPDATE_TARGETS.join(', ')}`);
}
