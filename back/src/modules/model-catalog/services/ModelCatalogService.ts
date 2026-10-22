/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import type { DownloadProgress, HubInspect, HubResult, HubTrending, ModelCatalog, TrendingQuery } from '../types/modelCatalogTypes';

/** Deleting a large model waits for the files to be gone; a Hugging Face call goes over the network. */
const SLOW_CALL_MS = 120_000;

/**
 * Model catalogue, downloads and Hugging Face search, delegated to the Python engine (it owns the registry, the memory
 * fit and the downloads). Failures become HTTP errors: the engine's status and message are relayed, an unreachable
 * engine is a 502. Progress is not polled: `download.progress` and `models.changed` reach the browser through the
 * event relay (`engine.download.progress`, `engine.models.changed`).
 */
@Injectable()
export class ModelCatalogService {
  constructor(private readonly engine: EngineClient) {}

  catalog(): Promise<ModelCatalog> {
    return this.call(() => this.engine.get('/engine/v1/models'));
  }

  startDownload(modelId: string): Promise<DownloadProgress> {
    return this.call(() => this.engine.post('/engine/v1/models/{model_id}/download', { params: { model_id: modelId } }));
  }

  async cancelDownload(modelId: string): Promise<{ ok: true }> {
    return this.call(() => this.engine.delete('/engine/v1/models/{model_id}/download', { params: { model_id: modelId } }));
  }

  /** Deletes the files (409 while the model is loaded); answers `{ freed_gb, also_affects }`. */
  deleteModel(modelId: string): Promise<{ freed_gb: number; also_affects: string[] }> {
    return this.call(() => this.engine.delete('/engine/v1/models/{model_id}', { params: { model_id: modelId }, timeoutMs: SLOW_CALL_MS }));
  }

  /** Deletes the full-precision source once a locally quantized variant is installed from it; answers `{ freed_gb }`. */
  freeBf16Source(modelId: string): Promise<{ freed_gb: number }> {
    return this.call(() => this.engine.delete('/engine/v1/models/{model_id}/source/bf16', { params: { model_id: modelId }, timeoutMs: SLOW_CALL_MS }));
  }

  /** Adds a Hugging Face repository to the list; answers the new `model_id`. */
  addCustom(repo: string, option: string): Promise<{ model_id: string }> {
    return this.call(() => this.engine.post('/engine/v1/models/custom', { body: { repo, option }, timeoutMs: SLOW_CALL_MS }));
  }

  /** Removes a user-added model and its files; answers `{ freed_gb }`. */
  removeCustom(modelId: string): Promise<{ freed_gb: number }> {
    return this.call(() => this.engine.delete('/engine/v1/models/{model_id}/custom', { params: { model_id: modelId }, timeoutMs: SLOW_CALL_MS }));
  }

  async searchHub(kind: string, q: string): Promise<{ results: HubResult[] }> {
    return this.call(() => this.engine.get('/engine/v1/hf/search', { query: { kind, q }, timeoutMs: SLOW_CALL_MS }));
  }

  inspectHub(repo: string): Promise<HubInspect> {
    return this.call(() => this.engine.get('/engine/v1/hf/inspect', { query: { repo }, timeoutMs: SLOW_CALL_MS }));
  }

  /** New, successful models of a kind that this machine can run (already validated by the controller). */
  trendingHub(query: TrendingQuery): Promise<HubTrending> {
    return this.call(() => this.engine.get('/engine/v1/hf/trending', { query, timeoutMs: SLOW_CALL_MS }));
  }

  private async call<T>(fn: () => Promise<unknown>): Promise<T> {
    try {
      return (await fn()) as T;
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }
}
