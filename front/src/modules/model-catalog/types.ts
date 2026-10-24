/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** What a model produces: pictures, speech/transcription, clips, or text (chat, run by llama.cpp). */
export type ModelKind = 'image' | 'audio' | 'video' | 'llm' | 'diagram' | 'ocr'
export type InstallState = 'installed' | 'partial' | 'missing'
export type ReferenceMode = 'none' | 'init' | 'multi' | 'face'

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
  /** Set: a clip longer than this is made of chained runs of this length (each starts from the last frame of the previous). */
  segment_seconds?: number | null
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

/** Thinking support of a chat model: none, a switch, always on, or low/medium/high levels. */
export type LlmReasoning = 'none' | 'toggle' | 'always' | 'levels'

/** What the chat can offer for a language model (`ModelInfo.llm`, from the engine's `LlmCaps`). */
export interface LlmCaps {
  /** Tokens of context a chat opens with (the cache is paid for up front). */
  context_default: number
  context_max: number
  vision: boolean
  tools: boolean
  reasoning: LlmReasoning
  moe: boolean
  params_b: number | null
  active_params_b: number | null
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
  /** Part of `need_gb` that is temporary: the full-precision source, freed once the quantized checkpoint is produced. */
  temp_gb: number
  selected: boolean
}

export type Backend = 'mlx' | 'torch' | 'sdcpp' | 'llamacpp' | 'pack' | 'demo'

/** One entry of `GET /api/models` (shape of the engine's `catalog.describe_models`). */
export interface ModelInfo {
  id: string
  kind: ModelKind
  audio: AudioCaps | null
  video?: VideoCaps | null
  llm?: LlmCaps | null
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
  /** Temporary part of the remaining download (see `ModelVariant.temp_gb`). */
  temp_download_gb: number
  download: DownloadProgress | null
  /** Ready to generate: installed, engine available and compatible. */
  ready: boolean
  needs_engine_install: boolean
  /** The engine is installed but too old for this model: `needs_engine_install` then means "update". */
  engine_outdated: boolean
  engine_install_size_mb: number | null
  /** Weight precision ("Q4_K", "bf16", "8 bits"...), empty if unknown. */
  precision: string
  /** Model added from Hugging Face by the user. */
  custom: boolean
  /** What an OCR model offers (`engine/app/engines/base.py` `OcrCaps`); null for the other kinds. */
  ocr?: OcrCapabilities | null
  variants: ModelVariant[]
  variant: string
}

/** What an OCR model offers: its tasks, and an honest card of strengths and limits. */
export interface OcrCapabilities {
  /** Task id (`text`, `markdown`, `table`, `formula`, `chart`) -> the prompt the model was trained on (empty: the image alone). */
  tasks: Record<string, string>
  default_task: string
  /** Follows any instruction (the `custom` task). */
  free_prompt: boolean
  languages: string
  strengths: string[]
  weaknesses: string[]
  max_tokens: number
}

export interface KindSummary {
  default_model_id: string | null
  recommended_model_id: string | null
  ready: boolean
}

/** `GET /api/models`: the image summary is the top level (as the engine answers); audio, video and llm are nested. */
export interface ModelCatalog extends KindSummary {
  models: ModelInfo[]
  audio: KindSummary
  video: KindSummary
  llm?: KindSummary
  diagram?: KindSummary
  ocr?: KindSummary
}

export type HubFamily = 'gguf-variant' | 'sd-diffusers' | 'sdxl-lora' | 'qwen3-tts' | 'whisper-ct2' | (string & {})
export type HubTask = 'image' | 'tts' | 'stt' | 'video' | 'llm' | 'ocr'

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

/** What « What's new » covers: the three studios and, for the chat, the language models. */
export type TrendingKind = ModelKind

/** The variant the add flow selects by default for a new model. */
export interface TrendingOption {
  key: string | null
  label: string | null
  precision: string | null
  size_gb: number | null
  /** What adding it downloads: the file plus the shared files of the reference model still missing. */
  download_gb: number | null
  fits: boolean | null
  fit_note: string | null
}

/** One new, successful model (`GET /api/hf/trending`). */
export interface TrendingEntry {
  repo: string
  name: string
  author: string
  family: HubFamily
  family_label: string
  task: string
  created_at: string
  age_days: number
  /** Downloads of the last 30 days. */
  downloads: number
  likes: number
  trending_score: number
  license: string
  /** `noncommercial` or `custom` when the licence is not a plain open one. */
  license_note: 'noncommercial' | 'custom' | null
  /** The proposed variant fits this machine and its engine is usable. */
  compatible: boolean
  reason: string
  options: number
  option: TrendingOption | null
  url: string
}

export interface HubTrending {
  kind: TrendingKind
  days: number
  /** When the engine computed the list (epoch seconds); it keeps it for an hour. */
  generated_at: number
  cached: boolean
  results: TrendingEntry[]
  /** Left out of `results`: too heavy for this machine (when not asked for), already in the catalog. */
  hidden: { heavy: number; existing: number }
}
