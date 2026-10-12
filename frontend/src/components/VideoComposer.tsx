// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Slider from "@radix-ui/react-slider";
import { ArrowUp, Clock, Film, ImagePlus, Info, Paperclip, Ratio, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Asset, type ModelInfo } from "../lib/api";
import { registerComposer } from "../lib/composer";
import { cx, formatSeconds } from "../lib/format";
import { keys, queryClient, upsertMessage, useActiveModel, useModels } from "../lib/queries";
import { navigate, paths } from "../lib/router";
import { ratioOf } from "../lib/size";
import { useStore, type VideoSlot, type VideoUpload } from "../lib/store";
import {
  VIDEO_ASPECTS, effectiveVideoParams, frameCount, importVideoFiles, setDropSlot, videoSize,
} from "../lib/video";
import { ModelPicker } from "./ModelPicker";
import { ParamsPopover } from "./ParamsPopover";
import { SetupPrompt, useWelcomeModel } from "./Setup";
import { GatedNotice, LicenseWarning } from "./VideoInfo";
import { HELP, slotHelp } from "../lib/help";
import { type Help, HelpBody, InfoTip, Spinner, Tip } from "./ui";

export function VideoComposer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const model = useActiveModel("video");
  const { isError } = useModels();
  if (!model || !model.video) {
    return (
      <div className="panel flex h-28 items-center justify-center rounded-3xl text-sm text-muted">
        {isError ? "Serveur injoignable — le backend est-il démarré ?" : <Spinner />}
      </div>
    );
  }
  return <Inner model={model} conversationId={conversationId} hero={hero} />;
}

