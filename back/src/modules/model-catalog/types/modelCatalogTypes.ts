/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Shapes relayed from the engine (`engine/app/catalog.py`, `downloads.py`, `hf_search.py`). The engine owns them. */

export type ModelKind = 'image' | 'audio' | 'video' | 'llm' | 'diagram';
/** Kinds `GET /api/hf/search` accepts (the kinds of the catalog: nothing else reaches the engine). */
export const HUB_SEARCH_KINDS: readonly ModelKind[] = ['image', 'audio', 'video', 'llm'];
export type InstallState = 'installed' | 'partial' | 'missing';

export interface DownloadProgress {
  model_id: string;
  state: 'running' | 'error' | 'cancelled' | 'done';
  done: number;
  total: number;
  /** Bytes per second. */
  rate: number;
  /** Remaining seconds. */
  eta: number | null;
  error: string | null;
}

export interface ModelVariant {
  key: string;
  label: string;
  size_gb: number;
  install: InstallState;
  installed_gb: number;
  need_gb: number;
  /** Part of `need_gb` that is temporary: the full-precision source, freed once the quantized checkpoint is produced. */
  temp_gb: number;
  selected: boolean;
}

/** Capabilities of a language model: the chat checks `tools` and `vision` before offering a tool or an image. */
export interface LlmCapabilities {
  context_default: number;
  context_max: number;
  vision: boolean;
  tools: boolean;
  /** `none`: no thinking; `toggle`: when asked; `always`; `levels`: low / medium / high. */
  reasoning: 'none' | 'toggle' | 'always' | 'levels';
  moe: boolean;
  params_b: number | null;
  active_params_b: number | null;
}

/** One entry of `GET /api/models` (the capability blocks `audio`/`video`/`params` are passed through untouched). */
export interface ModelInfo {
  id: string;
  kind: ModelKind;
  name: string;
  family: string;
  description: string;
  backend: 'mlx' | 'torch' | 'sdcpp' | 'pack' | 'demo' | 'llamacpp';
  audio: { task: 'tts' | 'stt'; [key: string]: unknown } | null;
  video?: { [key: string]: unknown } | null;
  /** What a chat model can do (`engine/app/engines/base.py` `LlmCaps`); null for the other kinds. */
  llm?: LlmCapabilities | null;
  engine_pack: string | null;
  engine_name: string | null;
  engine_detail: string;
  engine_available: boolean;
  engine_reason: string | null;
  needs_engine_install: boolean;
  engine_install_size_mb: number | null;
  quantize_options: number[];
  quantize: number | null;
  precision: string;
  download_size_gb: number | null;
  license: string;
  gated: boolean;
  memory_hint: string;
  tags: string[];
  compatible: boolean;
  plan: {
    fits: boolean;
    strategy: 'full' | 'model_offload' | 'sequential' | 'none';
    note: string;
    degraded?: boolean;
    alternative?: { id: string; name: string } | null;
  };
  install: InstallState;
  installed_gb: number;
  /** Temporary part of the remaining download (see `ModelVariant.temp_gb`). */
  temp_download_gb: number;
  download: DownloadProgress | null;
  ready: boolean;
  custom: boolean;
  variants: ModelVariant[];
  variant: string;
  [key: string]: unknown;
}

export interface KindSummary {
  default_model_id: string | null;
  recommended_model_id: string | null;
  ready: boolean;
}

/** `GET /api/models`: the image models are the top level (as the engine answers), audio, video and chat are summarised. */
export interface ModelCatalog extends KindSummary {
  models: ModelInfo[];
  audio: KindSummary;
  video: KindSummary;
  llm: KindSummary;
  diagram: KindSummary;
}

export type HubFamily = 'gguf-variant' | 'sd-diffusers' | 'sdxl-lora' | 'qwen3-tts' | 'whisper-ct2' | (string & {});

export interface HubResult {
  repo: string;
  family: HubFamily;
  family_label: string;
  task: 'image' | 'tts' | 'stt' | 'video' | 'llm';
  downloads: number;
  likes: number;
  base: string;
  already: string | null;
  /** Quantizations / precisions offered by the repo (from the listing; exact sizes come from inspect). */
  precisions: string[];
  compatible: boolean;
  reason: string;
}

export interface HubOption {
  key: string;
  label: string;
  precision: string;
  size_gb: number;
  fits?: boolean;
  fit_note?: string;
  /** Size adding it downloads: this file plus the reference model's shared files not yet in the cache. */
  download_gb?: number;
}

export interface HubInspect {
  repo: string;
  family: HubFamily;
  family_label: string;
  license: string;
  notes: string[];
  template?: { id: string; name: string };
  options: HubOption[];
  compatible: boolean;
  reason: string;
}

/** Kinds « what's new » covers: the three studios and, for the chat, the language models. */
export const TRENDING_KINDS = ['image', 'audio', 'video', 'llm'] as const;
export type TrendingKind = (typeof TRENDING_KINDS)[number];

/** The variant the add flow selects by default for a new model. */
export interface TrendingOption {
  key: string | null;
  label: string | null;
  precision: string | null;
  size_gb: number | null;
  download_gb: number | null;
  fits: boolean | null;
  fit_note: string | null;
}

/** One new, successful model of `GET /api/hf/trending` (shape of the engine). */
export interface TrendingEntry {
  repo: string;
  name: string;
  author: string;
  family: HubFamily;
  family_label: string;
  task: string;
  created_at: string;
  age_days: number;
  downloads: number;
  likes: number;
  trending_score: number;
  license: string;
  license_note: 'noncommercial' | 'custom' | null;
  compatible: boolean;
  reason: string;
  options: number;
  option: TrendingOption | null;
  url: string;
}

export interface HubTrending {
  kind: TrendingKind;
  days: number;
  generated_at: number;
  cached: boolean;
  results: TrendingEntry[];
  hidden: { heavy: number; existing: number };
}

export interface TrendingQuery {
  kind: TrendingKind;
  days: number;
  limit: number;
  include_heavy: boolean;
  refresh: boolean;
}
