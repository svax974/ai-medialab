// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Slider from "@radix-ui/react-slider";
import { ChevronRight, Dices, Lock, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { GenParams, ModelInfo, ParamSpec } from "../lib/api";
import { cx } from "../lib/format";
import { useStore } from "../lib/store";
import { Tip } from "./ui";

interface Props {
  model: ModelInfo;
  params: GenParams;
  hasRefs: boolean;
  onChange: (patch: GenParams) => void;
}

export function ParamsPopover({ model, params, hasRefs, onChange }: Props) {
  const seed = useStore((s) => s.seed);
  const setSeed = useStore((s) => s.setSeed);
  const resetParams = useStore((s) => s.resetParams);
  const [advanced, setAdvanced] = useState(false);

  const visible = model.params.filter((p) => !p.requires_references || hasRefs);
  const basic = visible.filter((p) => !p.advanced);
  const extra = visible.filter((p) => p.advanced);
  const modified = model.params.some((p) => params[p.key] !== undefined && params[p.key] !== p.default) || seed !== null;

  return (
    <Popover.Root>
      <Tip label="Réglages de génération">
        <Popover.Trigger asChild>
          <button
            className="relative flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:text-ink"
            aria-label="Réglages de génération"
          >
            <SlidersHorizontal className="size-3.5" />
            {model.kind === "image" && <span className="hidden font-mono text-[11px] md:inline">{params.steps ?? "—"} ét.</span>}
            {(model.kind === "audio" || model.kind === "video") && <span className="hidden text-[13px] md:inline">Réglages</span>}
            {seed !== null && <Lock className="size-3 text-safe" />}
            {modified && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-safe" />}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content collisionPadding={12} side="top" align="start" sideOffset={8} className="menu w-[340px] p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">Réglages · {model.name}</span>
            <button
              onClick={() => (resetParams(model.id), setSeed(null))}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-3 hover:text-ink"
            >
              <RotateCcw className="size-3" /> Défauts
            </button>
          </div>

          <div className="space-y-4">
            {basic.map((p) => (
              <ParamControl key={p.key} spec={p} value={params[p.key]} onChange={(v) => onChange({ [p.key]: v })} />
            ))}

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                <span className="text-ink-2">Graine (seed)</span>
                <span className="text-[11px] text-faint">{seed === null ? "aléatoire" : "fixe"}</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  placeholder="Aléatoire"
                  value={seed ?? ""}
                  onChange={(e) => setSeed(e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))))}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 font-mono text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
                />
                <Tip label="Tirer une graine fixe">
                  <button
                    onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}
                    className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-muted hover:text-ink"
                  >
                    <Dices className="size-4" />
                  </button>
                </Tip>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-faint">
                {model.kind === "audio" ? "Une graine fixe reproduit la même prise pour le même texte et la même voix." : model.kind === "video" ? "Une graine fixe reproduit le même clip pour le même prompt et les mêmes réglages." : "Une graine fixe reproduit la même image pour le même prompt."}
              </p>
            </div>

            {extra.length > 0 && (
              <div className="border-t border-line pt-3">
                <button onClick={() => setAdvanced((v) => !v)} className="flex w-full items-center gap-1 text-[12px] text-muted hover:text-ink">
                  <ChevronRight className={cx("size-3.5 transition-transform", advanced && "rotate-90")} />
                  Avancé
                </button>
                {advanced && (
                  <div className="mt-3 space-y-4">
                    {extra.map((p) => (
                      <ParamControl key={p.key} spec={p} value={params[p.key]} onChange={(v) => onChange({ [p.key]: v })} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ParamControl({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: number | string) => void }) {
  if (spec.type === "text") {
    return (
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] text-ink-2">{spec.label}</span>
        <textarea
          rows={2}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.help}
          className="w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
      </label>
    );
  }
  const num = typeof value === "number" ? value : Number(spec.default);
  const decimals = spec.type === "float" ? Math.max(0, -Math.floor(Math.log10(spec.step ?? 0.1))) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12.5px]">
        <span className="text-ink-2">{spec.label}</span>
        <span className="font-mono text-[12px] text-ink">{num.toFixed(decimals)}</span>
      </div>
      <Slider.Root
        className="relative flex h-4 touch-none select-none items-center"
        min={spec.min ?? 0}
        max={spec.max ?? 100}
        step={spec.step ?? 1}
        value={[num]}
        onValueChange={([v]) => onChange(spec.type === "int" ? Math.round(v) : Number(v.toFixed(decimals)))}
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-surface-3">
          <Slider.Range className="absolute h-full rounded-full bg-safe" />
        </Slider.Track>
        <Slider.Thumb
          aria-label={spec.label}
          className="block size-3.5 rounded-full border-2 border-safe bg-surface shadow transition-transform hover:scale-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-safe-soft"
        />
      </Slider.Root>
      {spec.help && <p className="mt-1.5 text-[11px] leading-snug text-faint">{spec.help}</p>}
    </div>
  );
}
