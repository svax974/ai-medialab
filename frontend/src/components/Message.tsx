import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Copy, Download, Ellipsis, Heart, ImagePlus, Maximize2, PencilLine, RefreshCw, Repeat, Square, Trash2, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Asset, type Message, type ModelInfo } from "../lib/api";
import { focusComposer, addAsReference } from "../lib/composer";
import { cx, formatClock, formatDuration, formatTime } from "../lib/format";
import { useModels } from "../lib/queries";
import { ratioOf } from "../lib/size";
import { useStore } from "../lib/store";
import { confirm } from "./Confirm";
import { useNow } from "./EngineCard";
import { IconButton, Mark, Spinner, Tip } from "./ui";

const ACTIVE = ["queued", "loading", "running"];

// --- Message utilisateur ---------------------------------------------------------------------------

export function UserMessage({ message }: { message: Message }) {
  const openLightbox = useStore((s) => s.openLightbox);

  const reuse = () => {
    const s = useStore.getState();
    s.setPrompt(message.prompt);
    s.clearReferences();
    s.addReferences(message.references);
    focusComposer(true);
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Supprimer ce message ?",
      description: "Le prompt et toutes les générations qui en découlent seront supprimés.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok) api.deleteMessage(message.id).catch((e) => toast.error(e.message));
  };

  return (
    <div className="group flex flex-col items-end gap-2 animate-rise">
      {message.references.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {message.references.map((r, i) => (
            <button
              key={r.id}
              onClick={() => openLightbox(message.references, i)}
              className="relative size-20 overflow-hidden rounded-xl ring-1 ring-line-strong transition-transform hover:-translate-y-0.5"
            >
              <img src={r.thumb_url} alt="" className="size-full object-cover" loading="lazy" />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white/90">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
      <div className="max-w-[min(620px,90%)] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-[15px] leading-relaxed text-ink">
        {message.prompt}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <span className="mr-1 font-mono text-[10.5px] text-faint">{formatTime(message.created_at)}</span>
        <IconButton label="Copier le prompt" size="sm" onClick={() => copy(message.prompt)}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton label="Reprendre dans le composer" size="sm" onClick={reuse}>
          <PencilLine className="size-3.5" />
        </IconButton>
        <IconButton label="Supprimer" size="sm" tone="danger" onClick={remove}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

// --- Réponse (génération) --------------------------------------------------------------------------

export function AssistantMessage({ message }: { message: Message }) {
  const { data } = useModels();
  const model = data?.models.find((m) => m.id === message.model_id);
  const progress = useStore((s) => s.progress[message.id]);
  const engine = useStore((s) => s.engine);
  const openLightbox = useStore((s) => s.openLightbox);
  const active = ACTIVE.includes(message.status);
  const p = message.params;
  const count = p.count ?? 1;
  const ratio = p.width && p.height ? p.width / p.height : ratioOf(p.aspect ?? "1:1") ?? 1;

  const slots: ({ kind: "image"; asset: Asset } | { kind: "developing" } | { kind: "waiting" })[] = [];
  for (let i = 0; i < count; i++) {
    const asset = message.outputs[i];
    if (asset) slots.push({ kind: "image", asset });
    else if (active) slots.push(i === (progress?.index ?? 0) && message.status === "running" ? { kind: "developing" } : { kind: "waiting" });
  }

  const cols = slots.length <= 1 ? 1 : 2;
  const maxWidth = slots.length <= 1 ? Math.min(640, 520 * Math.sqrt(ratio)) : cols * Math.min(320, 280 * Math.sqrt(ratio));
  const queuePos = engine?.queue.indexOf(message.id) ?? -1;

  return (
    <div className="group/msg flex gap-3 animate-rise">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 ring-1 ring-line">
        <Mark className={cx("size-4", active && "animate-breathe")} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-medium text-ink">{model?.name ?? message.model_id}</span>
          <StatusLine message={message} model={model} queuePos={queuePos} />
        </div>

        {slots.length > 0 && (
          <div className={cx("grid gap-2", cols === 2 && "grid-cols-2")} style={{ maxWidth }}>
            {slots.map((slot, i) =>
              slot.kind === "image" ? (
                <ImageTile
                  key={slot.asset.id}
                  asset={slot.asset}
                  ratio={ratio}
                  fresh={Date.now() / 1000 - slot.asset.created_at < 8}
                  onOpen={() => openLightbox(message.outputs, i)}
                />
              ) : (
                <DevelopingTile
                  key={`slot-${i}`}
                  ratio={ratio}
                  previewUrl={slot.kind === "developing" ? progress?.preview_url : null}
                  fraction={slot.kind === "developing" && progress?.total ? (progress.step ?? 0) / progress.total : 0}
                  active={slot.kind === "developing"}
                />
              ),
            )}
          </div>
        )}

        {message.status === "error" && (
          <div className="mt-1 flex max-w-xl items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <span className="min-w-0 break-words">{message.error ?? "Erreur inconnue."}</span>
          </div>
        )}
        {message.status === "cancelled" && message.outputs.length === 0 && (
          <div className="mt-1 text-[13px] italic text-faint">Génération annulée.</div>
        )}

        <MessageFooter message={message} active={active} />
      </div>
    </div>
  );
}

function StatusLine({ message, model, queuePos }: { message: Message; model?: ModelInfo; queuePos: number }) {
  const progress = useStore((s) => s.progress[message.id]);
  const now = useNow(message.status === "loading" || message.status === "running");
  const p = message.params;

  if (message.status === "queued") {
    return <span className="font-mono text-[11px] text-faint">en file d'attente{queuePos > 0 ? ` · position ${queuePos + 1}` : ""}</span>;
  }
  if (message.status === "loading") {
    const since = progress?.load_started_at ?? message.started_at ?? now;
    return (
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-warn">
        <Spinner className="size-3" /> chargement du modèle en mémoire · {formatClock(now - since)}
        {model && !model.downloaded && " · téléchargement possible"}
      </span>
    );
  }
  if (message.status === "running") {
    const count = p.count ?? 1;
    return (
      <span className="font-mono text-[11px] text-safe">
        {progress?.step ? `étape ${progress.step}/${progress.total}` : "préparation…"}
        {count > 1 && ` · image ${(progress?.index ?? 0) + 1}/${count}`}
        {progress?.eta != null && progress.step ? ` · ~${formatDuration(progress.eta)} restantes` : ""}
      </span>
    );
  }
  const duration = message.finished_at && message.started_at ? message.finished_at - message.started_at : null;
  return (
    <span className="font-mono text-[11px] text-faint">
      {[
        p.width && p.height ? `${p.width}×${p.height}` : null,
        p.steps ? `${p.steps} étapes` : null,
        p.references_used ? `${p.references_used} réf.` : null,
        message.status === "done" && duration ? formatDuration(duration) : null,
        formatTime(message.created_at),
      ]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

function MessageFooter({ message, active }: { message: Message; active: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    return (
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={run(() => api.cancel(message.id))}
          disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 transition-colors hover:border-danger/50 hover:text-danger"
        >
          <Square className="size-3 fill-current" /> Annuler
        </button>
      </div>
    );
  }

  const reuseSettings = () => {
    const s = useStore.getState();
    if (message.model_id) s.setModel(message.model_id);
    const { seeds, count, width, height, references_used, seed, ...rest } = message.params;
    void references_used;
    void seed;
    s.setParams(message.model_id!, rest.aspect === "custom" ? { ...rest, width, height } : rest);
    if (count) s.setCount(count);
    s.setSeed(seeds?.[0] ?? null);
    toast.success("Réglages repris (graine fixée)", { duration: 1800 });
    focusComposer();
  };

  const remove = async () => {
    const ok = await confirm({ title: "Supprimer cette génération ?", description: "Les images produites seront supprimées.", confirmLabel: "Supprimer", danger: true });
    if (ok) run(() => api.deleteMessage(message.id))();
  };

  return (
    <div className="mt-2 flex items-center gap-0.5 opacity-60 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
      <Tip label="Nouvelles variantes (graines aléatoires)">
        <button
          onClick={run(() => api.retry(message.id))}
          disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <RefreshCw className="size-3.5" /> Varier
        </button>
      </Tip>
      <IconButton label="Relancer avec les mêmes graines" size="sm" onClick={run(() => api.retry(message.id, { keep_seed: true }))}>
        <Repeat className="size-3.5" />
      </IconButton>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button aria-label="Plus d'actions" className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink">
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content collisionPadding={12} align="start" sideOffset={4} className="menu min-w-56">
            <DropdownMenu.Item className="menu-item" onSelect={reuseSettings}>
              <PencilLine className="size-4" /> Reprendre ces réglages
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => copy(message.prompt)}>
              <Copy className="size-4" /> Copier le prompt
            </DropdownMenu.Item>
            {message.params.seeds && (
              <DropdownMenu.Item className="menu-item" onSelect={() => copy(message.params.seeds!.join(", "))}>
                <Copy className="size-4" /> Copier les graines
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className="menu-item" data-danger onSelect={remove}>
              <Trash2 className="size-4" /> Supprimer la génération
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

// --- Tuiles ----------------------------------------------------------------------------------------

export function ImageTile({ asset, ratio, fresh, onOpen }: { asset: Asset; ratio: number; fresh: boolean; onOpen: () => void }) {
  const r = asset.width && asset.height ? asset.width / asset.height : ratio;
  return (
    <div className="group/tile relative overflow-hidden rounded-2xl bg-tray ring-1 ring-line" style={{ aspectRatio: r }}>
      <button onClick={onOpen} className="absolute inset-0 cursor-zoom-in" aria-label="Agrandir">
        <img
          src={asset.thumb_url}
          srcSet={`${asset.thumb_url} 640w, ${asset.url} ${asset.width ?? 1024}w`}
          sizes="(max-width: 900px) 90vw, 640px"
          alt={String(asset.meta?.prompt ?? "")}
          className={cx("size-full object-cover", fresh && "animate-develop")}
          loading="lazy"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("application/x-cn-asset", JSON.stringify(asset))}
        />
      </button>
      <TileActions asset={asset} onOpen={onOpen} />
    </div>
  );
}

export function TileActions({ asset, onOpen }: { asset: Asset; onOpen?: () => void }) {
  const toggleFavorite = () => api.patchAsset(asset.id, { favorite: !asset.favorite }).catch((e) => toast.error(e.message));
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent opacity-0 transition-opacity group-hover/tile:opacity-100" />
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100">
        <IconButton label="Utiliser comme référence" tone="glass" size="sm" onClick={() => addAsReference(asset)}>
          <ImagePlus className="size-3.5" />
        </IconButton>
        <IconButton label="Télécharger" tone="glass" size="sm" onClick={() => download(asset)}>
          <Download className="size-3.5" />
        </IconButton>
        {onOpen && (
          <IconButton label="Agrandir" tone="glass" size="sm" onClick={onOpen}>
            <Maximize2 className="size-3.5" />
          </IconButton>
        )}
      </div>
      <button
        onClick={toggleFavorite}
        aria-label={asset.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        className={cx(
          "absolute left-2 top-2 grid size-7 place-items-center rounded-lg backdrop-blur-md transition-opacity",
          asset.favorite ? "bg-black/45 text-safe opacity-100" : "bg-black/45 text-white/90 opacity-0 hover:text-safe group-hover/tile:opacity-100",
        )}
      >
        <Heart className={cx("size-3.5", asset.favorite && "fill-current")} />
      </button>
      {asset.seed != null && (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white/85 opacity-0 backdrop-blur transition-opacity group-hover/tile:opacity-100">
          seed {asset.seed}
        </span>
      )}
    </>
  );
}

function DevelopingTile({ ratio, previewUrl, fraction, active }: { ratio: number; previewUrl?: string | null; fraction: number; active: boolean }) {
  // Le flou et la teinte « bain de révélateur » diminuent à mesure que l'image se forme.
  const blur = Math.round(22 * (1 - fraction));
  return (
    <div className="tray relative overflow-hidden rounded-2xl ring-1 ring-line" style={{ aspectRatio: ratio }}>
      {previewUrl && (
        <img
          key={previewUrl}
          src={previewUrl}
          alt=""
          className="absolute inset-0 size-full object-cover animate-fade"
          style={{ filter: `blur(${blur}px) sepia(${0.7 * (1 - fraction)}) saturate(${1 + 0.8 * (1 - fraction)}) hue-rotate(-12deg)` }}
        />
      )}
      {active && <div className="shimmer absolute inset-0" />}
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/30">
        <div className="h-full bg-safe shadow-[0_0_12px_var(--safe)] transition-[width] duration-500" style={{ width: `${Math.max(active ? 2 : 0, fraction * 100)}%` }} />
      </div>
      {!previewUrl && (
        <div className="absolute inset-0 grid place-items-center">
          <div className={cx("size-2 rounded-full", active ? "bg-safe shadow-[0_0_18px_var(--safe)] animate-breathe" : "bg-faint/50")} />
        </div>
      )}
    </div>
  );
}

// --- Utilitaires -----------------------------------------------------------------------------------

export function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copié", { duration: 1200 }),
    () => toast.error("Copie impossible"),
  );
}

export function download(asset: Asset) {
  const a = document.createElement("a");
  a.href = asset.url;
  const prompt = String(asset.meta?.prompt ?? asset.original_name ?? "image");
  const slug = prompt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-|-$/g, "");
  a.download = `${slug || "image"}-${asset.seed ?? asset.id}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
