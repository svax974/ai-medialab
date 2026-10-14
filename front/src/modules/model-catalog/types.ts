/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export type ModelKind = 'image' | 'audio' | 'video'
export type InstallState = 'installed' | 'partial' | 'missing'
export type ReferenceMode = 'none' | 'init' | 'multi'

export interface ParamSpec {
  key: string
  label: string
  type: 'int' | 'float' | 'text' | 'bool'
  default: number | string | boolean
  min: number | null
  max: number | null
  step: number | null
  help: string
  advanced: boolean
  requires_references: boolean
}

export interface VideoResolution {
  id: string
  label: string
  short_side: number
  long_side: number
}

export type VideoTask = 't2v' | 'i2v' | 'v2v'

export interface VideoCaps {
  tasks: VideoTask[]
  fps: number
  /** Frame counts are multiples of this step (plus one). */
  frame_step: number
  default_seconds: number
  min_seconds: number
  max_seconds: number
  resolutions: VideoResolution[]
  default_resolution: string
  image_input: 'none' | 'optional' | 'required'
  last_frame: boolean
  image_role: 'start' | 'reference'
  video_input: 'none' | 'optional' | 'required'
  audio_out: boolean
  english_only: boolean
  /** Non-empty: licence restriction to show prominently. */
  license_warning: string
}

export interface AudioCaps {
  task: 'tts' | 'stt'
  languages: { code: string; label: string }[]
  voices: { id: string; name: string; language: string; gender: 'f' | 'm' | 'n'; description: string }[]
  clone: 'none' | 'optional' | 'required'
  instruct: boolean
  instruct_help: string
  design: boolean
  speed: boolean
  tags: string[]
  max_chars: number
  sample_rate: number
}

export interface DownloadProgress {
  model_id: string
  state: 'running' | 'error' | 'cancelled' | 'done'
  done: number
  total: number
  /** Bytes per second. */
  rate: number
  /** Remaining seconds. */
  eta: number | null
  error: string | null
}

export interface ModelVariant {
  key: string
  label: string
  size_gb: number
  install: InstallState
  installed_gb: number
  /** Remaining download needed to use this quantization. */
  need_gb: number
  selected: boolean
}

export type Backend = 'mlx' | 'torch' | 'sdcpp' | 'pack' | 'demo'

/** One entry of `GET /api/models` (shape of the engine's `catalog.describe_models`). */
export interface ModelInfo {
  id: string
  kind: ModelKind
  audio: AudioCaps | null
  video?: VideoCaps | null
  engine_pack: string | null
  engine_name: string | null
  /** What installing the engine brings, in one sentence. */
  engine_detail: string
  name: string
  family: string
  description: string
  reference_mode: ReferenceMode
  max_references: number
  requires_references: boolean
  text_to_image: boolean
  params: ParamSpec[]
  size_multiple: number
  min_side: number
  max_side: number
  default_megapixels: number
  quantize_options: number[]
  default_quantize: number | null
  quantize: number | null
  hf_repo: string | null
  download_size_gb: number | null
  license: string
  /** Hugging Face files that need an account: licence accepted on the hub and a token saved in the settings. */
  gated: boolean
  memory_hint: string
  tags: string[]
  backend: Backend
  engine_available: boolean
  engine_reason: string | null
  compatible: boolean
  plan: {
    fits: boolean
    strategy: 'full' | 'model_offload' | 'sequential' | 'none'
    note: string
    /** Works, but only on the CPU here: very slow. */
    degraded?: boolean
    /** Same model on an engine that does use this machine's GPU, when one exists. */
    alternative?: { id: string; name: string } | null
  }
  install: InstallState
  installed_gb: number
  download: DownloadProgress | null
  /** Ready to generate: installed, engine available and compatible. */
  ready: boolean
  needs_engine_install: boolean
  engine_install_size_mb: number | null
  /** Weight precision ("Q4_K", "bf16", "8 bits"...), empty if unknown. */
  precision: string
  /** Model added from Hugging Face by the user. */
  custom: boolean
  variants: ModelVariant[]
  variant: string
}

export interface KindSummary {
  default_model_id: string | null
  recommended_model_id: string | null
  ready: boolean
}

/** `GET /api/models`: the image summary is the top level (as the engine answers); audio and video are nested. */
export interface ModelCatalog extends KindSummary {
  models: ModelInfo[]
  audio: KindSummary
  video: KindSummary
}

export type HubFamily = 'gguf-variant' | 'sd-diffusers' | 'sdxl-lora' | 'qwen3-tts' | 'whisper-ct2' | (string & {})
export type HubTask = 'image' | 'tts' | 'stt' | 'video'

export interface HubResult {
  repo: string
  family: HubFamily
  family_label: string
  task: HubTask
  downloads: number
  likes: number
  base: string
  /** Id of the model already in the list, if any. */
  already: string | null
  /** Quantizations / precisions offered by the repo (from the listing; exact sizes come from inspect). */
  precisions: string[]
  /** Whether this machine can run (or install the engine for) the model; `reason` says why not. */
  compatible: boolean
  reason: string
}

export interface HubOption {
  key: string
  label: string
  precision: string
  size_gb: number
  /** Whether this machine has the memory for this variant (absent when the repo layout gave no verdict). */
  fits?: boolean
  /** Why not, or a speed warning (part of the model stays in RAM...). */
  fit_note?: string
  /** Size adding it downloads: this file plus the reference model's shared files not yet in the cache. */
  download_gb?: number
}

export interface HubInspect {
  repo: string
  family: HubFamily
  family_label: string
  license: string
  notes: string[]
  template?: { id: string; name: string }
  options: HubOption[]
  compatible: boolean
  reason: string
}
