// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check, CircleAlert, CloudDownload, Cpu, HardDrive, KeyRound, MemoryStick, Trash2, TriangleAlert, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, type ModelInfo, type ModelKind, type SystemInfo } from "../lib/api";
import { cx, formatModelSize, installedFirst } from "../lib/format";
import { keys, queryClient, useModels } from "../lib/queries";
import { useStore } from "../lib/store";
import { confirm } from "./Confirm";
import { IndeterminateBar, ProgressBar, startSetup } from "./Setup";
import { navigate, paths } from "../lib/router";
import { HELP } from "../lib/help";
import { Button, HelpBody, IconButton, InfoTip, Spinner, Tip } from "./ui";
import { HubSearch } from "./HubSearch";
import { GatedNotice, LicenseWarning, VideoBadges } from "./VideoInfo";

const gb = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)).replace(".", ",");

const BACKEND_LABEL: Record<string, string> = { mlx: "Metal · MLX", torch: "PyTorch", sdcpp: "GGUF", pack: "Audio", demo: "Démo" };
const SDCPP_DEVICE: Record<string, string> = { metal: "Metal", cuda: "CUDA", rocm: "ROCm", vulkan: "Vulkan", cpu: "CPU" };

function backendLabel(m: ModelInfo, system?: SystemInfo) {
  if (m.backend === "pack" && m.kind === "video") return "Vidéo";
  if (m.backend === "sdcpp") return `GGUF · ${SDCPP_DEVICE[system?.engines.sdcpp?.device ?? ""] ?? "GPU"}`;
  if (m.backend !== "torch") return BACKEND_LABEL[m.backend];
  const dev = system?.engines.torch?.device;
  return dev === "cuda" ? `PyTorch · ${system?.accelerators[0]?.backend === "rocm" ? "ROCm" : "CUDA"}` : dev === "mps" ? "PyTorch · Metal" : "PyTorch";
}

