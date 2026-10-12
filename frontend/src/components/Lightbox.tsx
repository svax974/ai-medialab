// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Copy, CornerDownRight, Download, Film, Heart, ImagePlus, MessageSquare, PanelRightClose, PanelRightOpen, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { addAsReference } from "../lib/composer";
import { cx, formatDay, formatDuration, formatSeconds, formatTime } from "../lib/format";
import { useModels } from "../lib/queries";
import { navigate, paths } from "../lib/router";
import { assignVideoAsset, continueFromLastFrame, editAsVideoSource } from "../lib/video";
import { useStore } from "../lib/store";
import { confirm } from "./Confirm";
import { copy, download } from "./Message";
import { HELP } from "../lib/help";
import { Button, IconButton, InfoTip, type Help } from "./ui";

export function Lightbox() {
  const lightbox = useStore((s) => s.lightbox);
  const close = useStore((s) => s.closeLightbox);
  const setIndex = useStore((s) => s.setLightboxIndex);
  const [info, setInfo] = useState(true);
  const [zoom, setZoom] = useState(false);
  const { data } = useModels();
  const mode = useStore((s) => s.mode);
  const videoRef = useRef<HTMLVideoElement>(null);

  const items = lightbox?.items ?? [];
  const index = lightbox?.index ?? 0;
  const asset = items[index];

  useEffect(() => setZoom(false), [index]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "ArrowRight" && index < items.length - 1) setIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) setIndex(index - 1);
      if (e.key.toLowerCase() === "i") setInfo((v) => !v);
      // Player shortcuts (video): space / K play-pause, J / L skip 5 s, M mute, , / . step one frame.
      const v = videoRef.current;
      const k = e.key.toLowerCase();
      if (v && !e.metaKey && !e.ctrlKey && !(e.target as HTMLElement).closest("button")) {
        if (k === " " || k === "k") {
          e.preventDefault();
          if (v.paused) v.play().catch(() => undefined);
          else v.pause();
        } else if (k === "j") v.currentTime = Math.max(0, v.currentTime - 5);
        else if (k === "l") v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
        else if (k === "m") v.muted = !v.muted;
        else if (k === "," || k === ".") {
          v.pause();
          v.currentTime = Math.max(0, v.currentTime + (k === "." ? 1 : -1) / 24);
        }
      }
      if (e.key.toLowerCase() === "f" && asset) api.patchAsset(asset.id, { favorite: !asset.favorite });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, index, items.length, setIndex, asset]);

  if (!asset) return null;
  const isVideo = asset.media === "video";
  const meta = asset.meta as { prompt?: string; model_id?: string; steps?: number; guidance?: number; strength?: number; seconds?: number };
  const prompt = meta.prompt ?? asset.prompt ?? null;
  const model = data?.models.find((m) => m.id === (meta.model_id ?? asset.model_id));

  const remove = async () => {
    const ok = await confirm({ title: isVideo ? "Supprimer cette vidéo ?" : "Supprimer cette image ?", confirmLabel: "Supprimer", danger: true });
    if (!ok) return;
    try {
      await api.deleteAsset(asset.id);
      const rest = items.filter((i) => i.id !== asset.id);
      if (!rest.length) close();
      else useStore.setState({ lightbox: { items: rest, index: Math.min(index, rest.length - 1) } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-[#060504]/95 backdrop-blur-sm animate-fade" />
        <Dialog.Content className="fixed inset-0 z-[71] flex text-[#efe8e1] outline-none" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Visionneuse</Dialog.Title>
          <div className="relative flex min-w-0 flex-1 flex-col">
            <div className="flex h-14 shrink-0 items-center gap-2 px-4">
              <span className="font-mono text-[11px] text-white/50">
                {index + 1} / {items.length}
              </span>
              <div className="flex-1" />
              {isVideo ? (
                <>
                  <IconButton label="Utiliser comme vidéo source (modifier)" tone="glass" onClick={() => editAsVideoSource(asset)}>
                    <Film className="size-4" />
                  </IconButton>
                  <IconButton label="Dernière image comme départ" tone="glass" onClick={() => continueFromLastFrame(asset)}>
                    <CornerDownRight className="size-4" />
                  </IconButton>
                </>
              ) : (
                <IconButton
                  label={mode === "video" ? "Utiliser comme image de départ" : "Utiliser comme référence"}
                  tone="glass"
                  onClick={() => {
                    if (mode === "video") (close(), assignVideoAsset(asset));
                    else addAsReference(asset);
                  }}
                >
                  <ImagePlus className="size-4" />
                </IconButton>
              )}
              {asset.kind === "generated" && (
                <IconButton label={asset.favorite ? "Retirer des favoris" : "Favori"} kbd="F" tone="glass" onClick={() => api.patchAsset(asset.id, { favorite: !asset.favorite })}>
                  <Heart className={cx("size-4", asset.favorite && "fill-[var(--safe)] text-[var(--safe)]")} />
                </IconButton>
              )}
              <IconButton label="Télécharger" tone="glass" onClick={() => download(asset)}>
                <Download className="size-4" />
              </IconButton>
              <IconButton label={info ? "Masquer les infos" : "Infos"} kbd="I" tone="glass" onClick={() => setInfo((v) => !v)}>
                {info ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
              </IconButton>
              <Dialog.Close asChild>
                <IconButton label="Fermer" kbd="Échap" tone="glass">
                  <X className="size-4" />
                </IconButton>
              </Dialog.Close>
            </div>

            <div
              className={cx("relative min-h-0 flex-1", zoom ? "overflow-auto" : "grid place-items-center overflow-hidden px-16 pb-8")}
              onClick={(e) => e.target === e.currentTarget && close()}
            >
              {isVideo ? (
                <video
                  key={asset.id}
                  ref={videoRef}
                  src={asset.url}
                  poster={asset.thumb_url}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="max-h-full max-w-full animate-fade rounded-lg bg-black shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
                  style={{ maxHeight: "calc(100vh - 7.5rem)" }}
                />
              ) : (
              <img
                key={asset.id}
                src={asset.url}
                alt={prompt ?? ""}
                onClick={() => setZoom((z) => !z)}
                className={cx(
                  "animate-fade select-none",
                  zoom ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in rounded-lg object-contain shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]",
                )}
                style={zoom ? undefined : { maxHeight: "calc(100vh - 7.5rem)" }}
              />
              )}
              {index > 0 && (
                <NavArrow side="left" onClick={() => setIndex(index - 1)} />
              )}
              {index < items.length - 1 && <NavArrow side="right" onClick={() => setIndex(index + 1)} />}
            </div>

            {items.length > 1 && (
              <div className="flex shrink-0 justify-center gap-1.5 overflow-x-auto px-4 pb-4">
                {items.map((it, i) => (
                  <button
                    key={it.id}
                    onClick={() => setIndex(i)}
                    className={cx("size-12 shrink-0 overflow-hidden rounded-md ring-2 transition", i === index ? "ring-[var(--safe)]" : "opacity-50 ring-transparent hover:opacity-90")}
                  >
                    <img src={it.thumb_url} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {info && (
            <aside className="flex w-[320px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-white/10 bg-white/[0.03] p-5 animate-fade">
              {prompt && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/45">Prompt</span>
                    <button onClick={() => copy(prompt)} className="rounded p-1 text-white/50 hover:text-white" aria-label="Copier le prompt">
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-white/90">{prompt}</p>
                </section>
              )}
              <section>
                <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/45">Détails</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                  {model && <Row k="Modèle" v={model.name} />}
                  {asset.kind === "upload" && <Row k="Fichier" v={asset.original_name ?? (isVideo ? "vidéo importée" : "image importée")} />}
                  {isVideo && asset.duration != null && <Row k="Durée" v={formatSeconds(asset.duration)} mono />}
                  {isVideo && asset.fps ? <Row k="Cadence" v={`${asset.fps} i/s`} mono /> : null}
                  {asset.width && <Row k="Taille" v={`${asset.width} × ${asset.height} px`} mono />}
                  {asset.seed != null && <Row k="Graine" v={String(asset.seed)} mono copyable help={HELP.seed} />}
                  {meta.steps && <Row k="Étapes" v={String(meta.steps)} mono help={HELP.steps} />}
                  {meta.guidance != null && <Row k="Guidance" v={String(meta.guidance)} mono help={HELP.guidance} />}
                  {meta.strength != null && <Row k="Influence" v={String(meta.strength)} mono help={isVideo ? HELP.strength_video : HELP.strength} />}
                  {meta.seconds && !isVideo && <Row k="Durée" v={formatDuration(meta.seconds)} mono />}
                  <Row k="Date" v={`${formatDay(asset.created_at)}, ${formatTime(asset.created_at)}`} />
                </dl>
              </section>
              <div className="mt-auto flex flex-col gap-2">
                {asset.conversation_id && (
                  <Button
                    variant="secondary"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => {
                      close();
                      navigate(paths.conversation(asset.conversation_id!));
                    }}
                  >
                    <MessageSquare className="size-4" /> Ouvrir la conversation
                  </Button>
                )}
                {asset.kind === "generated" && (
                  <Button variant="danger" onClick={remove}>
                    <Trash2 className="size-4" /> {isVideo ? "Supprimer la vidéo" : "Supprimer l'image"}
                  </Button>
                )}
              </div>
            </aside>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ k, v, mono, copyable, help }: { k: string; v: string; mono?: boolean; copyable?: boolean; help?: Help }) {
  return (
    <>
      <dt className="flex items-center gap-1 text-white/45">{k}{help && <InfoTip {...help} side="left" className="text-white/40 hover:text-white" />}</dt>
      <dd className={cx("min-w-0 truncate text-white/90", mono && "font-mono text-[12.5px]")}>
        {copyable ? (
          <button onClick={() => copy(v)} className="hover:text-[var(--safe)]" title="Copier">
            {v}
          </button>
        ) : (
          v
        )}
      </dd>
    </>
  );
}

function NavArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Précédente" : "Suivante"}
      className={cx(
        "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/5 text-white/70 backdrop-blur transition hover:bg-white/15 hover:text-white",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      {side === "left" ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
    </button>
  );
}
