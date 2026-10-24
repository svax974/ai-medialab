/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Optional } from '@nestjs/common';
import { EmergencyStopService, EngineClient, engineErrorToHttp } from 'src/modules/engine';
import type { EmergencyStopResult, EngineStatus, MemoryLive, SystemInfo } from '../types/hardwareTypes';

/**
 * Hardware and engine state, delegated to the Python engine through the typed client (the detection, the loaded model
 * and the unloading all live in the engine). Failures become HTTP errors: the engine's own status and message are
 * relayed, an unreachable engine is a 502.
 */
@Injectable()
export class HardwareService {
  constructor(
    private readonly engine: EngineClient,
    @Optional() private readonly emergency?: EmergencyStopService,
  ) {}

  /** Machine description; `refresh` forces a new detection (the engine caches it). */
  async system(refresh = false): Promise<SystemInfo> {
    return this.call<SystemInfo>(() => this.engine.get('/engine/v1/system', { query: refresh ? { refresh: true } : undefined }));
  }

  async status(): Promise<EngineStatus> {
    return this.call<EngineStatus>(() => this.engine.get('/engine/v1/status'));
  }

  /** Memory of the machine and of the models, now (the browser then follows the `engine.memory.sample` events). */
  async memory(): Promise<MemoryLive> {
    return this.call<MemoryLive>(() => this.engine.get('/engine/v1/memory'));
  }

  /**
   * The red button: the queues of the application empty their waiting line first (so that nothing starts again), then the engine
   * kills the generation worker and the chat and OCR servers and cancels its own queue.
   */
  async emergencyStop(): Promise<EmergencyStopResult> {
    await this.emergency?.announce();
    return this.call<EmergencyStopResult>(() => this.engine.post('/engine/v1/engine/emergency-stop'));
  }

  /** Unloads the loaded model; the engine answers 409 while a generation runs. */
  async unload(): Promise<EngineStatus> {
    return this.call<EngineStatus>(() => this.engine.post('/engine/v1/engine/unload'));
  }

  private async call<T>(fn: () => Promise<unknown>): Promise<T> {
    try {
      return (await fn()) as T;
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }
}
