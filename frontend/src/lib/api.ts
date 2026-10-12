// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// Types and calls for the backend API.

export type ReferenceMode = "none" | "init" | "multi";

export interface ParamSpec {
  key: string;
  label: string;
  type: "int" | "float" | "text" | "bool";
  default: number | string | boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  help: string;
  advanced: boolean;
  requires_references: boolean;
}

export type ModelKind = "image" | "audio" | "video";

export interface VideoResolution {
  id: string;
  label: string;
  short_side: number;
  long_side: number;
}

export interface VideoCaps {
  tasks: ("t2v" | "i2v" | "v2v")[];
  fps: number;
  /** Frame counts are multiples of this step (plus one). */
  frame_step: number;
  default_seconds: number;
  min_seconds: number;
  max_seconds: number;
  resolutions: VideoResolution[];
  default_resolution: string;
  /** Start image: not used, optional or required. */
  image_input: "none" | "optional" | "required";
  /** The model also accepts an end image. */
  last_frame: boolean;
  image_role: "start" | "reference";
  /** Source video to edit. */
  video_input: "none" | "optional" | "required";
  audio_out: boolean;
  english_only: boolean;
  /** Non-empty: licence restriction to show prominently. */
  license_warning: string;
}

export interface Language {
  code: string;
  label: string;
}

export interface PresetVoice {
  id: string;
  name: string;
  /** Language code, or "*" for all the model's languages. */
  language: string;
  gender: "f" | "m" | "n";
  description: string;
}

export interface AudioCaps {
  task: "tts" | "stt";
  languages: Language[];
  voices: PresetVoice[];
  clone: "none" | "optional" | "required";
  instruct: boolean;
  instruct_help: string;
  design: boolean;
  speed: boolean;
  tags: string[];
  max_chars: number;
  sample_rate: number;
}

export interface ModelInfo {
  id: string;
  kind: ModelKind;
  audio: AudioCaps | null;
  video?: VideoCaps | null;
  /** Audio engine pack (isolated environment) this model depends on. */
  engine_pack: string | null;
  engine_name: string | null;
  /** What installing the engine brings, in one sentence. */
  engine_detail: string;
  name: string;
  family: string;
  description: string;
  reference_mode: ReferenceMode;
  max_references: number;
  requires_references: boolean;
  text_to_image: boolean;
  params: ParamSpec[];
  size_multiple: number;
  min_side: number;
  max_side: number;
  default_megapixels: number;
  quantize_options: number[];
  default_quantize: number | null;
  quantize: number | null;
  hf_repo: string | null;
  download_size_gb: number | null;
  license: string;
  /** Hugging Face files that need an account: licence accepted on the hub and a token saved in the settings. */
  gated: boolean;
  memory_hint: string;
  tags: string[];
  downloaded: boolean;
  backend: "mlx" | "torch" | "sdcpp" | "pack" | "demo";
  engine_available: boolean;
  engine_reason: string | null;
  compatible: boolean;
  plan: { fits: boolean; strategy: "full" | "model_offload" | "sequential" | "none"; note: string };
  install: "installed" | "partial" | "missing";
  installed_gb: number;
  download: DownloadProgress | null;
  /** Ready to generate: model installed, engine available and compatible with this machine. */
  ready: boolean;
  /** The model's engine is not installed but the app can install it. */
  needs_engine_install: boolean;
  engine_install_size_mb: number | null;
  /** Weight precision ("Q4_K", "bf16", "8 bits"...), empty if unknown. */
  precision: string;
  /** Model added from Hugging Face by the user. */
  custom: boolean;
  /** Quantizations offered for this model (empty if only one). */
  variants: ModelVariant[];
  variant: string;
}

export interface ModelVariant {
  key: string;
  label: string;
  /** Full model size with this quantization. */
  size_gb: number;
  install: "installed" | "partial" | "missing";
  installed_gb: number;
  /** Remaining download needed to use this quantization. */
  need_gb: number;
  selected: boolean;
}

export interface HubResult {
  repo: string;
  family: "gguf-variant" | "sd-diffusers" | "qwen3-tts" | "whisper-ct2" | (string & {});
  family_label: string;
  task: "image" | "tts" | "stt" | "video";
  downloads: number;
  likes: number;
  base: string;
  /** Id of the model already in the list, if any. */
  already: string | null;
}

export interface HubOption {
  key: string;
  label: string;
  precision: string;
  size_gb: number;
}

export interface HubInspect {
  repo: string;
  family: HubResult["family"];
  family_label: string;
  license: string;
  notes: string[];
  template?: { id: string; name: string };
  options: HubOption[];
}

export interface DownloadProgress {
  model_id: string;
  state: "running" | "error" | "cancelled" | "done";
  done: number;
  total: number;
  rate: number;
  eta: number | null;
  error: string | null;
}

export interface Accelerator {
  vendor: "nvidia" | "amd" | "apple" | "other";
  backend: "cuda" | "rocm" | "metal";
  name: string;
  memory_gb: number | null;
  unified: boolean;
}

