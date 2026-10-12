// Types et appels de l'API backend.

export type ReferenceMode = "none" | "init" | "multi";

export interface ParamSpec {
  key: string;
  label: string;
  type: "int" | "float" | "text";
  default: number | string;
  min: number | null;
  max: number | null;
  step: number | null;
  help: string;
  advanced: boolean;
  requires_references: boolean;
}

export type ModelKind = "image" | "audio";

export interface Language {
  code: string;
  label: string;
}

export interface PresetVoice {
  id: string;
  name: string;
  /** Code de langue, ou "*" pour toutes les langues du modèle. */
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
  /** Pack de moteur audio (environnement isolé) dont dépend ce modèle. */
  engine_pack: string | null;
  engine_name: string | null;
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
  /** Prêt à générer : modèle installé, moteur disponible et compatible avec la machine. */
  ready: boolean;
  /** Le moteur de ce modèle n'est pas installé mais l'application sait l'installer. */
  needs_engine_install: boolean;
  engine_install_size_mb: number | null;
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
  media: "image" | "audio";
  /** Durée en secondes (audio). */
  duration: number | null;
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
  // Présents dans la galerie
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
      /* corps non JSON */
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
