import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, CloudDownload, Cpu, Settings2 } from "lucide-react";
import type { ModelInfo } from "../lib/api";
import { cx } from "../lib/format";
import { useModels } from "../lib/queries";
import { useStore } from "../lib/store";

const BACKEND: Record<string, string> = { mlx: "MLX", torch: "PyTorch", sdcpp: "GGUF", pack: "audio", demo: "démo" };

export function ModelPicker({ model }: { model: ModelInfo }) {
  const { data } = useModels();
  const engine = useStore((s) => s.engine);
  const setImageModel = useStore((s) => s.setModel);
  const setAudioModel = useStore((s) => s.setAudioModel);
  const setModel = model.kind === "audio" ? setAudioModel : setImageModel;
  const setModelsOpen = useStore((s) => s.setModelsOpen);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-8 max-w-60 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:text-ink">
          <Cpu className="size-3.5 shrink-0 text-safe" />
          <span className="truncate">{model.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-faint">{BACKEND[model.backend]}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content collisionPadding={12} side="top" align="start" sideOffset={8} className="menu w-[380px]">
          <div className="eyebrow px-2.5 pb-1 pt-1.5">Modèles locaux</div>
          {data?.models.filter((m) => m.kind === model.kind && m.audio?.task !== "stt").map((m) => {
            const loaded = engine?.model_id === m.id;
            return (
              <DropdownMenu.Item
                key={m.id}
                onSelect={() => setModel(m.id)}
                className={cx("menu-item items-start py-2.5", m.id === model.id && "bg-surface-3/60", !m.compatible && "opacity-60")}
              >
                <div className="mt-0.5 grid size-4 shrink-0 place-items-center">
                  {m.id === model.id && <Check className="size-4 text-safe" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{m.name}</span>
                    <span className="rounded-md bg-surface px-1.5 py-px font-mono text-[9.5px] text-muted ring-1 ring-line">{BACKEND[m.backend]}</span>
                    {loaded && <span className="rounded-full bg-ok/15 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-ok">en mémoire</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{m.description}</p>
                  {m.kind === "audio" && m.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <span key={t} className="rounded-md bg-surface px-1.5 py-px font-mono text-[9.5px] text-muted ring-1 ring-line">{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {m.needs_engine_install && (
                      <span className="flex items-center gap-1 rounded-md bg-warn/10 px-1.5 py-px font-mono text-[10px] text-warn">
                        <CloudDownload className="size-3" /> moteur à installer{m.engine_install_size_mb ? ` · ${m.engine_install_size_mb} Mo` : ""}
                      </span>
                    )}
                    {m.install !== "installed" && m.compatible && (
                      <span className="flex items-center gap-1 rounded-md bg-warn/10 px-1.5 py-px font-mono text-[10px] text-warn">
                        <CloudDownload className="size-3" /> {m.install === "partial" ? "à compléter" : "à télécharger"}
                        {m.download_size_gb ? ` · ~${Math.round(m.download_size_gb)} Go` : ""}
                      </span>
                    )}
                    {!m.compatible && (
                      <span className="rounded-md bg-danger/10 px-1.5 py-px font-mono text-[10px] text-danger">trop gourmand pour cette machine</span>
                    )}
                  </div>
                </div>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className="menu-item" onSelect={() => setModelsOpen(true)}>
            <Settings2 className="size-4" /> Gérer les modèles (téléchargement, mémoire)…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
