// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Globe, Mic, Plus, Sparkles } from "lucide-react";
import type { AudioCaps, ModelInfo, PresetVoice, Voice, VoiceRef } from "../lib/api";
import { clock } from "../lib/audio";
import { cx } from "../lib/format";
import { useVoices } from "../lib/queries";
import { useStore } from "../lib/store";
import { Waveform } from "./Waveform";

/** Voice actually shown: the selection if valid for the language, else the model's first voice. */
export function effectiveVoice(
  caps: AudioCaps,
  ref: VoiceRef | undefined,
  language: string,
  library: Voice[] | undefined,
): { ref: VoiceRef | undefined; name: string; preset?: PresetVoice; voice?: Voice } {
  if (ref?.source === "library") {
    const voice = library?.find((v) => v.id === ref.id);
    if (voice && caps.clone !== "none") return { ref, name: voice.name, voice };
  }
  const presets = presetsFor(caps, language);
  const preset = (ref?.source === "preset" && presets.find((p) => p.id === ref.id)) || presets[0];
  if (preset) return { ref: { source: "preset", id: preset.id }, name: preset.name, preset };
  return { ref: undefined, name: caps.clone !== "none" ? "Choisir une voix" : "—" };
}

export function presetsFor(caps: AudioCaps, language: string): PresetVoice[] {
  return caps.voices.filter((v) => v.language === language || v.language === "*");
}

export function defaultLanguage(caps: AudioCaps, stored?: string): string {
  const codes = caps.languages.map((l) => l.code);
  if (stored && codes.includes(stored)) return stored;
  const ui = (navigator.language || "fr").slice(0, 2);
  return codes.includes(ui) ? ui : codes.includes("fr") ? "fr" : (codes[0] ?? "en");
}

// --- Avatar ---

