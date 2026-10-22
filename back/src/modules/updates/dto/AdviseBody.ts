/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { BadRequestException } from '@nestjs/common';
import type { AdviseBody, UpdateItemKind, UpdateTarget } from '../types/updatesTypes';
import { UPDATE_TARGETS } from './UpdateEngineBody';
import { tr } from 'src/modules/i18n';

export const ADVISE_KINDS: readonly UpdateItemKind[] = ['engine', 'model'];
/** What an engine or a model id looks like (a slug: letters, digits, `.`, `_`, `-`, `:`). */
const ID_PATTERN = /^[\w.:-]{1,160}$/;

/**
 * Body of `POST /api/updates/advise`: `{ kind, id, target? }`, everything checked here (the auth layer adds its own keys, ignored).
 * `target` is `pinned` when absent. Anything else is a 400 and nothing reaches the engine.
 */
export function parseAdviseBody(body: unknown): AdviseBody {
  if (typeof body !== 'object' || body === null) throw new BadRequestException(tr('updates.error.bodyExpected'));
  const { kind, id, target } = body as Record<string, unknown>;
  if (typeof kind !== 'string' || !(ADVISE_KINDS as readonly string[]).includes(kind)) {
    throw new BadRequestException(tr('updates.error.oneOf', ['kind', ADVISE_KINDS.join(', ')]));
  }
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new BadRequestException(tr('updates.error.idExpected'));
  if (target !== undefined && (typeof target !== 'string' || !(UPDATE_TARGETS as readonly string[]).includes(target))) {
    throw new BadRequestException(tr('updates.error.oneOf', ['target', UPDATE_TARGETS.join(', ')]));
  }
  return { kind: kind as UpdateItemKind, id, target: (target as UpdateTarget | undefined) ?? 'pinned' };
}
