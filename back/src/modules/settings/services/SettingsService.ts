/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable, Logger } from '@nestjs/common';
import { ModuleConfigService } from 'src/modules_shared/common/CommonModule';
import { ConfigurationService } from 'src/modules_shared/common/services/ConfigurationService';
import { EngineClient, EngineUnavailableError, engineErrorToHttp } from 'src/modules/engine';
import { SETTINGS_MODULE_ID } from '../configSchema';
import type { EngineSettings, PublicSettings, SettingsPatch, StudioSettings } from '../types/settingsTypes';
import { DEFAULT_SETTINGS, applyPatch, toPublic } from './settingsPatch';

const TOKEN_KEY = 'studio_hfToken';
const BRAVE_KEY = 'studio_braveApiKey';

const isNumberMap = (v: unknown): v is Record<string, number | null> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => x === null || typeof x === 'number');
const isStringMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');

/**
 * Source of truth of the studio settings (module config `studio_*`). Every change is validated by the engine (it
 * knows the models) and pushed to it before being stored; the engine also gets the whole state at startup and each
 * time its event stream reconnects (`SettingsEngineSync`). Calls are serialised so that two writes never interleave.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly moduleConfig: ModuleConfigService,
    private readonly configuration: ConfigurationService,
    private readonly engine: EngineClient,
  ) {}

  /** Public settings (never the token). */
  async getPublic(): Promise<PublicSettings> {
    return toPublic(await this.read());
  }

  /**
   * Applies a validated patch. The engine's refusal (422 unknown quantization, 409 generation running) is relayed and
   * nothing is stored. An unreachable engine is not an error: the values are stored and pushed when it connects.
   */
  update(patch: SettingsPatch): Promise<PublicSettings> {
    return this.serial(async () => {
      const current = await this.read();
      const next = applyPatch(current, patch);
      try {
        await this.push(next);
      } catch (error) {
        if (!(error instanceof EngineUnavailableError)) throw engineErrorToHttp(error);
        this.logger.warn('Engine unreachable: settings stored, they will be sent when it connects.');
      }
      await this.persist(current, next);
      return toPublic(next);
    });
  }

  /** Sends the stored settings to the engine; failures are logged, never thrown. Returns true when the engine accepted them. */
  pushToEngine(): Promise<boolean> {
    return this.serial(async () => {
      try {
        await this.push(await this.read());
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Settings not sent to the engine: ${reason}`);
        return false;
      }
    });
  }

  /** Reads the stored values (defaults for anything missing or of the wrong type). */
  async read(): Promise<StudioSettings> {
    await this.configuration.getConfiguration();
    const cfg = await this.moduleConfig.getModuleConfigWithValues(SETTINGS_MODULE_ID);
    const v = cfg?.currentValues ?? {};
    const d = DEFAULT_SETTINGS;
    return {
      keep_alive_minutes: typeof v.studio_keepAliveMinutes === 'number' ? v.studio_keepAliveMinutes : d.keep_alive_minutes,
      previews: typeof v.studio_previews === 'boolean' ? v.studio_previews : d.previews,
      low_memory: typeof v.studio_lowMemory === 'boolean' ? v.studio_lowMemory : d.low_memory,
      quantize: isNumberMap(v.studio_quantize) ? v.studio_quantize : {},
      variant: isStringMap(v.studio_variant) ? v.studio_variant : {},
      hf_token: this.moduleConfig.getDecryptedSecretValue(SETTINGS_MODULE_ID, TOKEN_KEY) ?? '',
      brave_api_key: this.moduleConfig.getDecryptedSecretValue(SETTINGS_MODULE_ID, BRAVE_KEY) ?? '',
    };
  }

  /** The Brave Search key for the chat's web search tool ('' when none). Server side only: never sent to a browser. */
  async braveApiKey(): Promise<string> {
    await this.configuration.getConfiguration();
    return this.moduleConfig.getDecryptedSecretValue(SETTINGS_MODULE_ID, BRAVE_KEY) ?? '';
  }

  /** The engine gets everything but the Brave key (it has no use for it). */
  private push(settings: StudioSettings): Promise<unknown> {
    const { brave_api_key: _brave, ...forEngine } = settings;
    return this.engine.put('/engine/v1/runtime/settings', { body: forEngine satisfies EngineSettings });
  }

  private async persist(current: StudioSettings, next: StudioSettings): Promise<void> {
    await this.moduleConfig.updateModuleConfig(SETTINGS_MODULE_ID, {
      studio_keepAliveMinutes: next.keep_alive_minutes,
      studio_previews: next.previews,
      studio_lowMemory: next.low_memory,
      studio_quantize: next.quantize,
      studio_variant: next.variant,
      // An empty secret is skipped by updateModuleConfig (it keeps the stored one): removal is written below.
      ...(next.hf_token ? { [TOKEN_KEY]: next.hf_token } : {}),
      ...(next.brave_api_key ? { [BRAVE_KEY]: next.brave_api_key } : {}),
    });
    if (!next.hf_token && current.hf_token) {
      await this.configuration.updateAll([{ name: TOKEN_KEY, value: '', description: '' }]);
    }
    if (!next.brave_api_key && current.brave_api_key) {
      await this.configuration.updateAll([{ name: BRAVE_KEY, value: '', description: '' }]);
    }
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
