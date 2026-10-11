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

export interface ModelInfo {
  id: string;
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
  backend: "mlx" | "torch" | "demo";
  engine_available: boolean;
  engine_reason: string | null;
  compatible: boolean;
  plan: { fits: boolean; strategy: "full" | "model_offload" | "sequential" | "none"; note: string };
  install: "installed" | "partial" | "missing";
  installed_gb: number;
  download: DownloadProgress | null;
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

export interface SystemInfo {
  os: string;
  arch: string;
  ram_gb: number;
  ram_free_gb: number;
  accelerators: Accelerator[];
  unusable_gpus: { vendor: string; name: string; memory_gb: number | null; reason: string }[];
  engines: Record<string, { available: boolean; reason?: string; device?: string }>;
  disk: { free_gb: number; total_gb: number };
  paths: { data: string; models: string };
}

export interface Asset {
  id: string;
  kind: "upload" | "generated";
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
  models: () => request<{ models: ModelInfo[]; default_model_id: string | null }>("/api/models"),
  system: () => request<SystemInfo>("/api/system"),
  downloadModel: (id: string) => request<DownloadProgress>(`/api/models/${id}/download`, { method: "POST" }),
  cancelDownload: (id: string) => request<{ ok: true }>(`/api/models/${id}/download`, { method: "DELETE" }),
  deleteModel: (id: string) =>
    request<{ freed_gb: number; also_affects: string[] }>(`/api/models/${id}`, { method: "DELETE" }),
  status: () => request<EngineStatus>("/api/status"),
  unload: () => request<EngineStatus>("/api/engine/unload", { method: "POST" }),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings> & { hf_token?: string }) => request<Settings>("/api/settings", { method: "PUT", body: json(patch) }),

  conversations: (q?: string) =>
    request<ConversationSummary[]>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`),
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
  assets: (params: { favorites?: boolean; q?: string; before?: number | null }) => {
    const sp = new URLSearchParams({ kind: "generated", limit: "60" });
    if (params.favorites) sp.set("favorites", "true");
    if (params.q) sp.set("q", params.q);
    if (params.before) sp.set("before", String(params.before));
    return request<{ items: Asset[]; next_before: number | null }>(`/api/assets?${sp}`);
  },
  patchAsset: (id: string, patch: { favorite?: boolean }) =>
    request<Asset>(`/api/assets/${id}`, { method: "PATCH", body: json(patch) }),
  deleteAsset: (id: string) => request<{ ok: true }>(`/api/assets/${id}`, { method: "DELETE" }),
};
