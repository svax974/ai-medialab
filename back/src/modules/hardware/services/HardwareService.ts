/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import type { EngineStatus, SystemInfo } from '../types/hardwareTypes';

/**
 * Hardware and engine state, delegated to the Python engine through the typed client (the detection, the loaded model
 * and the unloading all live in the engine). Failures become HTTP errors: the engine's own status and message are
 * relayed, an unreachable engine is a 502.
 */
@Injectable()
export class HardwareService {
  constructor(private readonly engine: EngineClient) {}

  /** Machine description; `refresh` forces a new detection (the engine caches it). */
  async system(refresh = false): Promise<SystemInfo> {
    return this.call<SystemInfo>(() => this.engine.get('/engine/v1/system', { query: refresh ? { refresh: true } : undefined }));
  }

  async status(): Promise<EngineStatus> {
    return this.call<EngineStatus>(() => this.engine.get('/engine/v1/status'));
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
