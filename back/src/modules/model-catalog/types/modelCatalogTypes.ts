/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/** Shapes relayed from the engine (`engine/app/catalog.py`, `downloads.py`, `hf_search.py`). The engine owns them. */

export type ModelKind = 'image' | 'audio' | 'video';
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
  selected: boolean;
}

/** One entry of `GET /api/models` (the capability blocks `audio`/`video`/`params` are passed through untouched). */
export interface ModelInfo {
  id: string;
  kind: ModelKind;
  name: string;
  family: string;
  description: string;
  backend: 'mlx' | 'torch' | 'sdcpp' | 'pack' | 'demo';
  audio: { task: 'tts' | 'stt'; [key: string]: unknown } | null;
  video?: { [key: string]: unknown } | null;
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

/** `GET /api/models`: the image models are the top level (as the engine answers), audio and video are summarised. */
export interface ModelCatalog extends KindSummary {
  models: ModelInfo[];
  audio: KindSummary;
  video: KindSummary;
}

export type HubFamily = 'gguf-variant' | 'sd-diffusers' | 'sdxl-lora' | 'qwen3-tts' | 'whisper-ct2' | (string & {});

export interface HubResult {
  repo: string;
  family: HubFamily;
  family_label: string;
  task: 'image' | 'tts' | 'stt' | 'video';
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
