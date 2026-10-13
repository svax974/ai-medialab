// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { forwardRef, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Download, ExternalLink, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, type HubResult, type ModelKind } from "../lib/api";
import { cx } from "../lib/format";
import { keys, queryClient } from "../lib/queries";
import { useStore } from "../lib/store";
import { Button, Spinner } from "./ui";

const gb = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)).replace(".", ",");
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));

const TASK_LABEL: Record<HubResult["task"], string> = { image: "image", tts: "synthèse vocale", stt: "transcription", video: "vidéo" };

const HELP: Record<ModelKind, string> = {
  image: "Stable Diffusion / SDXL (diffusers) et autres quantifications GGUF de Z-Image et Qwen Image.",
  audio: "Variantes de Qwen3-TTS (voix, création de voix, clonage) et modèles Whisper pour faster-whisper.",
  video: "Modèles de génération vidéo (texte, image ou vidéo vers vidéo) dans un format que l'application sait exécuter.",
};

/** Hugging Face search, limited to formats the app can run. */
export const HubSearch = forwardRef<HTMLInputElement, { kind: ModelKind }>(function HubSearch({ kind }, inputRef) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setOpened(null), [kind, q]);
  const search = useQuery({ queryKey: ["hub", kind, q], queryFn: () => api.hubSearch(kind, q), staleTime: 60_000, retry: false });

  return (
    <section className="rounded-2xl border border-line bg-surface-2/50 p-4">
      <div className="eyebrow mb-1">Chercher sur Hugging Face</div>
      <p className="mb-3 text-[12px] leading-snug text-faint">{HELP[kind]} Seuls les formats compatibles sont listés.</p>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "image" ? "ex. sdxl turbo, dreamshaper, z-image…" : kind === "video" ? "ex. wan, ltx video…" : "ex. qwen3 tts, whisper large…"}
          className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-9 text-[13.5px] text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        {search.isFetching && <Spinner className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2" />}
      </label>

      <div className="mt-3 space-y-1.5">
        {search.isError && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /> {(search.error as Error).message}
          </div>
        )}
        {search.data?.length === 0 && <p className="py-2 text-[12.5px] text-muted">Aucun modèle compatible pour cette recherche.</p>}
        {search.data?.map((r) => (
          <Result key={r.repo} r={r} open={opened === r.repo} onToggle={() => setOpened(opened === r.repo ? null : r.repo)} />
        ))}
      </div>
    </section>
  );
});

function Result({ r, open, onToggle }: { r: HubResult; open: boolean; onToggle: () => void }) {
  return (
    <div className={cx("rounded-xl border bg-surface/60 transition-colors", open ? "border-line-strong" : "border-line", !r.compatible && "opacity-75")}>
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <ChevronRight className={cx("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] text-ink">{r.repo}</div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-faint">
            <span className="rounded-md bg-surface px-1.5 py-px text-muted ring-1 ring-line">{r.family_label}</span>
            <span>{TASK_LABEL[r.task]}</span>
            <span>· {compact(r.downloads)} téléch.</span>
            {r.already && <span className="text-ok">· déjà dans la liste</span>}
            {!r.compatible && <span className="text-warn">· incompatible avec cette machine</span>}
          </div>
        </div>
      </button>
      {open && <Detail r={r} />}
    </div>
  );
}

function Detail({ r }: { r: HubResult }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["hub-inspect", r.repo], queryFn: () => api.hubInspect(r.repo), staleTime: 300_000, retry: false });
  const [pick, setPick] = useState<string | null>(null);
  const setDownload = useStore((s) => s.setDownload);
  const add = useMutation({
    mutationFn: async (option: string) => {
      const { model_id } = await api.addCustomModel(r.repo, option);
      await queryClient.invalidateQueries({ queryKey: keys.models });
      return api.downloadModel(model_id).then(setDownload).catch((e) => toast.error((e as Error).message));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const options = data?.options ?? [];
  // Default pick: a variant this machine can run (Q4_K if possible), never one it cannot.
  const runnable = options.filter((o) => o.fits !== false);
  const pool = runnable.length ? runnable : options;
  const chosen = options.find((o) => o.key === pick) ?? (pool.length ? (pool.find((o) => /^Q4_K/.test(o.label)) ?? pool[Math.floor(pool.length / 2)]) : null);
  const blocked = !data?.compatible || chosen?.fits === false;

  return (
    <div className="space-y-2.5 border-t border-line px-3 pb-3 pt-2.5">
      {isLoading && <div className="flex items-center gap-2 text-[12.5px] text-muted"><Spinner className="size-4" /> Lecture du dépôt…</div>}
      {error && (
        <div className="flex items-start gap-2 text-[12.5px] leading-snug text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {(error as Error).message}
        </div>
      )}
      {data && chosen && (
        <>
          {options.length > 1 && (
            <div>
              <div className="mb-1.5 text-[11.5px] text-muted">Quantification</div>
              <div className="flex flex-wrap gap-1">
                {options.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setPick(o.key)}
                    className={cx(
                      "rounded-md px-2 py-1 font-mono text-[11px] ring-1 transition-colors",
                      o.key === chosen.key ? "bg-safe-soft text-ink ring-safe/50" : "bg-surface text-muted ring-line hover:text-ink",
                      o.fits === false && "opacity-60 line-through decoration-warn/60",
                    )}
                    title={o.fit_note || undefined}
                  >
                    {o.label} <span className="text-faint">{gb(o.size_gb)} Go</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
            <span>précision <b className="font-normal text-ink-2">{chosen.precision || "?"}</b></span>
            <span>≈ {gb(chosen.size_gb)} Go{data.template ? " (fichier de diffusion)" : ""}</span>
            <span>licence <b className="font-normal text-ink-2">{data.license || "voir le dépôt"}</b></span>
          </div>
          {data.notes.map((n) => <p key={n} className="text-[12px] leading-snug text-faint">{n}</p>)}
          {data.compatible && chosen.fit_note && (
            <p className={cx("flex items-start gap-2 text-[12px] leading-snug", chosen.fits === false ? "text-warn" : "text-muted")}>
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {chosen.fit_note}
            </p>
          )}
          {!data.compatible && (
            <p className="flex items-start gap-2 text-[12px] leading-snug text-warn">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {data.reason || "Ce modèle ne peut pas tourner sur cette machine."}
            </p>
          )}
          <div className="flex items-center gap-2">
            {r.already ? (
              <span className="flex items-center gap-1 text-[12.5px] text-ok"><Check className="size-3.5" /> Déjà dans la liste</span>
            ) : (
              <Button variant="primary" disabled={add.isPending || blocked} onClick={() => add.mutate(chosen.key)}>
                {add.isPending ? <Spinner /> : <Download className="size-4" />}
                Ajouter et télécharger
              </Button>
            )}
            <a href={`https://huggingface.co/${r.repo}`} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-[12px] text-muted hover:text-ink">
              <ExternalLink className="size-3.5" /> Hugging Face
            </a>
          </div>
        </>
      )}
    </div>
  );
}

