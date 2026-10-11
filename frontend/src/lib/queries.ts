// Requêtes react-query, mutations et synchronisation temps réel (SSE).
import { useEffect } from "react";
import { QueryClient, useQuery, type InfiniteData } from "@tanstack/react-query";
import {
  api, type Asset, type Conversation, type ConversationSummary, type DownloadProgress, type EngineInstallState, type Message,
  type ModelInfo,
} from "./api";
import { useStore } from "./store";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export const keys = {
  models: ["models"] as const,
  settings: ["settings"] as const,
  conversations: (q = "") => ["conversations", q] as const,
  conversation: (id: string) => ["conversation", id] as const,
  assets: (favorites: boolean, q: string) => ["assets", favorites, q] as const,
};

export function useModels() {
  return useQuery({ queryKey: keys.models, queryFn: api.models, staleTime: 60_000 });
}

/** Modèle actif du composer (préférence locale, sinon modèle par défaut du serveur). */
export function useActiveModel(): ModelInfo | undefined {
  const { data } = useModels();
  const modelId = useStore((s) => s.modelId);
  if (!data) return undefined;
  return data.models.find((m) => m.id === modelId) ?? data.models.find((m) => m.id === data.default_model_id) ?? data.models[0];
}

export function useConversations(q: string) {
  return useQuery({ queryKey: keys.conversations(q), queryFn: () => api.conversations(q || undefined) });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: keys.conversation(id ?? ""),
    queryFn: () => api.conversation(id!),
    enabled: !!id,
  });
}

// --- Mise à jour du cache --------------------------------------------------------------------------

export function upsertMessage(msg: Message) {
  queryClient.setQueryData<Conversation>(keys.conversation(msg.conversation_id), (conv) => {
    if (!conv) return conv;
    const exists = conv.messages.some((m) => m.id === msg.id);
    const messages = exists
      ? conv.messages.map((m) => (m.id === msg.id ? msg : m))
      : [...conv.messages, msg].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
    return { ...conv, messages };
  });
}

function patchAssetEverywhere(asset: Asset) {
  if (asset.conversation_id) {
    queryClient.setQueryData<Conversation>(keys.conversation(asset.conversation_id), (conv) =>
      conv
        ? {
            ...conv,
            messages: conv.messages.map((m) => ({
              ...m,
              outputs: m.outputs.map((o) => (o.id === asset.id ? { ...o, ...asset } : o)),
            })),
          }
        : conv,
    );
  }
  const patchPage = (p: { items: Asset[] }) => ({ ...p, items: p.items.map((i) => (i.id === asset.id ? { ...i, ...asset } : i)) });
  queryClient.setQueriesData<InfiniteData<{ items: Asset[] }> | { items: Asset[] }>({ queryKey: ["assets"] }, (data) => {
    if (!data) return data;
    if ("pages" in data) return { ...data, pages: data.pages.map(patchPage) };
    return patchPage(data);
  });
  const lb = useStore.getState().lightbox;
  if (lb?.items.some((i) => i.id === asset.id)) {
    useStore.setState({ lightbox: { ...lb, items: lb.items.map((i) => (i.id === asset.id ? { ...i, ...asset } : i)) } });
  }
}

let listTimer: ReturnType<typeof setTimeout> | undefined;
function refreshConversationList() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => queryClient.invalidateQueries({ queryKey: ["conversations"] }), 250);
}

/** Abonnement unique au flux d'événements du serveur. */
export function useServerEvents() {
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const store = useStore.getState;

    const connect = () => {
      source = new EventSource("/api/events");
      const on = <T,>(type: string, fn: (data: T) => void) =>
        source!.addEventListener(type, (e) => fn(JSON.parse((e as MessageEvent).data)));

      source.onopen = () => {
        // Rattrape ce qui a pu être manqué pendant une déconnexion.
        queryClient.invalidateQueries({ queryKey: ["conversation"] });
        refreshConversationList();
      };
      on("engine.status", store().setEngine);
      on<DownloadProgress>("download.progress", (d) => {
        store().setDownload(d);
        if (d.state !== "running") queryClient.invalidateQueries({ queryKey: keys.models });
      });
      on("models.changed", () => {
        queryClient.invalidateQueries({ queryKey: keys.models });
        queryClient.invalidateQueries({ queryKey: ["system"] });
      });
      on<EngineInstallState>("engine.install", (s) => {
        store().setEngineInstall(s);
        if (s.state !== "running") {
          queryClient.invalidateQueries({ queryKey: keys.models });
          queryClient.invalidateQueries({ queryKey: ["system"] });
        }
      });
      on("job.progress", store().setProgress);
      on<Message>("message.updated", (msg) => {
        upsertMessage(msg);
        if (!["queued", "loading", "running"].includes(msg.status)) store().clearProgress(msg.id);
        if (msg.status === "done" || msg.status === "error") refreshConversationList();
      });
      on<{ message_id: string; conversation_id: string; asset: Asset }>("job.image", ({ message_id, conversation_id, asset }) => {
        queryClient.setQueryData<Conversation>(keys.conversation(conversation_id), (conv) =>
          conv
            ? {
                ...conv,
                messages: conv.messages.map((m) =>
                  m.id === message_id && !m.outputs.some((o) => o.id === asset.id)
                    ? { ...m, outputs: [...m.outputs, asset].sort((a, b) => a.created_at - b.created_at) }
                    : m,
                ),
              }
            : conv,
        );
        queryClient.invalidateQueries({ queryKey: ["assets"] });
      });
      on<{ conversation_id: string; ids: string[] }>("message.deleted", ({ conversation_id, ids }) => {
        queryClient.setQueryData<Conversation>(keys.conversation(conversation_id), (conv) =>
          conv ? { ...conv, messages: conv.messages.filter((m) => !ids.includes(m.id)) } : conv,
        );
      });
      on<ConversationSummary>("conversation.updated", (summary) => {
        if (!summary) return;
        queryClient.setQueryData<Conversation>(keys.conversation(summary.id), (conv) =>
          conv ? { ...conv, ...summary, messages: conv.messages } : conv,
        );
        refreshConversationList();
      });
      on<{ id: string }>("conversation.deleted", ({ id }) => {
        queryClient.removeQueries({ queryKey: keys.conversation(id) });
        refreshConversationList();
        queryClient.invalidateQueries({ queryKey: ["assets"] });
      });
      on<Asset>("asset.updated", patchAssetEverywhere);
      on<{ id: string; conversation_id: string | null }>("asset.deleted", ({ conversation_id }) => {
        if (conversation_id) queryClient.invalidateQueries({ queryKey: keys.conversation(conversation_id) });
        queryClient.invalidateQueries({ queryKey: ["assets"] });
      });
      source.onerror = () => {
        source?.close();
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      source?.close();
    };
  }, []);
}
