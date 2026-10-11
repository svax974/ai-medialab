import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { cx, formatClock } from "../lib/format";
import { useModels } from "../lib/queries";
import { useStore } from "../lib/store";
import { IconButton } from "./ui";

/** État du moteur : modèle chargé en mémoire, chargement en cours, génération, file d'attente. */
export function EngineCard() {
  const engine = useStore((s) => s.engine);
  const { data } = useModels();
  const now = useNow(engine?.state === "loading");
  if (!engine) return null;

  const model = data?.models.find((m) => m.id === engine.model_id);
  const queued = engine.queue.length;
  const { dot, label, detail } = (() => {
    switch (engine.state) {
      case "loading":
        return {
          dot: "bg-warn animate-breathe",
          label: "Chargement du modèle",
          detail: engine.load_started_at ? formatClock(now - engine.load_started_at) : "",
        };
      case "busy":
        return { dot: "bg-safe animate-breathe shadow-[0_0_8px_var(--safe)]", label: model?.name ?? "Génération", detail: "en cours" };
      case "ready":
        return {
          dot: "bg-ok",
          label: model?.name ?? engine.model_id ?? "Prêt",
          detail: engine.quantize ? `${engine.quantize} bits · en mémoire` : "en mémoire",
        };
      default:
        return { dot: "bg-faint", label: "Aucun modèle chargé", detail: "chargé à la demande" };
    }
  })();

  const unload = async () => {
    try {
      await api.unload();
      toast.success("Modèle déchargé, mémoire libérée.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2">
      <span className={cx("size-2 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-ink">{label}</div>
        <div className="truncate font-mono text-[10.5px] text-faint">
          {detail}
          {queued > 0 && ` · ${queued} en attente`}
        </div>
      </div>
      {engine.state === "ready" && (
        <IconButton label="Décharger le modèle (libère la mémoire)" size="sm" onClick={unload}>
          <Power className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

export function useNow(active: boolean, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now() / 1000);
    const id = setInterval(() => setNow(Date.now() / 1000), interval);
    return () => clearInterval(id);
  }, [active, interval]);
  return now;
}