export interface PackInstallState {
  state: "idle" | "running" | "done" | "error" | "cancelled";
  pack?: string;
  name?: string;
  message?: string;
  detail?: string;
  error?: string | null;
  started_at?: number;
  size_mb?: number;
}

export interface PackInfo {
  name: string;
  size_mb: number;
  installed: boolean;
  installable?: boolean;
  reason?: string;
}

export interface EngineInstallState {
  state: "idle" | "running" | "done" | "error" | "cancelled";
  variant?: string;
  done?: number;
  total?: number;
  message?: string;
  error?: string | null;
}

export interface EngineInfo {
  available: boolean;
  reason?: string;
  device?: string;
  variant?: string;
  installable?: boolean;
  install_variant?: string;
  install_size_mb?: number;
  install?: EngineInstallState;
}

export interface SystemInfo {
  os: string;
  arch: string;
  ram_gb: number;
  ram_free_gb: number;
  accelerators: Accelerator[];
  unusable_gpus: { vendor: string; name: string; memory_gb: number | null; reason: string }[];
  engines: Record<string, EngineInfo>;
  packs: Record<string, PackInfo>;
  pack_install: PackInstallState;
  disk: { free_gb: number; total_gb: number };
  paths: { data: string; models: string };
}

export interface Asset {
  id: string;
  kind: "upload" | "generated";
  media: "image" | "audio" | "video";
  /** Duration in seconds (audio, video). */
  duration: number | null;
  /** Frame rate (video). */
  fps?: number | null;
  url: string;
  thumb_url: string;
  width: number | null;
  height: number | null;
  seed: number | null;
  original_name: string | null;
  favorite: boolean;
  meta: Record<string, unknown>;
  conversation_id: string | null;
  message_id: string | null;
  created_at: number;
  // Only present in gallery results
  conversation_title?: string | null;
  prompt?: string | null;
  model_id?: string | null;
}

export type MessageStatus = "queued" | "loading" | "running" | "done" | "error" | "cancelled";

export interface Message {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: "user" | "assistant";
  prompt: string;
  model_id: string | null;
  params: GenParams;
  status: MessageStatus;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  references: Asset[];
  outputs: Asset[];
}

export interface GenParams {
  aspect?: string;
  megapixels?: number;
  width?: number;
  height?: number;
  steps?: number;
  guidance?: number;
  strength?: number;
  negative_prompt?: string;
  seed?: number | null;
  seeds?: number[];
  count?: number;
  references_used?: number;
  [key: string]: unknown;
}

export interface ConversationSummary {
  id: string;
  mode: ModelKind;
  title: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  cover: Asset | null;
  generation_count: number;
  busy: boolean;
}

export interface Conversation extends ConversationSummary {
  messages: Message[];
}

export interface EngineStatus {
  state: "idle" | "loading" | "ready" | "busy";
  model_id: string | null;
  quantize: number | null;
  load_started_at: number | null;
  current_message_id: string | null;
  queue: string[];
  last_error: string | null;
}

export interface JobProgress {
  message_id: string;
  conversation_id?: string;
  phase?: "loading" | "running";
  /** Stage of a running video job (GGUF engine): prompt/image encoding, sampling, VAE decoding, MP4 encoding. */
  stage?: "prepare" | "fetch" | "sampling" | "decode" | "encode" | null;
  load_started_at?: number;
  index?: number;
  count?: number;
  step?: number;
  total?: number;
  eta?: number | null;
  seconds_per_step?: number | null;
  preview_url?: string | null;
}

export interface VoiceRef {
  source: "preset" | "library";
  id: string;
}

export interface Voice {
  id: string;
  name: string;
  kind: "clone" | "design";
  transcript: string;
  description: string;
  language: string | null;
  duration: number | null;
  peaks: number[];
  url: string | null;
  created_at: number;
}

