import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check, CircleAlert, CloudDownload, Cpu, HardDrive, KeyRound, MemoryStick, Trash2, TriangleAlert, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, type ModelInfo, type SystemInfo } from "../lib/api";
import { cx, formatDuration } from "../lib/format";
import { keys, queryClient, useModels } from "../lib/queries";
import { useStore } from "../lib/store";
import { confirm } from "./Confirm";
import { Button, IconButton, Spinner } from "./ui";

const gb = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)).replace(".", ",");
const bytesToGb = (b: number) => b / 1024 ** 3;

const BACKEND_LABEL: Record<string, string> = { mlx: "Metal · MLX", torch: "PyTorch", demo: "Démo" };

function backendLabel(m: ModelInfo, system?: SystemInfo) {
  if (m.backend !== "torch") return BACKEND_LABEL[m.backend];
  const dev = system?.engines.torch?.device;
  return dev === "cuda" ? `PyTorch · ${system?.accelerators[0]?.backend === "rocm" ? "ROCm" : "CUDA"}` : dev === "mps" ? "PyTorch · Metal" : "PyTorch";
}

export function ModelsDialog() {
  const open = useStore((s) => s.modelsOpen);
  const setOpen = useStore((s) => s.setModelsOpen);
  const { data } = useModels();
  const { data: system } = useQuery({ queryKey: ["system"], queryFn: api.system, enabled: open, staleTime: 5_000, refetchInterval: open ? 8_000 : false });

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
            <div className="space-y-3">
              {data?.models.map((m) => <ModelCard key={m.id} model={m} system={system} />)}
              {!data && <div className="grid h-24 place-items-center text-muted"><Spinner /></div>}
            </div>
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
  const setModel = useStore((s) => s.setModel);
  const setOpen = useStore((s) => s.setModelsOpen);
  const loaded = useStore((s) => s.engine?.model_id === m.id);
  const installed = m.install === "installed";
  const need = Math.max(0, (m.download_size_gb ?? 0) - m.installed_gb);
  const freeGb = system?.disk.free_gb;
  const noRoom = !installed && !dl && need > 0 && freeGb != null && freeGb < need + 1;

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
    try {
      const r = await api.deleteModel(m.id);
      toast.success(`${gb(r.freed_gb)} Go libérés${r.also_affects.length ? " (les variantes qui partagent ces fichiers sont aussi supprimées)" : ""}`);
      queryClient.invalidateQueries({ queryKey: keys.models });
      queryClient.invalidateQueries({ queryKey: ["system"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveQuantize = (q: number | null) => api.saveSettings({ quantize: { [m.id]: q } }).then(() => queryClient.invalidateQueries({ queryKey: keys.models }));

  return (
    <article className={cx("rounded-2xl border bg-surface-2/50 p-4", m.compatible ? "border-line" : "border-line opacity-80")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h3 className="text-[15px] font-medium text-ink">{m.name}</h3>
        <span className="rounded-md bg-surface px-1.5 py-px font-mono text-[10px] text-muted ring-1 ring-line">{backendLabel(m, system)}</span>
        {loaded && <span className="rounded-full bg-ok/15 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-ok">en mémoire</span>}
        {installed && <span className="flex items-center gap-1 font-mono text-[10.5px] text-ok"><Check className="size-3" />installé · {gb(m.installed_gb)} Go</span>}
        {m.install === "partial" && !dl && <span className="font-mono text-[10.5px] text-warn">incomplet · {gb(m.installed_gb)} Go présents</span>}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{m.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {m.tags.map((t) => (
          <span key={t} className="rounded-md bg-surface px-1.5 py-px font-mono text-[10px] text-muted ring-1 ring-line">{t}</span>
        ))}
        {m.license && <span className="font-mono text-[10px] text-faint">· {m.license}</span>}
      </div>

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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dl ? (
          <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Annuler</Button>
        ) : installed ? (
          <>
            <Button variant="primary" disabled={!m.compatible} onClick={() => { setModel(m.id); setOpen(false); }}>Utiliser</Button>
            <Button variant="ghost" onClick={remove} disabled={loaded}><Trash2 className="size-4" /> Supprimer</Button>
          </>
        ) : (
          <Button variant="primary" disabled={!m.compatible || noRoom || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Spinner /> : <CloudDownload className="size-4" />}
            {m.install === "partial" ? "Compléter" : "Télécharger"}
            {need > 0 && <span className="font-mono text-[11px] opacity-80">≈ {gb(need)} Go</span>}
          </Button>
        )}
        {installed && m.backend === "mlx" && m.quantize_options.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11.5px] text-faint">Précision</span>
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

function ProgressBar({ done, total, rate, eta }: { done: number; total: number; rate: number; eta: number | null }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-safe shadow-[0_0_10px_var(--safe)] transition-[width] duration-500" style={{ width: `${Math.max(1.5, pct)}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted">
        <span>{total > 0 ? `${gb(bytesToGb(done))} / ${gb(bytesToGb(total))} Go · ${pct.toFixed(0)} %` : "Préparation…"}</span>
        <span>{rate > 0 ? `${(rate / 1024 ** 2).toFixed(0)} Mo/s` : ""}{eta != null ? ` · ${formatDuration(eta)} restantes` : ""}</span>
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
        Les modèles proposés ici se téléchargent sans compte. Un jeton n'est utile que pour des dépôts à accès restreint.
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
