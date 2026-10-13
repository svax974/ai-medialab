/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Public shape of `GET/PUT /api/settings` (the Hugging Face token is never returned, only `has_hf_token`). */
export interface Settings {
  /** Minutes before the idle model is unloaded; -1 never, 0 after each generation. */
  keep_alive_minutes: number
  previews: boolean
  low_memory: boolean
  has_hf_token: boolean
  /** `model_id` -> quantization bits (edited by the models dialog). */
  quantize: Record<string, number | null>
  /** `model_id` -> chosen quantization (edited by the models dialog). */
  variant: Record<string, string>
}

/** Body of `PUT /api/settings`: any subset; `hf_token: ''` removes the token. */
export type SettingsPatch = Partial<Omit<Settings, 'has_hf_token'>> & { hf_token?: string }
