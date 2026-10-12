// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// One-click install of the missing engine and model, with progress, cancel and readable errors.
import { useEffect, useState } from "react";
import { Check, CloudDownload, Cpu, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, type ModelInfo, type ModelKind } from "../lib/api";
import { cx, formatClock, formatDuration } from "../lib/format";
import { useActiveModel, useModels } from "../lib/queries";
import { useStore } from "../lib/store";
import { Button, Spinner } from "./ui";

export const gb = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)).replace(".", ",");
const mb = (n: number) => `${Math.round(n)} Mo`;
const bytesToGb = (b: number) => b / 1024 ** 3;

export function ProgressBar({ done, total, rate, eta, unit = "gb" }: { done: number; total: number; rate?: number; eta?: number | null; unit?: "gb" | "mb" }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const fmt = (b: number) => (unit === "mb" ? mb(b / 1e6) : `${gb(bytesToGb(b))} Go`);
  return (
    <div className="mt-3">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-safe shadow-[0_0_10px_var(--safe)] transition-[width] duration-500" style={{ width: `${Math.max(1.5, pct)}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted">
        <span>{total > 0 ? `${fmt(done)} / ${fmt(total)} · ${pct.toFixed(0)} %` : "Préparation…"}</span>
        <span>
          {rate && rate > 0 ? `${(rate / 1024 ** 2).toFixed(0)} Mo/s` : ""}
          {eta != null ? ` · ${formatDuration(eta)} restantes` : ""}
        </span>
      </div>
    </div>
  );
}

/** Bar with no known percentage (Python env install): message, detail and elapsed time. */
export function IndeterminateBar({ message, detail, since }: { message?: string; detail?: string; since?: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-3">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="absolute inset-y-0 w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full bg-safe/80 shadow-[0_0_10px_var(--safe)]" style={{ left: 0 }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-3 font-mono text-[11px] text-muted">
        <span className="min-w-0 truncate">{message || "Préparation…"}</span>
        {since ? <span className="shrink-0">{formatClock(now - since)}</span> : null}
      </div>
      {detail && <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{detail}</p>}
    </div>
  );
}

/** Installs what the model needs: the engine first if missing, then the model. */
export async function startSetup(model: ModelInfo): Promise<void> {
  const store = useStore.getState();
  try {
    if (model.needs_engine_install) {
      store.setPendingModel(model.install === "installed" ? null : model.id);
      if (model.engine_pack) store.setPackInstall(await api.installPack(model.engine_pack));
      else store.setEngineInstall(await api.installEngine());
    } else if (model.install !== "installed") {
      store.setDownload(await api.downloadModel(model.id));
    }
  } catch (e) {
    store.setPendingModel(null);
    toast.error((e as Error).message);
  }
}

/** When the engine is ready, starts downloading the requested model. */
export function SetupController() {
  const sd = useStore((s) => s.engineInstall);
  const pack = useStore((s) => s.packInstall);
  const pending = useStore((s) => s.pendingModelId);
  const setPending = useStore((s) => s.setPendingModel);
  // The relevant engine is the one working (or just done): only one installer runs at a time.
  const engine = pack.state === "running" || (sd.state === "idle" && pack.state !== "idle") ? pack : sd;

  useEffect(() => {
    if (!pending) return;
    if (engine.state === "error" || engine.state === "cancelled") return setPending(null);
    if (engine.state !== "done") return;
    setPending(null);
    (async () => {
      try {
        // Direct call: a fetchQuery on the same key would be cancelled by the invalidation this install triggers.
        const data = await api.models();
        const model = data.models.find((m) => m.id === pending);
        if (model && model.install !== "installed") useStore.getState().setDownload(await api.downloadModel(pending));
      } catch (e) {
        toast.error((e as Error).message);
      }
    })();
  }, [engine.state, pending, setPending]);
  return null;
}

