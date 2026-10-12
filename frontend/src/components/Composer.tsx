// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Info, Paperclip, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Asset, type ModelInfo } from "../lib/api";
import { effectiveParams, registerComposer, uploadFiles } from "../lib/composer";
import { cx } from "../lib/format";
import { keys, queryClient, upsertMessage, useActiveModel, useModels } from "../lib/queries";
import { navigate, paths } from "../lib/router";
import { useStore } from "../lib/store";
import { AspectPicker } from "./AspectPicker";
import { ModelPicker } from "./ModelPicker";
import { SetupPrompt, useWelcomeModel } from "./Setup";
import { ParamsPopover } from "./ParamsPopover";
import { HELP } from "../lib/help";
import { HelpBody, Spinner, Tip } from "./ui";

export function Composer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const model = useActiveModel();
  const { isError } = useModels();
  if (!model) {
    return (
      <div className="panel flex h-28 items-center justify-center rounded-3xl text-sm text-muted">
        {isError ? "Serveur injoignable — le backend est-il démarré ?" : <Spinner />}
      </div>
    );
  }
  return <ComposerInner model={model} conversationId={conversationId} hero={hero} />;
}

function ComposerInner({ model, conversationId, hero }: { model: ModelInfo; conversationId: string | null; hero: boolean }) {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const references = useStore((s) => s.references);
  const uploading = useStore((s) => s.uploading);
  const removeReference = useStore((s) => s.removeReference);
  const clearReferences = useStore((s) => s.clearReferences);
  const stored = useStore((s) => s.paramsByModel[model.id]);
  const setParams = useStore((s) => s.setParams);
  const count = useStore((s) => s.count);
  const setCount = useStore((s) => s.setCount);
  const seed = useStore((s) => s.seed);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const welcomeShown = !!useWelcomeModel(); // the welcome screen already shows this model's install card
  const hasRefs = references.length > 0;
  const setModel = useStore((st) => st.setModel);
  const params = effectiveParams(model, stored, hasRefs);

  useEffect(() => {
    registerComposer(textareaRef.current);
    return () => registerComposer(null);
  }, []);

  // Auto-grow the textarea.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [prompt]);

  // A model that accepts all attached images: ready ones first, then installable, lightest first.
  const { data: catalog } = useModels();
  const multiAlternative = (catalog?.models ?? [])
    .filter((m) => m.id !== model.id && m.reference_mode === "multi" && m.compatible && m.max_references >= references.length)
    .sort((a, b) => Number(b.ready) - Number(a.ready) || (a.download_size_gb ?? 0) - (b.download_size_gb ?? 0))[0];
  const switchAction = multiAlternative
    ? { label: `Passer à ${multiAlternative.name} (${BACKENDS[multiAlternative.backend]})`, run: () => setModel(multiAlternative.id) }
    : undefined;

  // Model constraints on reference images.
  const notices: { tone: "warn" | "info"; text: string; action?: { label: string; run: () => void } }[] = [];
  if (model.requires_references && !hasRefs)
    notices.push({ tone: "warn", text: `${model.name} modifie des images existantes : ajoutez au moins une image de référence.` });
  if (model.reference_mode === "none" && hasRefs)
    notices.push({ tone: "warn", text: `${model.name} n'utilise pas les images de référence.`, action: switchAction });
  if (model.reference_mode === "init" && references.length > 1)
    notices.push({
      tone: "warn",
      text: `${model.name} part d'une seule image (img2img) : seule la 1re sera utilisée. Pour combiner plusieurs images, il faut un modèle d'édition.`,
      action: switchAction,
    });
  if (model.reference_mode === "multi" && references.length > model.max_references)
    notices.push({ tone: "info", text: `${model.name} accepte ${model.max_references} images au plus : les suivantes seront ignorées.` });
  const notReady = !model.ready;
  if (!model.compatible)
    notices.push({ tone: "warn", text: model.engine_reason || model.plan.note || `${model.name} ne peut pas tourner sur cette machine.` });
  else if (model.plan.note && model.plan.strategy !== "full")
    notices.push({ tone: "info", text: model.plan.note });

  const blocked = (model.requires_references && !hasRefs) || notReady || !model.compatible;
  const canSend = prompt.trim().length > 0 && !blocked && uploading.length === 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await api.send({
        conversation_id: conversationId,
        prompt: prompt.trim(),
        model_id: model.id,
        params: { ...params, seed },
        reference_ids: references.map((r) => r.id),
        count,
      });
      setPrompt("");
      clearReferences();
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

  const refIndexNote = (i: number) => {
    if (model.reference_mode === "none") return "ignorée";
    if (model.reference_mode === "init") return i === 0 ? "départ" : "ignorée";
    return i < model.max_references ? `image ${i + 1}` : "ignorée";
  };

  const refNoteHelp = (m: ModelInfo, i: number) => {
    if (m.reference_mode === "none") return `${m.name} n'utilise pas les images de référence : celle-ci n'aura aucun effet.`;
    if (m.reference_mode === "init") return i === 0 ? "Image de départ : le modèle la transforme selon votre prompt (img2img)." : "Ignorée : ce modèle ne part que d'une seule image, la 1re.";
    return i < m.max_references ? `Image ${i + 1} : désignez-la ainsi dans le prompt.` : `Ignorée : ce modèle accepte ${m.max_references} images au plus.`;
  };

  return (
    <div
      className={cx(
        "panel group/composer relative rounded-[22px] transition-[border-color,box-shadow] focus-within:border-line-strong",
        hero && "shadow-[0_30px_80px_-30px_var(--safe-glow)]",
      )}
    >
      {(references.length > 0 || uploading.length > 0) && (
        <div className="flex gap-2.5 overflow-x-auto px-3.5 pt-3.5">
          {references.map((r, i) => (
            <RefThumb key={r.id} asset={r} note={refIndexNote(i)} help={refNoteHelp(model, i)} dimmed={refIndexNote(i) === "ignorée"} onRemove={() => removeReference(r.id)} />
          ))}
          {uploading.map((u) => (
            <div key={u.tempId} className="relative size-[72px] shrink-0 overflow-hidden rounded-xl ring-1 ring-line">
              <img src={u.previewUrl} alt="" className="size-full object-cover opacity-40" />
              <div className="absolute inset-0 grid place-items-center text-ink">
                <Spinner />
              </div>
            </div>
          ))}
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
            uploadFiles(files);
          }
        }}
        placeholder={placeholderFor(model, hasRefs)}
        className="block w-full resize-none bg-transparent px-4.5 pb-2 pt-4 text-[15.5px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
      />

      {model.compatible && !model.ready && !(hero && welcomeShown) && <SetupPrompt model={model} />}

      {notices.length > 0 && (
        <div className="space-y-1 px-4.5 pb-1">
          {notices.map((n) => (
            <div key={n.text} className={cx("flex items-start gap-1.5 text-[12px] leading-snug", n.tone === "warn" ? "text-warn" : "text-muted")}>
              {n.tone === "warn" ? (
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
              ) : (
                <Info className="mt-px size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1">{n.text}</span>
              {n.action && (
                <button
                  onClick={n.action.run}
                  className="shrink-0 rounded-lg bg-safe px-2.5 py-1 text-[11.5px] font-medium text-safe-ink hover:brightness-110"
                >
                  {n.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5 pt-1.5">
        <Tip
          wide
          label={<HelpBody title="Joindre des images" body={`Clic, glisser-déposer ou coller (⌘V).\n\n${HELP.reference_images.body}`} tip={HELP.reference_images.tip} />}
        >
          <button
            onClick={() => fileRef.current?.click()}
            className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink"
            aria-label="Joindre des images"
          >
            <Paperclip className="size-4" />
          </button>
        </Tip>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <ModelPicker model={model} />
        <AspectPicker model={model} params={params} reference={references[0]} onChange={(p) => setParams(model.id, p)} />
        <ParamsPopover model={model} params={params} hasRefs={hasRefs} onChange={(p) => setParams(model.id, p)} />
        <CountPicker value={count} onChange={setCount} />

        <div className="flex-1" />
        <span className="hidden pr-1 text-[11px] text-faint lg:inline">⇧↵ nouvelle ligne</span>
        <Tip label={notReady && model.compatible ? "À installer avant de générer" : !model.compatible ? "Modèle incompatible avec cette machine" : blocked ? "Ajoutez une image de référence" : "Générer"} kbd="↵">
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Générer"
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

const BACKENDS: Record<string, string> = { mlx: "MLX", torch: "PyTorch", sdcpp: "GGUF", demo: "démo" };

function placeholderFor(model: ModelInfo, hasRefs: boolean) {
  if (!hasRefs) {
    return model.requires_references
      ? "Ajoutez une image, puis décrivez la modification…"
      : "Décrivez l'image à révéler… (lumière, sujet, style, cadrage)";
  }
  if (model.reference_mode === "multi") return "Décrivez la modification ou la composition… ex. « Place la personne de l'image 1 dans le décor de l'image 2 »";
  if (model.reference_mode === "init") return "Décrivez l'image à obtenir à partir de l'image de départ…";
  return "Décrivez l'image à révéler…";
}

function RefThumb({ asset, note, help, dimmed, onRemove }: { asset: Asset; note: string; help: string; dimmed: boolean; onRemove: () => void }) {
  return (
    <div className="group/ref relative shrink-0 animate-rise">
      <div className={cx("size-[72px] overflow-hidden rounded-xl ring-1 ring-line-strong", dimmed && "opacity-35 grayscale")}>
        <img src={asset.thumb_url} alt={asset.original_name ?? ""} className="size-full object-cover" />
      </div>
      <Tip wide label={help}>
        <span className="absolute bottom-1 left-1 cursor-help rounded-md bg-black/65 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wide text-white/90 backdrop-blur">
          {note}
        </span>
      </Tip>
      <button
        onClick={onRemove}
        aria-label="Retirer l'image"
        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line-strong bg-surface-3 text-ink-2 opacity-0 shadow transition-opacity hover:text-ink group-hover/ref:opacity-100 focus:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function CountPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Tip wide label={<HelpBody {...HELP.count_images} />}>
      <div role="group" aria-label="Nombre d'images" className="flex h-8 items-center rounded-lg border border-line bg-surface-2 p-0.5">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cx(
              "h-full w-6 rounded-md font-mono text-[12px] transition-colors",
              value === n ? "bg-surface-3 text-ink shadow-sm" : "text-faint hover:text-ink",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </Tip>
  );
}
