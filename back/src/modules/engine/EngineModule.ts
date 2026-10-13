/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Global, Module } from '@nestjs/common';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { HEALTH_CONTRIBUTORS } from 'src/modules_shared/common/types';
import { EngineProxyController } from './controllers/EngineProxyController';
import { ENGINE_CONFIG, resolveEngineConfig } from './engineConfig';
import { EngineClient } from './services/EngineClient';
import { EngineEventRelay } from './services/EngineEventRelay';
import { EngineHealthContributor } from './services/EngineHealthContributor';
import { EngineProxyService } from './services/EngineProxyService';

/** Client, event relay, health probe and (transitional) `/api/*` proxy of the Python engine. See README.md. */
@Global()
@Module({
  imports: [CommonModule],
  controllers: [EngineProxyController],
  providers: [
    { provide: ENGINE_CONFIG, useFactory: () => resolveEngineConfig() },
    EngineClient,
    EngineEventRelay,
    EngineHealthContributor,
    EngineProxyService,
    // One provider of this token per project (an array, so other probes can be merged here later).
    { provide: HEALTH_CONTRIBUTORS, useFactory: (engine: EngineHealthContributor) => [engine], inject: [EngineHealthContributor] },
  ],
  exports: [ENGINE_CONFIG, EngineClient, EngineEventRelay, HEALTH_CONTRIBUTORS],
})
export class EngineModule {}