function Inner({ model, conversationId, hero }: { model: ModelInfo; conversationId: string | null; hero: boolean }) {
  const caps = model.video!;
  const prompt = useStore((s) => s.videoPrompt);
  const setPrompt = useStore((s) => s.setVideoPrompt);
  const start = useStore((s) => s.videoStart);
  const end = useStore((s) => s.videoEnd);
  const source = useStore((s) => s.videoSource);
  const uploads = useStore((s) => s.videoUploads);
  const clearSlots = useStore((s) => s.clearVideoSlots);
  const stored = useStore((s) => s.paramsByModel[model.id]);
  const setParams = useStore((s) => s.setParams);
  const count = useStore((s) => s.videoCount);
  const setCount = useStore((s) => s.setVideoCount);
  const seed = useStore((s) => s.seed);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const welcomeShown = !!useWelcomeModel("video");

  const params = effectiveVideoParams(model, stored);
  const editing = !!source && caps.video_input !== "none";

  useEffect(() => {
    registerComposer(textareaRef.current);
    return () => registerComposer(null);
  }, []);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [prompt]);

  // Slots the model can use, plus any that still hold something (so it can be removed).
  const upload = (slot: VideoSlot) => uploads.find((u) => u.slot === slot);
  const showStart = caps.image_input !== "none" || !!start || !!upload("start");
  const showEnd = caps.last_frame || !!end || !!upload("end");
  const showSource = caps.video_input !== "none" || !!source || !!upload("source");

  const reference = caps.image_role === "reference";
  const needStart = caps.image_input === "required" && !start && !source;
  const needSource = caps.video_input === "required" && !source;
  const endWithoutStart = caps.last_frame && !!end && !start;
  const notReady = !model.ready;
  const blocked = needStart || needSource || endWithoutStart || notReady || !model.compatible;
  const canSend = prompt.trim().length > 0 && !blocked && uploads.length === 0 && !sending;

  const notices: { tone: "warn" | "info"; text: string; help?: Help }[] = [];
  if (!model.compatible) notices.push({ tone: "warn", text: model.engine_reason || model.plan.note || `${model.name} ne peut pas tourner sur cette machine.` });
  else if (model.plan.note) notices.push({ tone: "info", text: model.plan.note });
  if (needSource) notices.push({ tone: "warn", text: `${model.name} modifie une vidéo existante : ajoutez la vidéo source à modifier.` });
  if (needStart) notices.push({ tone: "warn", text: `${model.name} part d'une image : ajoutez l'image de départ.` });
  if (endWithoutStart) notices.push({ tone: "warn", text: "Ajoutez aussi l'image de départ : l'image de fin seule ne suffit pas." });
  if (start && caps.image_input === "none") notices.push({ tone: "warn", text: `${model.name} n'utilise pas d'image de départ : elle sera ignorée.` });
  if (end && !caps.last_frame) notices.push({ tone: "warn", text: `${model.name} n'utilise pas d'image de fin : elle sera ignorée.` });
  if (source && caps.video_input === "none") notices.push({ tone: "warn", text: `${model.name} ne sait pas monter une vidéo : la vidéo source sera ignorée.` });
  if (caps.english_only) notices.push({ tone: "info", text: `${model.name} comprend surtout l'anglais : rédigez le prompt en anglais pour un meilleur résultat.`, help: HELP.english_only });
  if (caps.audio_out) notices.push({ tone: "info", text: `${model.name} génère aussi une bande son.`, help: HELP.audio_out });

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const body = { ...params, seed } as Record<string, unknown>;
      // Parameters that only make sense when editing a video (e.g. strength).
      if (!editing) model.params.filter((p) => p.requires_references).forEach((p) => delete body[p.key]);
      const refs: string[] = [];
      if (start && caps.image_input !== "none") refs.push(start.id);
      if (end && start && caps.last_frame) refs.push(end.id);
      if (source && caps.video_input !== "none") refs.push(source.id);
      const res = await api.send({
        conversation_id: conversationId,
        prompt: prompt.trim(),
        model_id: model.id,
        params: body,
        reference_ids: refs,
        count: Math.min(2, count),
      });
      setPrompt("");
      clearSlots();
      if (conversationId) {
        upsertMessage(res.user_message);
        upsertMessage(res.assistant_message);
      } else {
        await queryClient.prefetchQuery({ queryKey: keys.conversation(res.conversation_id), queryFn: () => api.conversation(res.conversation_id) });
        navigate(paths.conversation(res.conversation_id));
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const placeholder = editing
    ? "Décrivez la modification de la vidéo… ex. « Passe la scène de nuit, sous la pluie »"
    : start
      ? "Décrivez le mouvement à partir de l'image… (action, caméra, ambiance)"
      : "Décrivez la scène à filmer… (sujet, action, mouvement de caméra, lumière)";

  return (
    <div
      className={cx(
        "panel group/composer relative rounded-[22px] transition-[border-color,box-shadow] focus-within:border-line-strong",
        hero && "shadow-[0_30px_80px_-30px_var(--safe-glow)]",
      )}
    >
      {(showStart || showEnd || showSource) && (
        <div className="flex gap-2.5 overflow-x-auto px-3.5 pt-3.5">
          {showSource && (
            <SlotTile slot="source" help={slotHelp("source", caps)} label="Vidéo source" short="source" required={caps.video_input === "required"} asset={source} upload={upload("source")} unused={caps.video_input === "none"} />
          )}
          {showStart && (
            <SlotTile slot="start" help={slotHelp("start", caps)} label={reference ? "Image de référence" : "Image de départ"} short={reference ? "réf." : "départ"} required={caps.image_input === "required" && !source} asset={start} upload={upload("start")} unused={caps.image_input === "none"} />
          )}
          {showEnd && (
            <SlotTile slot="end" help={slotHelp("end", caps)} label="Image de fin" short="fin" required={false} asset={end} upload={upload("end")} unused={!caps.last_frame} />
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={prompt}
        rows={hero ? 3 : 1}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            importVideoFiles(files);
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent px-4.5 pb-2 pt-4 text-[15.5px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
      />

      {model.compatible && !model.ready && !(hero && welcomeShown) && <SetupPrompt model={model} />}

      {caps.license_warning && <LicenseWarning model={model} className="mx-4 mb-1.5" />}
      <GatedNotice model={model} className="mx-4 mb-1.5" />

      {notices.length > 0 && (
        <div className="space-y-1 px-4.5 pb-1">
          {notices.map((n) => (
            <div key={n.text} className={cx("flex items-start gap-1.5 text-[12px] leading-snug", n.tone === "warn" ? "text-warn" : "text-muted")}>
              {n.tone === "warn" ? <TriangleAlert className="mt-px size-3.5 shrink-0" /> : <Info className="mt-px size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1">{n.text}</span>
              {n.help && <InfoTip {...n.help} />}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5 pt-1.5">
        <Tip wide label={<HelpBody title="Joindre une image ou une vidéo" body="Clic, glisser-déposer ou coller (⌘V). Les emplacements au-dessus du prompt indiquent ce que le modèle accepte : image de départ, image de fin, vidéo source. Un fichier déposé sur un emplacement précis y est rangé ; sinon il est rangé automatiquement." />}>
          <button
            onClick={() => fileRef.current?.click()}
            className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink"
            aria-label="Joindre une image ou une vidéo"
          >
            <Paperclip className="size-4" />
          </button>
        </Tip>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.mov,.mp4,.webm"
          multiple
          hidden
          onChange={(e) => {
            importVideoFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <ModelPicker model={model} />
        <DurationPicker model={model} seconds={Number(params.seconds)} onChange={(seconds) => setParams(model.id, { seconds })} />
        <FormatPicker model={model} aspect={String(params.aspect)} resolution={String(params.resolution)} onChange={(p) => setParams(model.id, p)} />
        <ParamsPopover model={model} params={params} hasRefs={editing} onChange={(p) => setParams(model.id, p)} />
        <CountPicker value={Math.min(2, count)} onChange={setCount} />

        <div className="flex-1" />
        <span className="hidden pr-1 text-[11px] text-faint lg:inline">⇧↵ nouvelle ligne</span>
        <Tip
          label={
            notReady && model.compatible ? "À installer avant de générer"
              : !model.compatible ? "Modèle incompatible avec cette machine"
                : needSource ? "Ajoutez la vidéo à modifier"
                  : needStart || endWithoutStart ? "Ajoutez l'image de départ"
                    : uploads.length ? "Import en cours…" : "Générer la vidéo"
          }
          kbd="↵"
        >
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Générer la vidéo"
            className={cx(
              "grid size-9 place-items-center rounded-xl transition-all",
              canSend ? "bg-safe text-safe-ink shadow-[0_0_24px_-4px_var(--safe-glow)] hover:brightness-110" : "bg-surface-3 text-faint",
            )}
          >
            {sending ? <Spinner /> : <ArrowUp className="size-[18px]" strokeWidth={2.4} />}
          </button>
        </Tip>
      </div>
    </div>
  );
}

// --- Input slots ---

const ACCEPT: Record<VideoSlot, string> = {
  source: "video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.mov,.mp4,.webm",
  start: "image/*",
  end: "image/*",
};

function SlotTile({
  slot, help, label, short, required, asset, upload, unused,
}: { slot: VideoSlot; help: Help; label: string; short: string; required: boolean; asset: Asset | null; upload?: VideoUpload; unused: boolean }) {
  const setSlot = useStore((s) => s.setVideoSlot);
  const openLightbox = useStore((s) => s.openLightbox);
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const Icon = slot === "source" ? Film : ImagePlus;

  const drag = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDropSlot(slot);
      setOver(true);
    },
    onDragLeave: () => {
      setOver(false);
      setDropSlot(undefined);
    },
    onDrop: () => setOver(false),
  };

  if (upload) {
    return (
      <div className="relative flex size-[72px] shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-tray ring-1 ring-line" title={upload.name}>
        <Spinner className="size-4 text-safe" />
        <span className="font-mono text-[10px] tabular-nums text-ink-2">{Math.round(upload.progress * 100)} %</span>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/30">
          <div className="h-full bg-safe transition-[width] duration-200" style={{ width: `${upload.progress * 100}%` }} />
        </div>
      </div>
    );
  }

  if (asset) {
    return (
      <div className="group/ref relative shrink-0 animate-rise" {...drag}>
        <button
          onClick={() => openLightbox([asset], 0)}
          aria-label={`Voir : ${label}`}
          className={cx("block size-[72px] overflow-hidden rounded-xl ring-1 ring-line-strong", unused && "opacity-35 grayscale", over && "ring-2 ring-safe")}
        >
          <img src={asset.thumb_url} alt={asset.original_name ?? ""} className="size-full object-cover" />
        </button>
        <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wide text-white/90 backdrop-blur">
          {slot === "source" && <Film className="size-2.5" />}
          {unused ? "ignorée" : short}
        </span>
        <button
          onClick={() => setSlot(slot, null)}
          aria-label={`Retirer : ${label}`}
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line-strong bg-surface-3 text-ink-2 opacity-0 shadow transition-opacity hover:text-ink focus:opacity-100 group-hover/ref:opacity-100"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <>
      <Tip wide label={<HelpBody {...help} title={`${label}${required ? " (requise)" : " (facultative)"}`} tip={help.tip ?? "cliquez, glissez-déposez ou collez un fichier."} />}>
        <button
          onClick={() => fileRef.current?.click()}
          {...drag}
          className={cx(
            "flex size-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted transition-colors hover:border-safe/60 hover:text-ink",
            required ? "border-warn/60 text-warn" : "border-line-strong",
            over && "border-safe bg-safe-soft text-ink",
          )}
        >
          <Icon className="size-4" />
          <span className="text-[10px] leading-none">{short}</span>
          <span className="font-mono text-[8.5px] uppercase leading-none tracking-wide opacity-70">{required ? "requis" : "option"}</span>
        </button>
      </Tip>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT[slot]}
        hidden
        onChange={(e) => {
          importVideoFiles(Array.from(e.target.files ?? []), slot);
          e.target.value = "";
        }}
      />
    </>
  );
}

// --- Pickers ---

function DurationPicker({ model, seconds, onChange }: { model: ModelInfo; seconds: number; onChange: (s: number) => void }) {
  const caps = model.video!;
  const frames = frameCount(seconds, caps);
  const note = frames / caps.fps;
  return (
    <Popover.Root>
      <Tip wide label={<HelpBody {...HELP.seconds} />}>
        <Popover.Trigger asChild>
          <button
            aria-label="Durée du clip"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:text-ink"
          >
            <Clock className="size-3.5" />
            <span className="font-mono text-[12px]">{formatSeconds(seconds)}</span>
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content collisionPadding={12} side="top" align="start" sideOffset={8} className="menu w-[320px] p-3.5">
          <div className="eyebrow mb-3 flex items-center gap-1.5">Durée <InfoTip {...HELP.seconds} /></div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[22px] text-ink">{formatSeconds(seconds)}</span>
            <span className="font-mono text-[11px] text-faint">{frames} images · {caps.fps} i/s</span>
          </div>
          <Slider.Root
            className="relative flex h-4 touch-none select-none items-center"
            min={caps.min_seconds}
            max={Math.max(caps.max_seconds, caps.min_seconds + 0.5)}
            step={0.5}
            value={[seconds]}
            onValueChange={([v]) => onChange(v)}
          >
            <Slider.Track className="relative h-1 grow rounded-full bg-surface-3">
              <Slider.Range className="absolute h-full rounded-full bg-safe" />
            </Slider.Track>
            <Slider.Thumb
              aria-label="Durée en secondes"
              className="block size-3.5 rounded-full border-2 border-safe bg-surface shadow transition-transform hover:scale-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-safe-soft"
            />
          </Slider.Root>
          <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-faint">
            <span>{formatSeconds(caps.min_seconds)}</span>
            <span>{formatSeconds(caps.max_seconds)}</span>
          </div>
          {Math.abs(note - seconds) > 0.05 && (
            <p className="mt-2 text-[11px] leading-snug text-faint">Le modèle calcule des clips par paliers : durée réelle ≈ {formatSeconds(note)}.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Shape({ ratio, active }: { ratio: number; active: boolean }) {
  const w = ratio >= 1 ? 22 : 22 * ratio;
  const h = ratio >= 1 ? 22 / ratio : 22;
  return (
    <span className="grid size-6 place-items-center">
      <span style={{ width: w, height: h }} className={cx("rounded-[3px] border-[1.5px] transition-colors", active ? "border-safe bg-safe-soft" : "border-current")} />
    </span>
  );
}

function FormatPicker({
  model, aspect, resolution, onChange,
}: { model: ModelInfo; aspect: string; resolution: string; onChange: (patch: { aspect?: string; resolution?: string }) => void }) {
  const caps = model.video!;
  const res = caps.resolutions.find((r) => r.id === resolution);
  const size = videoSize(aspect, res);
  return (
    <Popover.Root>
      <Tip wide label={<HelpBody {...HELP.resolution} title="Format et définition" />}>
      <Popover.Trigger asChild>
        <button
          aria-label="Format et définition"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:text-ink"
        >
          <Ratio className="size-3.5" />
          <span>{aspect}</span>
          {res && <span className="hidden font-mono text-[11px] text-faint sm:inline">{res.label}</span>}
        </button>
      </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content collisionPadding={12} side="top" align="start" sideOffset={8} className="menu w-[340px] p-3">
          <div className="eyebrow mb-2 flex items-center gap-1.5">Format <InfoTip {...HELP.video_aspect} /></div>
          <div className="grid grid-cols-5 gap-1.5">
            {VIDEO_ASPECTS.map((a) => (
              <button
                key={a.id}
                onClick={() => onChange({ aspect: a.id })}
                className={cx(
                  "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 transition-colors",
                  aspect === a.id ? "border-safe/60 bg-safe-soft text-ink" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                <Shape ratio={ratioOf(a.id)!} active={aspect === a.id} />
                <span className="font-mono text-[11px] leading-none">{a.id}</span>
                <span className="text-[10px] leading-none text-faint">{a.label}</span>
              </button>
            ))}
          </div>

          <div className="eyebrow mb-2 mt-4 flex items-center gap-1.5">
            Définition
            <InfoTip
              {...HELP.resolution}
              body={`${HELP.resolution.body}\n\nCe modèle : ${caps.resolutions.map((r) => `${r.label} ≈ ${r.long_side}×${r.short_side}`).join(" · ")} (format paysage).`}
            />
          </div>
          <div className="flex gap-1 rounded-xl bg-surface p-1 ring-1 ring-line">
            {caps.resolutions.map((r) => (
              <button
                key={r.id}
                onClick={() => onChange({ resolution: r.id })}
                className={cx(
                  "min-w-0 flex-1 rounded-lg px-1 py-1.5 text-[12px] transition-colors",
                  r.id === resolution ? "bg-surface-3 text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {size && (
            <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-faint">
              <span>Sortie</span>
              <span className="text-ink-2">≈ {size.width} × {size.height} px</span>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CountPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Tip wide label={<HelpBody {...HELP.count_clips} />}>
      <div role="group" aria-label="Nombre de clips" className="flex h-8 items-center rounded-lg border border-line bg-surface-2 p-0.5">
        {[1, 2].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cx("h-full w-6 rounded-md font-mono text-[12px] transition-colors", value === n ? "bg-surface-3 text-ink shadow-sm" : "text-faint hover:text-ink")}
          >
            {n}
          </button>
        ))}
      </div>
    </Tip>
  );
}
