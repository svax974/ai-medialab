import * as Popover from "@radix-ui/react-popover";
import { ImageIcon, Ratio } from "lucide-react";
import type { Asset, GenParams, ModelInfo } from "../lib/api";
import { cx } from "../lib/format";
import { ASPECTS, QUALITIES, ratioOf, resolveSize } from "../lib/size";

interface Props {
  model: ModelInfo;
  params: GenParams;
  reference: Asset | undefined;
  onChange: (patch: GenParams) => void;
}

function Shape({ ratio, active }: { ratio: number; active: boolean }) {
  const w = ratio >= 1 ? 22 : 22 * ratio;
  const h = ratio >= 1 ? 22 / ratio : 22;
  return (
    <span className="grid size-6 place-items-center">
      <span
        style={{ width: w, height: h }}
        className={cx("rounded-[3px] border-[1.5px] transition-colors", active ? "border-safe bg-safe-soft" : "border-current")}
      />
    </span>
  );
}

export function AspectPicker({ model, params, reference, onChange }: Props) {
  const size = resolveSize(params, model, reference);
  const aspect = params.aspect ?? "1:1";
  const label = aspect === "auto" ? "Auto" : aspect === "custom" ? "Libre" : aspect;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:text-ink">
          <Ratio className="size-3.5" />
          <span>{label}</span>
          <span className="hidden font-mono text-[11px] text-faint sm:inline">
            {size.width}×{size.height}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="menu w-[340px] p-3">
          <div className="eyebrow mb-2">Format</div>
          <div className="grid grid-cols-4 gap-1.5">
            {reference && (
              <AspectTile active={aspect === "auto"} onClick={() => onChange({ aspect: "auto" })} label="Auto" sub="image">
                <ImageIcon className="size-4" />
              </AspectTile>
            )}
            {ASPECTS.map((a) => (
              <AspectTile key={a.id} active={aspect === a.id} onClick={() => onChange({ aspect: a.id })} label={a.id} sub={a.label}>
                <Shape ratio={ratioOf(a.id)!} active={aspect === a.id} />
              </AspectTile>
            ))}
            <AspectTile
              active={aspect === "custom"}
              onClick={() => onChange({ aspect: "custom", width: size.width, height: size.height })}
              label="Libre"
              sub="px"
            >
              <span className="font-mono text-[11px]">W×H</span>
            </AspectTile>
          </div>

          {aspect === "custom" ? (
            <div className="mt-3 flex items-center gap-2">
              <DimInput label="Largeur" value={params.width ?? size.width} onChange={(width) => onChange({ width })} model={model} />
              <span className="pt-4 text-faint">×</span>
              <DimInput label="Hauteur" value={params.height ?? size.height} onChange={(height) => onChange({ height })} model={model} />
            </div>
          ) : (
            <>
              <div className="eyebrow mb-2 mt-4">Définition</div>
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface p-1 ring-1 ring-line">
                {QUALITIES.map((q) => {
                  const active = Math.abs((params.megapixels ?? model.default_megapixels) - q.mp) < 0.01;
                  return (
                    <button
                      key={q.mp}
                      onClick={() => onChange({ megapixels: q.mp })}
                      title={q.hint}
                      className={cx(
                        "rounded-lg px-1 py-1.5 text-[12px] transition-colors",
                        active ? "bg-surface-3 text-ink shadow-sm" : "text-muted hover:text-ink",
                      )}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-faint">
            <span>Sortie</span>
            <span className="text-ink-2">
              {size.width} × {size.height} px · {((size.width * size.height) / 1e6).toFixed(2)} MP
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AspectTile({ active, onClick, label, sub, children }: { active: boolean; onClick: () => void; label: string; sub: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 transition-colors",
        active ? "border-safe/60 bg-safe-soft text-ink" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
      <span className="font-mono text-[11px] leading-none">{label}</span>
      <span className="text-[10px] leading-none text-faint">{sub}</span>
    </button>
  );
}

function DimInput({ label, value, onChange, model }: { label: string; value: number; onChange: (v: number) => void; model: ModelInfo }) {
  return (
    <label className="flex-1">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <input
        type="number"
        min={model.min_side}
        max={model.max_side}
        step={model.size_multiple}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-full rounded-lg border border-line bg-surface px-2.5 font-mono text-sm text-ink focus:border-line-strong focus:outline-none"
      />
    </label>
  );
}
