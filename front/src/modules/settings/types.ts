/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Public shape of `GET/PUT /api/settings` (the Hugging Face token and the Brave key are never returned, only `has_hf_token` and `has_brave_api_key`). */
export interface Settings {
  /** Minutes before the idle model is unloaded; -1 never, 0 after each generation. */
  keep_alive_minutes: number
  previews: boolean
  low_memory: boolean
  has_hf_token: boolean
  /** A Brave Search key is saved (the chat's web search uses Brave instead of DuckDuckGo). Never returned itself. */
  has_brave_api_key: boolean
  /** `model_id` -> quantization bits (edited by the models dialog). */
  quantize: Record<string, number | null>
  /** `model_id` -> chosen quantization (edited by the models dialog). */
  variant: Record<string, string>
}

/** Body of `PUT /api/settings`: any subset; `hf_token: ''` and `brave_api_key: ''` remove the key. */
export type SettingsPatch = Partial<Omit<Settings, 'has_hf_token' | 'has_brave_api_key'>> & { hf_token?: string; brave_api_key?: string }