export function ModelsDialog() {
  const open = useStore((s) => s.modelsOpen);
  const setOpen = useStore((s) => s.setModelsOpen);
  const { data } = useModels();
  const mode = useStore((s) => s.mode);
  const [tab, setTab] = useState<ModelKind>(mode);
  const searchKind = useStore((s) => s.modelsSearch);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setTab(useStore.getState().modelsSearch ?? mode);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened from "Chercher un modèle": scroll the search into view.
  useEffect(() => {
    if (!open || !searchKind) return;
    const t = setTimeout(() => {
      searchRef.current?.scrollIntoView({ block: "center" });
      searchRef.current?.focus();
      useStore.getState().clearModelSearch();
    }, 120);
    return () => clearTimeout(t);
  }, [open, searchKind]);
  const { data: system } = useQuery({ queryKey: ["system"], queryFn: api.system, enabled: open, staleTime: 5_000, refetchInterval: open ? 8_000 : false });
  const models = data?.models.filter((m) => m.kind === tab) ?? [];
  const speech = installedFirst(models.filter((m) => m.audio?.task === "stt"));
  const generators = installedFirst(models.filter((m) => m.audio?.task !== "stt"));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm animate-fade" />
        <Dialog.Content
          aria-describedby={undefined}
          className="panel fixed left-1/2 top-1/2 z-[61] flex max-h-[min(820px,92vh)] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl animate-rise"
        >
          <div className="flex items-center justify-between px-6 pb-1 pt-5">
            <Dialog.Title className="font-display text-[28px] text-ink">Modèles</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Fermer">
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>

          <div className="space-y-5 overflow-y-auto px-6 pb-6 pt-2">
            {system && <MachineCard system={system} />}
            <KindTabs value={tab} onChange={setTab} />
            {system && tab === "image" && <EnginesCard system={system} />}
            {system && (tab === "audio" || tab === "video") && <PacksCard system={system} kind={tab} models={data?.models ?? []} />}
            <div className="space-y-3">
              {generators.map((m) => <ModelCard key={m.id} model={m} system={system} />)}
              {!data && <div className="grid h-24 place-items-center text-muted"><Spinner /></div>}
            </div>
            {speech.length > 0 && (
              <div className="space-y-3">
                <div>
                  <div className="eyebrow">Transcription</div>
                  <p className="mt-1 text-[12px] leading-snug text-faint">Retranscrit l'extrait d'une voix à cloner (la transcription améliore la fidélité).</p>
                </div>
                {speech.map((m) => <ModelCard key={m.id} model={m} system={system} />)}
              </div>
            )}
            <HubSearch ref={searchRef} kind={tab} />
            <TokenField />
            {system && (
              <p className="font-mono text-[10.5px] leading-relaxed text-faint">
                Modèles : {system.paths.models}
                <br />
                Données : {system.paths.data}
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MachineCard({ system }: { system: SystemInfo }) {
  const gpu = system.accelerators[0];
  return (
    <section className="rounded-2xl border border-line bg-surface-2/50 p-4">
      <div className="eyebrow mb-3">Cette machine</div>
      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
        <Stat icon={<Cpu className="size-4" />} label={gpu ? (gpu.backend === "metal" ? "Puce" : gpu.backend === "rocm" ? "GPU AMD · ROCm" : "GPU NVIDIA · CUDA") : "GPU"}
          value={gpu ? gpu.name : "Aucun GPU exploitable"} sub={gpu?.memory_gb ? `${gb(gpu.memory_gb)} Go${gpu.unified ? " (mémoire unifiée)" : " de VRAM"}` : undefined} warn={!gpu} />
        <Stat icon={<MemoryStick className="size-4" />} label="Mémoire vive" value={`${gb(system.ram_gb)} Go`} sub={`${gb(system.ram_free_gb)} Go disponibles`} />
        <Stat icon={<HardDrive className="size-4" />} label="Disque (modèles)" value={`${gb(system.disk.free_gb)} Go libres`} sub={`sur ${gb(system.disk.total_gb)} Go`} warn={system.disk.free_gb < 40} />
      </div>
      {system.unusable_gpus.map((g) => (
        <div key={g.name} className="mt-3 flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <span><b className="font-medium text-ink">{g.name}</b> détecté mais inutilisable : {g.reason}</span>
        </div>
      ))}
    </section>
  );
}

function Stat({ icon, label, value, sub, warn }: { icon: React.ReactNode; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted">{icon}{label}</div>
      <div className={cx("truncate text-[14px]", warn ? "text-warn" : "text-ink")} title={value}>{value}</div>
      {sub && <div className="font-mono text-[10.5px] text-faint">{sub}</div>}
    </div>
  );
}

function ModelCard({ model: m, system }: { model: ModelInfo; system?: SystemInfo }) {
  const live = useStore((s) => s.downloads[m.id]);
  const dl = live && live.state === "running" ? live : m.download?.state === "running" ? m.download : null;
  const error = live?.state === "error" ? live.error : m.download?.state === "error" ? m.download.error : null;
  const setImageModel = useStore((s) => s.setModel);
  const setAudioModel = useStore((s) => s.setAudioModel);
  const setVideoModel = useStore((s) => s.setVideoModel);
  const setOpen = useStore((s) => s.setModelsOpen);
  const loaded = useStore((s) => s.engine?.model_id === m.id);
  const installed = m.install === "installed";
  const need = Math.max(0, (m.download_size_gb ?? 0) - m.installed_gb);
  const freeGb = system?.disk.free_gb;
  const noRoom = !installed && !dl && need > 0 && freeGb != null && freeGb < need + 1;

  // Blocking delete: wait until the files are actually gone.
  const [deleting, setDeleting] = useState(false);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.models }),
    queryClient.invalidateQueries({ queryKey: ["system"] }),
  ]);

  const start = useMutation({
    mutationFn: () => api.downloadModel(m.id),
    onSuccess: (d) => useStore.getState().setDownload(d),
    onError: (e) => toast.error((e as Error).message),
  });
  const cancel = useMutation({ mutationFn: () => api.cancelDownload(m.id), onError: (e) => toast.error((e as Error).message) });

  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer « ${m.name} » ?`,
      description: `Libère ≈ ${gb(m.installed_gb)} Go. Le modèle devra être retéléchargé pour être réutilisé.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const r = await api.deleteModel(m.id);
      await refresh();
      toast.success(`${gb(r.freed_gb)} Go libérés${r.also_affects.length ? " (les variantes qui partagent ces fichiers sont aussi supprimées)" : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const retire = async () => {
    const ok = await confirm({
      title: `Retirer « ${m.name} » de la liste ?`,
      description: `Supprime aussi ses fichiers (≈ ${gb(m.installed_gb)} Go). Vous pourrez le rechercher de nouveau sur Hugging Face.`,
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.removeCustomModel(m.id);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const saveQuantize = (q: number | null) => api.saveSettings({ quantize: { [m.id]: q } }).then(() => queryClient.invalidateQueries({ queryKey: keys.models }));

  return (
    <article aria-busy={deleting} className={cx("rounded-2xl border bg-surface-2/50 p-4", m.compatible ? "border-line" : "border-line opacity-80")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h3 className="text-[15px] font-medium text-ink">{m.name}</h3>
        <span className="rounded-md bg-surface px-1.5 py-px font-mono text-[10px] text-muted ring-1 ring-line">{backendLabel(m, system)}</span>
        {m.precision && (
          <Tip wide label={<HelpBody {...HELP.quantize} />}>
            <span className="cursor-help rounded-md bg-surface px-1.5 py-px font-mono text-[10px] text-ink-2 ring-1 ring-line">{m.precision}</span>
          </Tip>
        )}
        {m.download_size_gb ? <span className="rounded-md bg-surface px-1.5 py-px font-mono text-[10px] text-ink-2 ring-1 ring-line" title="Taille du modèle">{formatModelSize(m.download_size_gb)}</span> : null}
        {m.custom && <span className="rounded-md bg-safe-soft px-1.5 py-px font-mono text-[10px] text-ink-2">Hugging Face</span>}
        {loaded && <span className="rounded-full bg-ok/15 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-ok">en mémoire</span>}
        {installed && <span className="flex items-center gap-1 font-mono text-[10.5px] text-ok"><Check className="size-3" />installé · {gb(m.installed_gb)} Go</span>}
        {m.install === "partial" && !dl && <span className="font-mono text-[10.5px] text-warn">incomplet · {gb(m.installed_gb)} Go présents</span>}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{m.description}</p>
      {m.kind === "video" && (
        <div className="mt-2">
          <VideoBadges model={m} />
        </div>
      )}
      {m.kind === "video" && <LicenseWarning model={m} className="mt-2.5" />}
      <GatedNotice model={m} className="mt-2.5" />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {m.tags.map((t) => (
          <span key={t} className="rounded-md bg-surface px-1.5 py-px font-mono text-[10px] text-muted ring-1 ring-line">{t}</span>
        ))}
        {m.license && <span className="font-mono text-[10px] text-faint">· {m.license}</span>}
      </div>

      {m.variants.length > 1 && <VariantPicker model={m} disabled={deleting} />}

      {(m.plan.note || m.engine_reason) && (
        <div className={cx("mt-2.5 flex items-start gap-2 text-[12px] leading-snug", m.compatible ? "text-muted" : "text-warn")}>
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {m.engine_reason || m.plan.note}
        </div>
      )}
      {!m.plan.note && m.memory_hint && m.compatible && <p className="mt-2 text-[12px] leading-snug text-faint">{m.memory_hint}</p>}

      {noRoom && (
        <div className="mt-2.5 flex items-start gap-2 text-[12px] leading-snug text-warn">
          <HardDrive className="mt-px size-3.5 shrink-0" />
          Espace disque insuffisant : il faut ≈ {gb(need)} Go et {gb(freeGb!)} Go sont libres.
        </div>
      )}

      {dl && <ProgressBar done={dl.done} total={dl.total} rate={dl.rate} eta={dl.eta} />}
      {error && !dl && (
        <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /> {error}
        </div>
      )}

      {m.needs_engine_install && !dl && (
        <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[12px] leading-snug text-ink-2">
          <CloudDownload className="mt-px size-3.5 shrink-0 text-warn" />
          <span>
            <b className="font-medium text-ink">Moteur à installer : {m.engine_name}</b>
            {m.engine_install_size_mb ? ` (≈ ${m.engine_install_size_mb} Mo)` : ""}. {m.engine_detail}
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {deleting ? (
          <Button variant="secondary" disabled>
            <Spinner /> Suppression en cours… <span className="font-mono text-[11px] opacity-80">≈ {gb(m.installed_gb)} Go</span>
          </Button>
        ) : dl ? (
          <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Annuler</Button>
        ) : m.needs_engine_install ? (
          <Button variant="primary" disabled={!m.compatible} onClick={() => startSetup(m)}>
            <CloudDownload className="size-4" />
            {installed ? "Installer le moteur" : "Installer le moteur et le modèle"}
            <span className="font-mono text-[11px] opacity-80">
              ≈ {m.engine_install_size_mb} Mo{!installed && need > 0 ? ` + ${gb(need)} Go` : ""}
            </span>
          </Button>
        ) : installed ? (
          <>
            {m.audio?.task !== "stt" && (
              <Button
                variant="primary"
                disabled={!m.compatible}
                onClick={() => {
                  if (m.kind === "audio") (setAudioModel(m.id), navigate(paths.audioHome));
                  else if (m.kind === "video") (setVideoModel(m.id), navigate(paths.videoHome));
                  else (setImageModel(m.id), navigate(paths.home));
                  setOpen(false);
                }}
              >
                Utiliser
              </Button>
            )}
            <Button variant="ghost" onClick={remove} disabled={loaded}><Trash2 className="size-4" /> Supprimer</Button>
          </>
        ) : (
          <Button variant="primary" disabled={!m.compatible || noRoom || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Spinner /> : <CloudDownload className="size-4" />}
            {m.install === "partial" ? "Compléter" : "Télécharger"}
            {need > 0 && <span className="font-mono text-[11px] opacity-80">≈ {gb(need)} Go</span>}
          </Button>
        )}
        {m.custom && !dl && !deleting && <Button variant="ghost" onClick={retire} disabled={loaded}><Trash2 className="size-4" /> Retirer de la liste</Button>}
        {installed && !deleting && m.backend === "mlx" && m.quantize_options.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11.5px] text-faint">
              Précision <InfoTip {...HELP.quantize} side="left" />
            </span>
            <div className="flex rounded-lg bg-surface p-0.5 ring-1 ring-line">
              {[...m.quantize_options.filter((q) => [4, 6, 8].includes(q)), null].map((q) => (
                <button
                  key={String(q)}
                  onClick={() => saveQuantize(q)}
                  className={cx("rounded-md px-2 py-1 font-mono text-[11px] transition-colors", m.quantize === q ? "bg-surface-3 text-ink" : "text-faint hover:text-ink")}
                >
                  {q ? `${q} bits` : "bf16"}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/** Quantization choice: only the selected one is downloaded, no extra copies. */
function VariantPicker({ model: m, disabled }: { model: ModelInfo; disabled?: boolean }) {
  const choose = useMutation({
    mutationFn: (key: string) => api.saveSettings({ variant: { [m.id]: key } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.models });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
          Quantification <InfoTip {...HELP.variant} />
        </span>
        <span className="text-[11px] text-faint">seule celle choisie est téléchargée</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {m.variants.map((v) => (
          <button
            key={v.key}
            disabled={choose.isPending || disabled}
            onClick={() => !v.selected && choose.mutate(v.key)}
            title={v.install === "installed" ? "Déjà téléchargée" : `À télécharger : ≈ ${gb(v.need_gb)} Go`}
            className={cx(
              "flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11px] ring-1 transition-colors",
              v.selected ? "bg-safe-soft text-ink ring-safe/50" : "bg-surface text-muted ring-line hover:text-ink",
            )}
          >
            {v.install === "installed" && <Check className="size-3 text-ok" />}
            {v.label}
            <span className="text-faint">{gb(v.size_gb)} Go</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TokenField() {
  const { data } = useQuery({ queryKey: keys.settings, queryFn: api.settings });
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: (token: string) => api.saveSettings({ hf_token: token }),
    onSuccess: (s) => { queryClient.setQueryData(keys.settings, s); setValue(""); toast.success(s.has_hf_token ? "Jeton enregistré" : "Jeton supprimé"); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <section className="rounded-2xl border border-line bg-surface-2/50 p-4">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-ink"><KeyRound className="size-4 text-muted" /> Jeton Hugging Face <span className="font-normal text-faint">(facultatif)</span></div>
      <p className="mb-2.5 text-[12px] leading-snug text-muted">
        La plupart des modèles se téléchargent sans compte. Un jeton n'est utile que pour les dépôts à accès restreint (LTX-2.5 par exemple) : acceptez d'abord leur licence sur Hugging Face.
        {data?.has_hf_token && <span className="text-ok"> Un jeton est enregistré.</span>}
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="hf_…"
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 font-mono text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        <Button variant="secondary" disabled={!value.trim() || save.isPending} onClick={() => save.mutate(value)}>Enregistrer</Button>
        {data?.has_hf_token && <Button variant="ghost" onClick={() => save.mutate("")}>Retirer</Button>}
      </div>
    </section>
  );
}

const ENGINE_NAMES: Record<string, { name: string; hint: string }> = {
  sdcpp: { name: "GGUF (stable-diffusion.cpp)", hint: "Léger, quantifié ; NVIDIA, AMD, Intel et Apple" },
  mlx: { name: "MLX", hint: "Metal natif, Apple Silicon" },
  torch: { name: "PyTorch", hint: "CUDA, ROCm ou Metal (pleine précision)" },
};
const VARIANT_LABEL: Record<string, string> = { metal: "Metal", cuda: "CUDA", rocm: "ROCm", vulkan: "Vulkan", cpu: "CPU" };

function EnginesCard({ system }: { system: SystemInfo }) {
  const live = useStore((s) => s.engineInstall);
  const sd = system.engines.sdcpp;
  const install = live.state !== "idle" ? live : sd?.install;
  const running = install?.state === "running";
  return (
    <section className="rounded-2xl border border-line bg-surface-2/50 p-4">
      <div className="eyebrow mb-3">Moteurs</div>
      <div className="space-y-2.5">
        {Object.entries(ENGINE_NAMES).map(([id, info]) => {
          const e = system.engines[id];
          if (!e) return null;
          const installable = id === "sdcpp" && !e.available && e.installable;
          if (!e.available && !installable && id !== "sdcpp" && (e.reason ?? "").includes("Mac")) return null;
          return (
            <div key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={cx("size-2 shrink-0 rounded-full", e.available ? "bg-ok" : installable ? "bg-warn" : "bg-faint")} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] text-ink">
                  {info.name}
                  {e.available && e.variant && <span className="ml-2 font-mono text-[11px] text-muted">{VARIANT_LABEL[e.variant] ?? e.variant}</span>}
                </div>
                <div className="text-[11.5px] leading-snug text-faint">
                  {e.available ? info.hint : installable ? `Non installé — ${info.hint}` : e.reason ?? "Indisponible"}
                </div>
              </div>
              {installable && !running && (
                <Button variant="primary" onClick={() => api.installEngine().then(useStore.getState().setEngineInstall).catch((er) => toast.error(er.message))}>
                  <CloudDownload className="size-4" /> Installer ≈ {e.install_size_mb} Mo
                </Button>
              )}
              {id === "sdcpp" && running && (
                <Button variant="secondary" onClick={() => api.cancelEngineInstall().catch(() => {})}>Annuler</Button>
              )}
            </div>
          );
        })}
      </div>
      {install?.state === "running" && (
        <>
          <ProgressBar done={install.done ?? 0} total={install.total ?? 0} unit="mb" />
          <p className="mt-1 font-mono text-[11px] text-faint">{install.message}</p>
        </>
      )}
      {install?.state === "error" && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /> {install.error}
        </div>
      )}
    </section>
  );
}

function KindTabs({ value, onChange }: { value: ModelKind; onChange: (k: ModelKind) => void }) {
  return (
    <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-surface p-1 ring-1 ring-line">
      {([["image", "Modèles d'image"], ["audio", "Modèles audio"], ["video", "Modèles vidéo"]] as const).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cx("h-8 rounded-lg text-[13px] font-medium transition-colors", value === id ? "bg-surface-3 text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PacksCard({ system, kind, models }: { system: SystemInfo; kind: "audio" | "video"; models: ModelInfo[] }) {
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const live = useStore((s) => s.packInstall);
  const install = live.state !== "idle" ? live : system.pack_install;
  const running = install?.state === "running";
  return (
    <section className="rounded-2xl border border-line bg-surface-2/50 p-4">
      <div className="eyebrow mb-1">{kind === "video" ? "Moteurs vidéo" : "Moteurs audio"}</div>
      <p className="mb-3 text-[12px] leading-snug text-faint">
        Chaque famille de modèles a son propre environnement, installé à la demande : aucun conflit, rien d'inutile sur le disque.
      </p>
      <div className="space-y-2.5">
        {Object.entries(system.packs ?? {}).filter(([id]) => {
          // A pack belongs to the kind of the models that use it; unused packs stay with audio.
          const used = (k: string) => models.some((m) => m.kind === k && m.engine_pack === id);
          return kind === "video" ? used("video") : !used("video") || used("audio");
        }).map(([id, p]) => {
          const mine = running && install.pack === id;
          return (
            <div key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={cx("size-2 shrink-0 rounded-full", p.installed ? "bg-ok" : p.installable ? "bg-warn" : "bg-faint")} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] text-ink">{p.name}</div>
                <div className="text-[11.5px] leading-snug text-faint">
                  {p.installed ? "Installé" : p.installable ? `Non installé · ≈ ${p.size_mb} Mo` : p.reason}
                </div>
              </div>
              {!p.installed && p.installable && !running && (
                <Button variant="primary" onClick={() => api.installPack(id).then(useStore.getState().setPackInstall).catch((e) => toast.error(e.message))}>
                  <CloudDownload className="size-4" /> Installer ≈ {p.size_mb} Mo
                </Button>
              )}
              {mine && <Button variant="secondary" onClick={() => api.cancelPackInstall().catch(() => {})}>Annuler</Button>}
              {p.installed && !running && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Désinstaller « ${p.name} » ?`,
                      description: "Libère l'environnement Python de ce moteur. Les modèles téléchargés sont conservés.",
                      confirmLabel: "Désinstaller",
                      danger: true,
                    });
                    if (!ok) return;
                    setUninstalling(id);
                    try {
                      await api.uninstallPack(id);
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: keys.models }),
                        queryClient.invalidateQueries({ queryKey: ["system"] }),
                      ]);
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setUninstalling(null);
                    }
                  }}
                  disabled={uninstalling !== null}
                >
                  {uninstalling === id ? <Spinner /> : <Trash2 className="size-4" />}
                  {uninstalling === id ? "Désinstallation…" : "Désinstaller"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {running && <IndeterminateBar message={install.message} detail={install.detail} since={install.started_at} />}
      {install?.state === "error" && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" /> <span className="min-w-0 break-words">{install.error}</span>
        </div>
      )}
    </section>
  );
}
