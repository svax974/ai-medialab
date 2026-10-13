/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import type { EngineInstallState, PackInstallState } from '../types/enginesTypes';

/** Uninstalling a pack deletes a whole Python environment before the engine answers. */
const UNINSTALL_MS = 120_000;

/**
 * Installers of the inference engines, delegated to the Python engine: audio/video packs (isolated environments) and
 * stable-diffusion.cpp. Installing is long and runs in the engine; the state is pushed as `engine.pack.install` and
 * `engine.engine.install` events (not polled). The installed/installable status of each engine is part of
 * `GET /api/system` (module `hardware`).
 */
@Injectable()
export class EnginesService {
  constructor(private readonly engine: EngineClient) {}

  installPack(packId: string): Promise<PackInstallState> {
    return this.call(() => this.engine.post('/engine/v1/engines/pack/{pack_id}/install', { params: { pack_id: packId } }));
  }

  cancelPackInstall(): Promise<{ ok: true }> {
    return this.call(() => this.engine.delete('/engine/v1/engines/pack/install'));
  }

  /** Deletes the pack's environment (409 when its model is loaded); the downloaded models are kept. */
  uninstallPack(packId: string): Promise<{ ok: true }> {
    return this.call(() => this.engine.delete('/engine/v1/engines/pack/{pack_id}', { params: { pack_id: packId }, timeoutMs: UNINSTALL_MS }));
  }

  installSdcpp(): Promise<EngineInstallState> {
    return this.call(() => this.engine.post('/engine/v1/engines/sdcpp/install'));
  }

  cancelSdcppInstall(): Promise<{ ok: true }> {
    return this.call(() => this.engine.delete('/engine/v1/engines/sdcpp/install'));
  }

  private async call<T>(fn: () => Promise<unknown>): Promise<T> {
    try {
      return (await fn()) as T;
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }
}
