/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/** The studio settings as the engine and the (legacy) UI know them: snake_case keys. */
export interface StudioSettings {
  /** Minutes before the idle model is unloaded; -1 never, 0 after each generation. */
  keep_alive_minutes: number;
  previews: boolean;
  low_memory: boolean;
  /** `model_id` -> quantization bits (null = full precision). */
  quantize: Record<string, number | null>;
  /** `model_id` -> chosen quantization (a variant key). */
  variant: Record<string, string>;
  /** Hugging Face token; empty = none. Never leaves the server. */
  hf_token: string;
}

/** Public shape of `GET/PUT /api/settings`: the token is replaced by `has_hf_token`. */
export type PublicSettings = Omit<StudioSettings, 'hf_token'> & { has_hf_token: boolean };

/** Body of `PUT /api/settings`: any subset. `hf_token: ''` removes the token. Maps are merged into the stored ones. */
export type SettingsPatch = Partial<StudioSettings>;