/** What is missing to use this model, with a button to install it all. */
export function SetupPrompt({ model, welcome = false }: { model: ModelInfo; welcome?: boolean }) {
  const sdEngine = useStore((s) => s.engineInstall);
  const packEngine = useStore((s) => s.packInstall);
  const isPack = !!model.engine_pack;
  const engine = isPack ? (packEngine.pack === model.engine_pack ? packEngine : { state: "idle" as const }) : sdEngine;
  const dl = useStore((s) => s.downloads[model.id]);
  const pending = useStore((s) => s.pendingModelId);
  const [busy, setBusy] = useState(false);

  const needEngine = model.needs_engine_install;
  const needModel = model.install !== "installed";
  if (!needEngine && !needModel) return null;

  const installing = engine.state === "running";
  const download = dl?.state === "running" ? dl : model.download?.state === "running" ? model.download : null;
  const error =
    (engine.state === "error" && needEngine ? (engine as { error?: string | null }).error : null) ||
    (dl?.state === "error" ? dl.error : model.download?.state === "error" ? model.download.error : null);
  const modelGb = Math.max(0, (model.download_size_gb ?? 0) - model.installed_gb);
  const engineMb = model.engine_install_size_mb ?? 0;
  const packRunning = isPack && packEngine.state === "running";
  const working = installing || !!download || busy || !!pending;
  const totalLabel = [needEngine ? `moteur ${model.engine_name ? `« ${model.engine_name} » ` : ""}≈ ${mb(engineMb)}` : null, needModel ? `modèle ≈ ${gb(modelGb)} Go` : null]
    .filter(Boolean)
    .join(" + ");

  return (
    <div className={cx("rounded-2xl border px-4 py-3.5", welcome ? "border-safe/40 bg-safe-soft" : "mx-4 mb-1 border-warn/30 bg-warn/10")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {welcome ? <Sparkles className="size-4 shrink-0 text-safe" /> : <CloudDownload className="size-4 shrink-0 text-warn" />}
        <div className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
          {welcome ? (
            <>
              <b className="font-medium text-ink">Pour commencer, il manque deux ou trois choses</b> — l'application les installe
              pour vous : {totalLabel}.
            </>
          ) : (
            <>
              <b className="font-medium text-ink">« {model.name} » n'est pas encore prêt</b> : à installer {totalLabel}.
            </>
          )}
          <Steps needEngine={needEngine} engineState={engine.state} needModel={needModel} />
        </div>
        {!working && (
          <Button
            variant="primary"
            onClick={async () => {
              setBusy(true);
              await startSetup(model);
              setBusy(false);
            }}
          >
            <CloudDownload className="size-4" /> {needEngine && needModel ? "Tout installer" : needEngine ? "Installer le moteur" : "Télécharger"}
          </Button>
        )}
        {working && (
          <Button
            variant="secondary"
            onClick={() => {
              useStore.getState().setPendingModel(null);
              if (installing) (isPack ? api.cancelPackInstall() : api.cancelEngineInstall()).catch(() => {});
              else if (download) api.cancelDownload(model.id).catch(() => {});
            }}
          >
            Annuler
          </Button>
        )}
      </div>

      {installing && !isPack && <ProgressBar done={sdEngine.done ?? 0} total={sdEngine.total ?? 0} unit="mb" />}
      {installing && !isPack && engine.message && <p className="mt-1 font-mono text-[11px] text-faint">{engine.message}</p>}
      {packRunning && <IndeterminateBar message={packEngine.message} detail={packEngine.detail} since={packEngine.started_at} />}
      {download && <ProgressBar done={download.done} total={download.total} rate={download.rate} eta={download.eta} />}
      {error && !working && (
        <div className="mt-2.5 flex items-start gap-2 text-[12.5px] leading-snug text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words text-ink-2">{error}</span>
        </div>
      )}
    </div>
  );
}

function Steps({ needEngine, engineState, needModel }: { needEngine: boolean; engineState: string; needModel: boolean }) {
  if (!(needEngine && needModel)) return null;
  const engineDone = engineState === "done";
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        {engineDone ? <Check className="size-3.5 text-ok" /> : engineState === "running" ? <Spinner className="size-3" /> : <Cpu className="size-3.5" />}
        1. Moteur
      </span>
      <span className="flex items-center gap-1.5">
        <CloudDownload className="size-3.5" /> 2. Modèle
      </span>
    </div>
  );
}

/** Welcome card: while no model is ready, suggests the best fit for this machine. */
export function useWelcomeModel(kind: ModelKind = "image"): ModelInfo | null {
  const { data } = useModels();
  const active = useActiveModel(kind);
  const scope = kind === "audio" ? data?.audio : data;
  if (!data || !scope || scope.ready || !active || active.id !== scope.recommended_model_id) return null;
  return active;
}

export function WelcomeSetup({ kind = "image" }: { kind?: ModelKind }) {
  const model = useWelcomeModel(kind);
  if (!model) return null;
  return (
    <div className="mb-4 animate-rise">
      <SetupPrompt model={model} welcome />
      <p className="mt-2 text-center text-[12px] text-faint">
        Recommandé pour cette machine : {model.name} ({model.license || "licence libre"}).{" "}
        <button className="underline-offset-2 hover:text-ink hover:underline" onClick={() => useStore.getState().setModelsOpen(true)}>
          Choisir un autre modèle
        </button>
      </p>
    </div>
  );
}