export interface Settings {
  keep_alive_minutes: number;
  previews: boolean;
  low_memory: boolean;
  has_hf_token: boolean;
  quantize: Record<string, number | null>;
  variant: Record<string, string>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* body is not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  models: () =>
    request<{
      models: ModelInfo[];
      default_model_id: string | null;
      recommended_model_id: string | null;
      ready: boolean;
      audio: { default_model_id: string | null; recommended_model_id: string | null; ready: boolean };
      video?: { default_model_id: string | null; recommended_model_id: string | null; ready: boolean };
    }>("/api/models"),
  installPack: (pack: string) => request<PackInstallState>(`/api/engines/pack/${pack}/install`, { method: "POST" }),
  cancelPackInstall: () => request<{ ok: true }>("/api/engines/pack/install", { method: "DELETE" }),
  uninstallPack: (pack: string) => request<{ ok: true }>(`/api/engines/pack/${pack}`, { method: "DELETE" }),
  voices: () => request<Voice[]>("/api/voices"),
  createVoice: (form: FormData) => request<Voice>("/api/voices", { method: "POST", body: form }),
  voiceFromAsset: (body: { asset_id: string; name?: string; description?: string; transcript?: string; language?: string | null; kind?: "clone" | "design" }) =>
    request<Voice>("/api/voices/from-asset", { method: "POST", body: json(body) }),
  patchVoice: (id: string, patch: { name?: string; transcript?: string; description?: string; language?: string }) =>
    request<Voice>(`/api/voices/${id}`, { method: "PATCH", body: json(patch) }),
  deleteVoice: (id: string) => request<{ ok: true }>(`/api/voices/${id}`, { method: "DELETE" }),
  transcribeVoice: (id: string, body: { language?: string | null } = {}) =>
    request<{ text: string; language: string; duration: number }>(`/api/voices/${id}/transcribe`, { method: "POST", body: json(body) }),
  installEngine: () => request<EngineInstallState>("/api/engines/sdcpp/install", { method: "POST" }),
  cancelEngineInstall: () => request<{ ok: true }>("/api/engines/sdcpp/install", { method: "DELETE" }),
  system: () => request<SystemInfo>("/api/system"),
  hubSearch: (kind: ModelKind, q: string) =>
    request<{ results: HubResult[] }>(`/api/hf/search?kind=${kind}&q=${encodeURIComponent(q)}`).then((r) => r.results),
  hubInspect: (repo: string) => request<HubInspect>(`/api/hf/inspect?repo=${encodeURIComponent(repo)}`),
  addCustomModel: (repo: string, option: string) =>
    request<{ model_id: string }>("/api/models/custom", { method: "POST", body: json({ repo, option }) }),
  removeCustomModel: (id: string) => request<{ freed_gb: number }>(`/api/models/${id}/custom`, { method: "DELETE" }),
  downloadModel: (id: string) => request<DownloadProgress>(`/api/models/${id}/download`, { method: "POST" }),
  cancelDownload: (id: string) => request<{ ok: true }>(`/api/models/${id}/download`, { method: "DELETE" }),
  deleteModel: (id: string) =>
    request<{ freed_gb: number; also_affects: string[] }>(`/api/models/${id}`, { method: "DELETE" }),
  status: () => request<EngineStatus>("/api/status"),
  unload: () => request<EngineStatus>("/api/engine/unload", { method: "POST" }),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings> & { hf_token?: string }) => request<Settings>("/api/settings", { method: "PUT", body: json(patch) }),

  conversations: (q?: string, mode?: ModelKind) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (mode) sp.set("mode", mode);
    return request<ConversationSummary[]>(`/api/conversations${sp.size ? `?${sp}` : ""}`);
  },
  conversation: (id: string) => request<Conversation>(`/api/conversations/${id}`),
  patchConversation: (id: string, patch: { title?: string; pinned?: boolean }) =>
    request<ConversationSummary>(`/api/conversations/${id}`, { method: "PATCH", body: json(patch) }),
  deleteConversation: (id: string) => request<{ ok: true }>(`/api/conversations/${id}`, { method: "DELETE" }),

  send: (body: {
    conversation_id: string | null;
    prompt: string;
    model_id: string;
    params: GenParams;
    reference_ids: string[];
    count: number;
  }) =>
    request<{ conversation_id: string; user_message: Message; assistant_message: Message }>("/api/messages", {
      method: "POST",
      body: json(body),
    }),
  retry: (id: string, body: { keep_seed?: boolean; params?: GenParams; model_id?: string } = {}) =>
    request<Message>(`/api/messages/${id}/retry`, { method: "POST", body: json(body) }),
  cancel: (id: string) => request<{ ok: true }>(`/api/messages/${id}/cancel`, { method: "POST" }),
  deleteMessage: (id: string) => request<{ ok: true; deleted: string[] }>(`/api/messages/${id}`, { method: "DELETE" }),

  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<Asset[]>("/api/assets", { method: "POST", body: form });
  },
  /** Upload with progress (0..1), used for videos which can be large. */
  uploadWithProgress: (files: File[], onProgress: (fraction: number) => void) =>
    new Promise<Asset[]>((resolve, reject) => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/assets");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () => reject(new ApiError(0, "Serveur injoignable"));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* body is not JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body as Asset[]);
        const detail = (body as { detail?: unknown } | null)?.detail;
        reject(new ApiError(xhr.status, typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : xhr.statusText));
      };
      xhr.send(form);
    }),
  assets: (params: { favorites?: boolean; q?: string; before?: number | null; media?: ModelKind }) => {
    const sp = new URLSearchParams({ kind: "generated", limit: "60", media: params.media ?? "image" });
    if (params.favorites) sp.set("favorites", "true");
    if (params.q) sp.set("q", params.q);
    if (params.before) sp.set("before", String(params.before));
    return request<{ items: Asset[]; next_before: number | null }>(`/api/assets?${sp}`);
  },
  patchAsset: (id: string, patch: { favorite?: boolean }) =>
    request<Asset>(`/api/assets/${id}`, { method: "PATCH", body: json(patch) }),
  deleteAsset: (id: string) => request<{ ok: true }>(`/api/assets/${id}`, { method: "DELETE" }),
};