function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function VoiceAvatar({ name, size = 28, library = false }: { name: string; size?: number; library?: boolean }) {
  const h = hue(name);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-medium text-white/95 ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 28%))`,
      }}
    >
      {library ? <Mic style={{ width: size * 0.45, height: size * 0.45 }} /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

// --- Voice picker ---

interface Props {
  model: ModelInfo;
  language: string;
  value: VoiceRef | undefined;
  onChange: (v: VoiceRef) => void;
  compact?: boolean;
  label?: string;
}

export function VoicePicker({ model, language, value, onChange, compact = false, label }: Props) {
  const caps = model.audio!;
  const { data: library } = useVoices();
  const openStudio = useStore((s) => s.openVoiceStudio);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"model" | "library">(value?.source === "library" ? "library" : "model");
  const current = effectiveVoice(caps, value, language, library);
  const presets = presetsFor(caps, language);
  const canClone = caps.clone !== "none";

  if (caps.design) {
    return (
      <span className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink-2">
        <Sparkles className="size-3.5 text-safe" /> Voix décrite ci-dessus
      </span>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={cx(
            "flex h-8 max-w-52 items-center gap-2 rounded-lg border border-line bg-surface-2 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:text-ink",
            compact ? "pl-1.5 pr-2" : "pl-1.5 pr-2.5",
          )}
        >
          <VoiceAvatar name={current.name} size={20} library={current.ref?.source === "library"} />
          {label && <span className="font-mono text-[10.5px] uppercase tracking-wide text-faint">{label}</span>}
          <span className="truncate">{current.name}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content collisionPadding={12} side="top" align="start" sideOffset={8} className="menu w-[390px] p-0">
          <div className="flex gap-1 border-b border-line p-2">
            <TabButton active={tab === "model"} onClick={() => setTab("model")}>
              Voix du modèle <span className="font-mono text-[10.5px] text-faint">{presets.length}</span>
            </TabButton>
            <TabButton active={tab === "library"} onClick={() => setTab("library")}>
              Mes voix <span className="font-mono text-[10.5px] text-faint">{library?.length ?? 0}</span>
            </TabButton>
          </div>

          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {tab === "model" && (
              <>
                {presets.length === 0 && (
                  <p className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-faint">
                    {canClone ? "Ce modèle n'a pas de voix intégrée : il clone la voix de vos enregistrements (onglet « Mes voix »)." : "Aucune voix pour cette langue."}
                  </p>
                )}
                {presets.map((p) => (
                  <Row
                    key={p.id}
                    selected={current.ref?.source === "preset" && current.ref.id === p.id}
                    onSelect={() => (onChange({ source: "preset", id: p.id }), setOpen(false))}
                    avatar={<VoiceAvatar name={p.name} />}
                    title={p.name}
                    sub={p.description}
                    tag={p.gender === "f" ? "♀" : p.gender === "m" ? "♂" : undefined}
                  />
                ))}
              </>
            )}

            {tab === "library" && (
              <>
                {!canClone && (
                  <p className="px-3 py-4 text-center text-[12.5px] leading-relaxed text-warn">
                    {model.name} ne sait pas cloner : choisissez Pocket TTS ou un modèle Qwen3 « Clonage » pour utiliser vos voix.
                  </p>
                )}
                {library?.length === 0 && (
                  <p className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-faint">
                    Aucune voix pour l'instant. Enregistrez-vous ou importez un extrait de quelques secondes pour cloner une voix.
                  </p>
                )}
                {library?.map((v) => (
                  <Row
                    key={v.id}
                    disabled={!canClone}
                    selected={current.ref?.source === "library" && current.ref.id === v.id}
                    onSelect={() => (onChange({ source: "library", id: v.id }), setOpen(false))}
                    avatar={<VoiceAvatar name={v.name} library />}
                    title={v.name}
                    sub={[v.kind === "design" ? "voix inventée" : "voix clonée", v.duration ? clock(v.duration) : null, v.transcript ? null : "sans transcription"].filter(Boolean).join(" · ")}
                    extra={<Waveform peaks={v.peaks} className="h-5 w-20 opacity-70" />}
                  />
                ))}
              </>
            )}
          </div>

          <div className="border-t border-line p-1.5">
            <button
              onClick={() => (setOpen(false), openStudio())}
              className="menu-item w-full"
            >
              <Plus className="size-4" /> Enregistrer ou importer une voix…
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12.5px] transition-colors",
        active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Row({
  selected, onSelect, avatar, title, sub, tag, extra, disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  avatar: React.ReactNode;
  title: string;
  sub?: string;
  tag?: string;
  extra?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-3 disabled:opacity-40",
        selected && "bg-surface-3/70",
      )}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13.5px] text-ink">
          {title}
          {tag && <span className="text-[11px] text-faint">{tag}</span>}
        </span>
        {sub && <span className="block truncate text-[11.5px] leading-snug text-muted">{sub}</span>}
      </span>
      {extra}
      <span className="grid size-4 shrink-0 place-items-center">{selected && <Check className="size-4 text-safe" />}</span>
    </button>
  );
}

// --- Language picker ---

export function LanguagePicker({ caps, value, onChange }: { caps: AudioCaps; value: string; onChange: (code: string) => void }) {
  if (caps.languages.length < 2) return null;
  const current = caps.languages.find((l) => l.code === value) ?? caps.languages[0];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:text-ink">
          <Globe className="size-3.5" />
          <span>{current.label}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content collisionPadding={12} side="top" align="start" sideOffset={8} className="menu min-w-44">
          <div className="eyebrow px-2.5 pb-1 pt-1.5">Langue du texte</div>
          {caps.languages.map((l) => (
            <DropdownMenu.Item key={l.code} className="menu-item" onSelect={() => onChange(l.code)}>
              <span className="grid size-4 place-items-center">{l.code === current.code && <Check className="size-3.5 text-safe" />}</span>
              {l.label}
              <span className="ml-auto font-mono text-[10.5px] uppercase text-faint">{l.code}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
