/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { ConflictException, Injectable } from '@nestjs/common';
import { EngineClient, engineErrorToHttp } from 'src/modules/engine';
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { UpdateAdvisoryService } from './UpdateAdvisoryService';
import type { AdviseBody, EngineAdvice, UpdateAdvisory, UpdateStarted, UpdatesReport, UpdateTarget } from '../types/updatesTypes';
import { tr } from 'src/modules/i18n';

/** The check reads the Hugging Face and GitHub APIs for every installed model and engine. */
const CHECK_MS = 120_000;
/** An analysis loads a model, reads the sources and runs it twice: about a minute, a few on a slow disk. */
const ADVICE_MS = 360_000;
/** Owner of the engine gauge (`EngineBusyGate`) while an analysis runs: the model of the adviser is in memory. */
const GATE_OWNER = 'update-advice';

/**
 * Update checks, delegated to the Python engine (it knows what is installed and how to compare it). An update is the
 * engine's own installer run again: model downloads and engine installs report through their usual events
 * (`engine.download.progress`, `engine.engine.install`, `engine.pack.install`), nothing is polled. Nothing happens
 * without a request: no automatic update.
 */
@Injectable()
export class UpdatesService {
  constructor(
    private readonly engine: EngineClient,
    private readonly advisories: UpdateAdvisoryService,
    private readonly gate: EngineBusyGate,
    private readonly queue: GenerationQueueService,
  ) {}

  /** The check, with the stored advice about each update merged into its row. */
  async check(): Promise<UpdatesReport> {
    const report = await this.call<UpdatesReport>(() => this.engine.get('/engine/v1/updates/check', { timeoutMs: CHECK_MS }));
    return this.advisories.merge(report);
  }

  /** Every stored advice, newest first (shown before, or without, a check). */
  listAdvisories(): Promise<UpdateAdvisory[]> {
    return this.advisories.list();
  }

  removeAdvisory(id: string): Promise<void> {
    return this.advisories.remove(id);
  }

  /**
   * Has the local model read the public sources about one update and list the problems reported, then keeps the answer.
   * One at a time, and never while a generation or a chat reply holds the engine (409 `busy`); the engine's own refusals
   * (`no_engine`, `no_model`, `nothing_to_analyse`, `unsupported`) come through with their `code`. The advice is information:
   * nothing is blocked by it.
   */
  async advise(body: AdviseBody): Promise<UpdateAdvisory> {
    if (this.queue.occupied) throw new ConflictException({ code: 'busy', message: tr('updates.error.busyGeneration') });
    if (!this.gate.tryAcquire(GATE_OWNER)) {
      throw new ConflictException({ code: 'busy', message: tr(this.gate.heldBy === GATE_OWNER ? 'updates.error.busyAnalysis' : 'updates.error.busyReply') });
    }
    try {
      const advice = await this.call<EngineAdvice>(() => this.engine.post('/engine/v1/updates/advice', { body, timeoutMs: ADVICE_MS }));
      return await this.advisories.save(advice);
    } finally {
      this.gate.release(GATE_OWNER);
    }
  }

  /** Downloads again the files of a model that changed on the Hub; 409 when it is up to date, loaded or busy. */
  updateModel(modelId: string): Promise<UpdateStarted> {
    return this.call(() => this.engine.post('/engine/v1/updates/models/{model_id}', { params: { model_id: modelId }, timeoutMs: CHECK_MS }));
  }

  /**
   * Installs an engine again (`sdcpp`, `audiocpp` or a pack id). `pinned`: the release the application was tested with; `latest`:
   * the newest upstream one (untested, stable-diffusion.cpp and audio.cpp only). 409 when there is nothing to install, the engine is in use or busy.
   */
  updateEngine(engineId: string, target: UpdateTarget = 'pinned'): Promise<UpdateStarted> {
    return this.call(() =>
      this.engine.post('/engine/v1/updates/engines/{engine_id}', { params: { engine_id: engineId }, query: { target }, timeoutMs: CHECK_MS }),
    );
  }

  private async call<T>(fn: () => Promise<unknown>): Promise<T> {
    try {
      return (await fn()) as T;
    } catch (error) {
      throw engineErrorToHttp(error);
    }
  }
}
