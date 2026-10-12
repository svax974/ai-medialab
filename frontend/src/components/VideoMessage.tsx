// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Clapperboard, Copy, CornerDownRight, Download, Ellipsis, Film, Heart, Maximize2, PencilLine, RefreshCw, Repeat, Square, Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Asset, type Message, type ModelInfo } from "../lib/api";
import { focusComposer } from "../lib/composer";
import { cx, formatClock, formatDuration, formatSeconds, formatTime } from "../lib/format";
import { keys, queryClient, useModels } from "../lib/queries";
import { ratioOf } from "../lib/size";
import { useStore } from "../lib/store";
import { continueFromLastFrame, editAsVideoSource } from "../lib/video";
import { confirm } from "./Confirm";
import { useNow } from "./EngineCard";
import { copy, download } from "./Message";
import { HelpBody, IconButton, Spinner, Tip } from "./ui";

const ACTIVE = ["queued", "loading", "running"];

// --- Reply message ---

export function VideoAssistantMessage({ message }: { message: Message }) {
  const { data } = useModels();
  const model = data?.models.find((m) => m.id === message.model_id);
  const progress = useStore((s) => s.progress[message.id]);
  const engine = useStore((s) => s.engine);
  const openLightbox = useStore((s) => s.openLightbox);
  const active = ACTIVE.includes(message.status);
  const p = message.params;
  const count = p.count ?? 1;
  const ratio = ratioOf(String(p.aspect ?? "16:9")) ?? 16 / 9;

  const slots: ({ kind: "clip"; asset: Asset } | { kind: "pending"; running: boolean })[] = [];
  for (let i = 0; i < count; i++) {
    const asset = message.outputs[i];
    if (asset) slots.push({ kind: "clip", asset });
    else if (active) slots.push({ kind: "pending", running: message.status === "running" && i === (progress?.index ?? 0) });
  }

  const cols = slots.length <= 1 ? 1 : 2;
  const maxWidth = slots.length <= 1 ? Math.min(680, 520 * Math.sqrt(ratio)) : cols * Math.min(340, 290 * Math.sqrt(ratio));
  const queuePos = engine?.queue.indexOf(message.id) ?? -1;

  return (
    <div className="group/msg flex gap-3 animate-rise">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 ring-1 ring-line">
        <Clapperboard className={cx("size-4 text-safe", active && "animate-breathe")} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-medium text-ink">{model?.name ?? message.model_id}</span>
          <StatusLine message={message} model={model} queuePos={queuePos} />
        </div>

        {slots.length > 0 && (
          <div className={cx("grid gap-2", cols === 2 && "grid-cols-2")} style={{ maxWidth }}>
            {slots.map((slot, i) =>
              slot.kind === "clip" ? (
                <ClipTile
                  key={slot.asset.id}
                  asset={slot.asset}
                  ratio={ratio}
                  fresh={Date.now() / 1000 - slot.asset.created_at < 8}
                  onOpen={() => openLightbox(message.outputs, i)}
                />
              ) : (
                <PendingClip
                  key={`slot-${i}`}
                  ratio={ratio}
                  active={slot.running}
                  fraction={slot.running && progress?.total ? (progress.step ?? 0) / progress.total : 0}
                  label={message.status === "loading" ? "chargement du modèle" : slot.running ? (progress?.step ? `étape ${progress.step}/${progress.total}` : "préparation…") : "en attente"}
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
        {message.status === "cancelled" && message.outputs.length === 0 && <div className="mt-1 text-[13px] italic text-faint">Génération annulée.</div>}

        <Footer message={message} active={active} />
      </div>
    </div>
  );
}

function StatusLine({ message, model, queuePos }: { message: Message; model?: ModelInfo; queuePos: number }) {
  const progress = useStore((s) => s.progress[message.id]);
  const now = useNow(message.status === "loading" || message.status === "running");
  const p = message.params;

  if (message.status === "queued")
    return <span className="font-mono text-[11px] text-faint">en file d'attente{queuePos > 0 ? ` · position ${queuePos + 1}` : ""}</span>;
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
    // The GGUF engine reports its stages; decoding the video can take minutes and shows no steps.
    const waiting = progress?.stage === "fetch" ? "téléchargement du décodeur rapide (23 Mo)…"
      : progress?.stage === "decode" ? (p.fast_decode ? "décodage rapide de la vidéo…" : "décodage de la vidéo (peut durer plusieurs minutes)…")
      : progress?.stage === "encode" ? "encodage MP4…"
      : progress?.stage === "sampling" ? "échantillonnage…" : "préparation…";
    return (
      <span className="font-mono text-[11px] text-safe">
        {progress?.step ? `étape ${progress.step}/${progress.total}` : waiting}
        {count > 1 && ` · clip ${(progress?.index ?? 0) + 1}/${count}`}
        {progress?.eta != null && progress.step ? ` · ~${formatDuration(progress.eta)} restantes` : ""}
      </span>
    );
  }
  const duration = message.finished_at && message.started_at ? message.finished_at - message.started_at : null;
  const res = model?.video?.resolutions.find((r) => r.id === p.resolution)?.label;
  return (
    <span className="font-mono text-[11px] text-faint">
      {[
        p.width && p.height ? `${p.width}×${p.height}` : res ?? null,
        typeof p.seconds === "number" ? formatSeconds(p.seconds) : null,
        p.steps ? `${p.steps} étapes` : null,
        message.status === "done" && duration ? `généré en ${formatDuration(duration)}` : null,
        formatTime(message.created_at),
      ]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

// --- Tiles ---

/** Clip with native controls; starting one pauses the others. */
export function ClipTile({ asset, ratio, fresh, onOpen }: { asset: Asset; ratio: number; fresh: boolean; onOpen: () => void }) {
  const r = asset.width && asset.height ? asset.width / asset.height : ratio;
  return (
    <div className="group/tile relative overflow-hidden rounded-2xl bg-tray ring-1 ring-line" style={{ aspectRatio: r }}>
      <video
        src={asset.url}
        poster={asset.thumb_url}
        controls
        loop
        playsInline
        preload="metadata"
        onPlay={(e) => document.querySelectorAll("video").forEach((v) => v !== e.currentTarget && v.pause())}
        className={cx("size-full bg-black object-contain", fresh && "animate-develop")}
      />
      <ClipActions asset={asset} onOpen={onOpen} />
    </div>
  );
}

/** Hover actions of a clip (top corners, so they never cover the player controls). */
export function ClipActions({ asset, onOpen }: { asset: Asset; onOpen?: () => void }) {
  const toggleFavorite = () => api.patchAsset(asset.id, { favorite: !asset.favorite }).catch((e) => toast.error(e.message));
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent opacity-0 transition-opacity group-hover/tile:opacity-100" />
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100">
        <IconButton label="Utiliser comme vidéo source (modifier)" tone="glass" size="sm" onClick={() => editAsVideoSource(asset)}>
          <Film className="size-3.5" />
        </IconButton>
        <IconButton label="Dernière image comme départ (poursuivre le plan)" tone="glass" size="sm" onClick={() => continueFromLastFrame(asset)}>
          <CornerDownRight className="size-3.5" />
        </IconButton>
        <IconButton label="Télécharger (MP4)" tone="glass" size="sm" onClick={() => download(asset)}>
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
          "absolute left-2 top-2 grid size-7 place-items-center rounded-lg bg-black/45 backdrop-blur-md transition-opacity",
          asset.favorite ? "text-safe opacity-100" : "text-white/90 opacity-0 hover:text-safe group-hover/tile:opacity-100",
        )}
      >
        <Heart className={cx("size-3.5", asset.favorite && "fill-current")} />
      </button>
    </>
  );
}

function PendingClip({ ratio, fraction, active, label }: { ratio: number; fraction: number; active: boolean; label: string }) {
  return (
    <div className="tray relative overflow-hidden rounded-2xl ring-1 ring-line" style={{ aspectRatio: ratio }}>
      {active && <div className="shimmer absolute inset-0" />}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className={cx("size-2 rounded-full", active ? "bg-safe shadow-[0_0_18px_var(--safe)] animate-breathe" : "bg-faint/50")} />
        <span className="font-mono text-[11px] text-muted">{label}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/30">
        <div className="h-full bg-safe shadow-[0_0_12px_var(--safe)] transition-[width] duration-500" style={{ width: `${Math.max(active ? 2 : 0, fraction * 100)}%` }} />
      </div>
    </div>
  );
}

// --- Message actions ---

function Footer({ message, active }: { message: Message; active: boolean }) {
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
    const id = message.model_id;
    if (!id) return;
    s.setVideoModel(id);
    s.setVideoPrompt(message.prompt);
    const { seeds, count, seed, references_used, width, height, ...rest } = message.params;
    void seed;
    void references_used;
    void width;
    void height;
    s.setParams(id, rest);
    if (count) s.setVideoCount(Math.min(2, count));
    s.setSeed(seeds?.[0] ?? null);
    // Inputs live on the prompt message that precedes this reply.
    const parent = queryClient.getQueryData<{ messages: Message[] }>(keys.conversation(message.conversation_id))?.messages.find((m) => m.id === message.parent_id);
    const refs = message.references.length ? message.references : parent?.references ?? [];
    s.clearVideoSlots();
    const images = refs.filter((r) => r.media !== "video");
    if (images[0]) s.setVideoSlot("start", images[0]);
    if (images[1]) s.setVideoSlot("end", images[1]);
    const video = refs.find((r) => r.media === "video");
    if (video) s.setVideoSlot("source", video);
    toast.success("Réglages repris (graine fixée)", { duration: 1800 });
    focusComposer();
  };

  const remove = async () => {
    const ok = await confirm({ title: "Supprimer cette génération ?", description: "Les vidéos produites seront supprimées.", confirmLabel: "Supprimer", danger: true });
    if (ok) run(() => api.deleteMessage(message.id))();
  };

  const outputs = message.outputs;
  return (
    <div className="mt-2 flex items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
      <Tip wide label={<HelpBody title="Nouvelles variantes (graines aléatoires)" body="Relance le même prompt avec de nouvelles graines aléatoires : chaque essai donne un clip différent." />}>
        <button
          onClick={run(() => api.retry(message.id))}
          disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <RefreshCw className="size-3.5" /> Varier
        </button>
      </Tip>
      <IconButton label="Relancer avec les mêmes graines" hint="Relance avec les mêmes graines : redonne le même clip. Utile après avoir changé un réglage pour juger son seul effet." size="sm" onClick={run(() => api.retry(message.id, { keep_seed: true }))}>
        <Repeat className="size-3.5" />
      </IconButton>
      <IconButton label="Reprendre ces réglages dans le composer" size="sm" onClick={reuseSettings}>
        <PencilLine className="size-3.5" />
      </IconButton>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button aria-label="Plus d'actions" className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink">
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content collisionPadding={12} align="start" sideOffset={4} className="menu min-w-64">
            {outputs.map((a, i) => (
              <div key={a.id}>
                <DropdownMenu.Item className="menu-item" onSelect={() => editAsVideoSource(a)}>
                  <Film className="size-4" /> Utiliser {outputs.length > 1 ? `le clip ${i + 1}` : "le clip"} comme vidéo source
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => continueFromLastFrame(a)}>
                  <CornerDownRight className="size-4" /> Dernière image {outputs.length > 1 ? `du clip ${i + 1} ` : ""}comme départ
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => download(a)}>
                  <Download className="size-4" /> Télécharger {outputs.length > 1 ? `le clip ${i + 1}` : "le clip"}
                </DropdownMenu.Item>
              </div>
            ))}
            {outputs.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
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
