/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import type { HealthContribution, HealthContributor } from 'src/modules_shared/common/types';
import { EngineClient } from './EngineClient';
import { EngineEventRelay } from './EngineEventRelay';

/**
 * `GET /api/v1/health` -> `checks.engine`: probes `/engine/v1/status` (open route). An unreachable engine is
 * `degraded`, not `down`: the server and the UI still work, only generation does not (the desktop shell supervises
 * the engine process itself).
 */
@Injectable()
export class EngineHealthContributor implements HealthContributor {
  readonly key = 'engine';

  constructor(
    private readonly client: EngineClient,
    private readonly relay: EngineEventRelay,
  ) {}

  async check(): Promise<HealthContribution> {
    try {
      const status = await this.client.get('/engine/v1/status', { timeoutMs: 2_000 });
      return { status: 'ok', events: this.relay.connected, engine: status };
    } catch (err) {
      return { status: 'degraded', events: this.relay.connected, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
