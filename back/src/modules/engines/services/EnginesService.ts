/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import type { ComponentInfo, EngineInstallState, PackInstallState, SetupPlan, SetupState } from '../types/enginesTypes';

/** Uninstalling a pack deletes a whole Python environment before the engine answers. */
const UNINSTALL_MS = 120_000;

/**
 * Installers of the inference engines, delegated to the Python engine: audio/video packs (isolated environments) and
 * stable-diffusion.cpp and llama.cpp. Installing is long and runs in the engine; the state is pushed as `engine.pack.install`,
 * `engine.engine.install` and `engine.llamacpp.install` events (not polled). The installed/installable status of each engine is part of
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

  /** llama.cpp (the chat's runtime): the progress comes as `engine.llamacpp.install` events. */
  installLlamacpp(): Promise<EngineInstallState> {
    return this.call(() => this.engine.post('/engine/v1/engines/llamacpp/install'));
  }

  cancelLlamacppInstall(): Promise<{ ok: true }> {
    return this.call(() => this.engine.delete('/engine/v1/engines/llamacpp/install'));
  }

  /** Removes llama.cpp (409 while the chat model is loaded or an install runs); the downloaded models are kept. */
  uninstallLlamacpp(): Promise<{ ok: true }> {
    return this.call(() => this.engine.delete('/engine/v1/engines/llamacpp', { timeoutMs: UNINSTALL_MS }));
  }

  /** Components (base data, engines) with their state and the installed models that need each one. `disk`: measure the space used. */
  async components(disk: boolean): Promise<ComponentInfo[]> {
    const res = await this.call<{ components: ComponentInfo[] }>(() => this.engine.get('/engine/v1/components', { query: { disk } }));
    return res.components;
  }

  /** Removes a component and the installed models that need it (409 while in use or installing). */
  removeComponent(componentId: string): Promise<{ ok: true; removed_models: { id: string; name: string; kind: string }[] }> {
    return this.call(() => this.engine.delete('/engine/v1/components/{component_id}', { params: { component_id: componentId }, timeoutMs: UNINSTALL_MS }));
  }

  /** What a model still needs to download (base data, engine, model files). */
  setupPlan(modelId: string): Promise<SetupPlan> {
    return this.call(() => this.engine.get('/engine/v1/models/{model_id}/setup-plan', { params: { model_id: modelId } }));
  }

  setupState(): Promise<SetupState> {
    return this.call(() => this.engine.get('/engine/v1/setup'));
  }

  /** Installs what the model lacks, in one run; progress comes as `engine.setup.progress` events. */
  startSetup(modelId: string): Promise<SetupState> {
    return this.call(() => this.engine.post('/engine/v1/setup/{model_id}', { params: { model_id: modelId } }));
  }

  cancelSetup(): Promise<{ ok: true }> {
    return this.call(() => this.engine.delete('/engine/v1/setup'));
  }

  private async call<T>(fn: () => Promise<unknown>): Promise<T> {
    try {
      return (await fn()) as T;
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }
}
