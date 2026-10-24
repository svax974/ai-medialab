/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** The studio settings as the engine and the (legacy) UI know them: snake_case keys. */
export interface StudioSettings {
  /** Minutes before the idle model is unloaded; -1 never, 0 after each generation. */
  keep_alive_minutes: number;
  previews: boolean;
  low_memory: boolean;
  /** Ceiling (GB) for the models loaded together; 0 = automatic (80 % of the machine's memory). */
  memory_limit_gb: number;
  /** `model_id` -> quantization bits (null = full precision). */
  quantize: Record<string, number | null>;
  /** `model_id` -> chosen quantization (a variant key). */
  variant: Record<string, string>;
  /** Hugging Face token; empty = none. Never leaves the server. */
  hf_token: string;
  /** Brave Search API key of the chat's web search (DuckDuckGo is used without it); empty = none. Never leaves Nest. */
  brave_api_key: string;
  /** Id of the library voice the chat's audio tool speaks with when none is named; empty = none. Never leaves Nest. */
  chat_voice_id: string;
}

/** Public shape of `GET/PUT /api/settings`: the secrets are replaced by `has_hf_token` and `has_brave_api_key`. */
export type PublicSettings = Omit<StudioSettings, 'hf_token' | 'brave_api_key'> & { has_hf_token: boolean; has_brave_api_key: boolean };

/** What the engine receives: the studio settings without what only Nest uses (the Brave key, the chat's default voice). */
export type EngineSettings = Omit<StudioSettings, 'brave_api_key' | 'chat_voice_id'>;

/** Body of `PUT /api/settings`: any subset. `hf_token: ''` removes the token. Maps are merged into the stored ones. */
export type SettingsPatch = Partial<StudioSettings>;
