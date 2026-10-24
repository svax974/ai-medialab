/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Global, Module } from '@nestjs/common';
import { CommonModule } from 'src/modules_shared/common/CommonModule';
import { HEALTH_CONTRIBUTORS } from 'src/modules_shared/common/types';
import { EngineMediaController } from './controllers/EngineMediaController';
import { ENGINE_CONFIG, resolveEngineConfig } from './engineConfig';
import { EngineClient } from './services/EngineClient';
import { EmergencyStopService } from './services/EmergencyStopService';
import { EngineEventRelay } from './services/EngineEventRelay';
import { EngineHealthContributor } from './services/EngineHealthContributor';
import { EngineMediaService } from './services/EngineMediaService';

/** Client, event relay, health probe and media relay of the Python engine. See README.md. */
@Global()
@Module({
  imports: [CommonModule],
  controllers: [EngineMediaController],
  providers: [
    { provide: ENGINE_CONFIG, useFactory: () => resolveEngineConfig() },
    EngineClient,
    EmergencyStopService,
    EngineEventRelay,
    EngineHealthContributor,
    EngineMediaService,
    // One provider of this token per project (an array, so other probes can be merged here later).
    { provide: HEALTH_CONTRIBUTORS, useFactory: (engine: EngineHealthContributor) => [engine], inject: [EngineHealthContributor] },
  ],
  exports: [ENGINE_CONFIG, EngineClient, EmergencyStopService, EngineEventRelay, HEALTH_CONTRIBUTORS],
})
export class EngineModule {}
