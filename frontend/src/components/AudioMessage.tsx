import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AudioLines, Check, Copy, Download, Ellipsis, Heart, Mic, Pause, PencilLine, Play, RefreshCw, Repeat, Square, Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Asset, type Message, type ModelInfo } from "../lib/api";
import { autoplay, clock, usePlayer } from "../lib/audio";
import { focusComposer } from "../lib/composer";
import { cx, formatClock, formatDuration, formatTime } from "../lib/format";
import { useModels } from "../lib/queries";
import { useStore } from "../lib/store";
import { confirm } from "./Confirm";
import { useNow } from "./EngineCard";
import { copy } from "./Message";
import { IconButton, Spinner, Tip } from "./ui";
import { Waveform, WaveformPending } from "./Waveform";

const ACTIVE = ["queued", "loading", "running"];
const RATES = [0.75, 1, 1.25, 1.5, 2];
const autoplayed = new Set<string>();

// --- Message de réponse ------------------------------------------------------------------------------

export function AudioAssistantMessage({ message }: { message: Message }) {
  const { data } = useModels();
  const model = data?.models.find((m) => m.id === message.model_id);
  const progress = useStore((s) => s.progress[message.id]);
  const engine = useStore((s) => s.engine);
  const auto = useStore((s) => s.autoplay);
  const active = ACTIVE.includes(message.status);
  const count = message.params.count ?? 1;
  const queuePos = engine?.queue.indexOf(message.id) ?? -1;

  // Lecture automatique de la première prise qui vient d'être générée (pas au rechargement d'une conversation).
  useEffect(() => {
    const first = message.outputs[0];
    if (!auto || !first || autoplayed.has(first.id)) return;
    autoplayed.add(first.id);
    if (Date.now() / 1000 - first.created_at < 8 && !usePlayer.getState().playing) autoplay(first.id, first.url);
  }, [message.outputs, auto]);

  const slots: ({ kind: "take"; asset: Asset } | { kind: "pending"; running: boolean })[] = [];
  for (let i = 0; i < count; i++) {
    const asset = message.outputs[i];
    if (asset) slots.push({ kind: "take", asset });
    else if (active) slots.push({ kind: "pending", running: message.status === "running" && i === (progress?.index ?? 0) });
  }

  return (
    <div className="group/msg flex gap-3 animate-rise">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 ring-1 ring-line">
        <AudioLines className={cx("size-4 text-safe", active && "animate-breathe")} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-medium text-ink">{model?.name ?? message.model_id}</span>
          <StatusLine message={message} model={model} queuePos={queuePos} />
        </div>

        {slots.length > 0 && (
          <div className="max-w-[680px] space-y-2">
            {slots.map((slot, i) =>
              slot.kind === "take" ? (
                <TakeCard key={slot.asset.id} asset={slot.asset} index={i} total={count} />
              ) : (
                <PendingTake key={`p${i}`} running={slot.running} fraction={slot.running && progress?.total ? (progress.step ?? 0) / progress.total : 0} />
              ),
            )}
          </div>
        )}

        {message.status === "error" && (
          <div className="mt-1 flex max-w-xl items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <span className="min-w-0 break-words">{message.error ?? "Erreur inconnue."}</span>
          </div>
        )}
        {message.status === "cancelled" && message.outputs.length === 0 && <div className="mt-1 text-[13px] italic text-faint">Synthèse annulée.</div>}

        <Footer message={message} active={active} />
      </div>
    </div>
  );
}

function StatusLine({ message, model, queuePos }: { message: Message; model?: ModelInfo; queuePos: number }) {
  const progress = useStore((s) => s.progress[message.id]);
  const now = useNow(message.status === "loading" || message.status === "running");
  const p = message.params;

  if (message.status === "queued")
    return <span className="font-mono text-[11px] text-faint">en file d'attente{queuePos > 0 ? ` · position ${queuePos + 1}` : ""}</span>;
  if (message.status === "loading") {
    const since = progress?.load_started_at ?? message.started_at ?? now;
    return (
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-warn">
        <Spinner className="size-3" /> chargement du modèle · {formatClock(now - since)}
      </span>
    );
  }
  if (message.status === "running") {
    const count = p.count ?? 1;
    return (
      <span className="font-mono text-[11px] text-safe">
        {progress?.step ? `passage ${progress.step}/${progress.total}` : "synthèse…"}
        {count > 1 && ` · prise ${(progress?.index ?? 0) + 1}/${count}`}
        {progress?.eta != null && progress.step ? ` · ~${formatDuration(progress.eta)} restantes` : ""}
      </span>
    );
  }
  const lang = model?.audio?.languages.find((l) => l.code === p.language)?.label;
  const duration = message.finished_at && message.started_at ? message.finished_at - message.started_at : null;
  return (
    <span className="font-mono text-[11px] text-faint">
      {[lang, message.status === "done" && duration ? `généré en ${formatDuration(duration)}` : null, formatTime(message.created_at)]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

// --- Prise (lecteur) --------------------------------------------------------------------------------------

export function TakeCard({ asset, index = 0, total = 1, compact = false }: { asset: Asset; index?: number; total?: number; compact?: boolean }) {
  const mine = usePlayer((s) => s.id === asset.id);
  const playing = usePlayer((s) => s.id === asset.id && s.playing);
  const time = usePlayer((s) => (s.id === asset.id ? s.time : 0));
  const live = usePlayer((s) => (s.id === asset.id ? s.duration : 0));
  const rate = usePlayer((s) => s.rate);
  const toggle = usePlayer((s) => s.toggle);
  const seek = usePlayer((s) => s.seek);
  const setRate = usePlayer((s) => s.setRate);
  const duration = asset.duration ?? live;
  const peaks = (asset.meta.peaks as number[] | undefined) ?? [];
  const markers = (asset.meta.markers as { start: number; label: string | null }[] | undefined)?.filter((m) => m.label) ?? [];
  const palette = useSpeakerColors(markers.map((m) => m.label!));
  const progress = mine && duration ? Math.min(1, time / duration) : 0;
  const fresh = Date.now() / 1000 - asset.created_at < 8;

  return (
    <div className={cx("group/take panel rounded-2xl", fresh && "animate-develop")}>
      <div className="flex items-center gap-3 px-3.5 pb-2 pt-3">
        <button
          onClick={() => toggle(asset.id, asset.url)}
          aria-label={playing ? "Pause" : "Lecture"}
          className={cx(
            "grid size-10 shrink-0 place-items-center rounded-full transition-all",
            playing ? "bg-safe text-safe-ink shadow-[0_0_22px_-4px_var(--safe-glow)]" : "bg-surface-3 text-ink hover:bg-safe hover:text-safe-ink",
          )}
        >
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
        </button>
        <Waveform
          peaks={peaks}
          progress={progress}
          active={playing}
          onSeek={(f) => seek(asset.id, asset.url, f)}
          className={compact ? "h-9 flex-1" : "h-12 flex-1"}
        />
        <div className="w-[76px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-ink-2">
          {clock(mine ? time : 0)}
          <span className="text-faint"> / {clock(duration)}</span>
        </div>
      </div>

      {markers.length > 1 && duration > 0 && (
        <div className="relative mx-3.5 mb-1 ml-[66px] mr-[102px] h-5">
          {markers.map((m, i) => (
            <button
              key={i}
              onClick={() => seek(asset.id, asset.url, m.start / duration)}
              style={{ left: `${(m.start / duration) * 100}%`, color: palette[m.label!] }}
              className="absolute top-0 flex -translate-x-px items-center gap-1 border-l-2 border-current pl-1.5 font-mono text-[10px] uppercase tracking-wide opacity-90 hover:opacity-100"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-0.5">
        <span className="min-w-0 flex-1 truncate pl-1 font-mono text-[10.5px] text-faint">
          {[total > 1 ? `prise ${index + 1}` : null, asset.meta.voice as string | undefined, asset.seed != null ? `seed ${asset.seed}` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <RateMenu rate={rate} onChange={setRate} />
        <FavoriteButton asset={asset} />
        <IconButton label="Télécharger (WAV)" size="sm" onClick={() => downloadAudio(asset)}>
          <Download className="size-3.5" />
        </IconButton>
        <TakeMenu asset={asset} />
      </div>
    </div>
  );
}

const SPEAKER_COLORS = ["var(--safe)", "#7fb8e8", "#9bd18a", "#e2b25c", "#c79be0", "#e88a9e"];
function useSpeakerColors(names: string[]) {
  const map: Record<string, string> = {};
  [...new Set(names)].forEach((n, i) => (map[n] = SPEAKER_COLORS[i % SPEAKER_COLORS.length]));
  return map;
}

function FavoriteButton({ asset }: { asset: Asset }) {
  return (
    <IconButton
      label={asset.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
      size="sm"
      active={asset.favorite}
      onClick={() => api.patchAsset(asset.id, { favorite: !asset.favorite }).catch((e) => toast.error(e.message))}
    >
      <Heart className={cx("size-3.5", asset.favorite && "fill-[var(--safe)] text-safe")} />
    </IconButton>
  );
}

function RateMenu({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  return (
    <DropdownMenu.Root>
      <Tip label="Vitesse de lecture">
        <DropdownMenu.Trigger asChild>
          <button className="h-7 rounded-lg px-2 font-mono text-[11.5px] text-muted transition-colors hover:bg-surface-3 hover:text-ink">
            {rate}×
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content collisionPadding={12} align="end" sideOffset={4} className="menu min-w-24">
          {RATES.map((r) => (
            <DropdownMenu.Item key={r} className="menu-item font-mono text-[12.5px]" onSelect={() => onChange(r)}>
              <span className="grid size-4 place-items-center">{r === rate && <Check className="size-3.5 text-safe" />}</span>
              {r}×
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function TakeMenu({ asset }: { asset: Asset }) {
  const openStudio = useStore((s) => s.openVoiceStudio);
  const saveAsVoice = async () => {
    const meta = asset.meta as { voice?: string; prompt?: string; instruct?: string; language?: string };
    try {
      const v = await api.voiceFromAsset({
        asset_id: asset.id,
        name: meta.voice && meta.voice !== "Voix décrite" ? `${meta.voice} (copie)` : "Voix créée",
        description: meta.instruct ?? "",
        transcript: meta.prompt ?? "",
        language: meta.language ?? null,
        kind: meta.instruct && !meta.voice?.includes("(") ? "design" : "clone",
      });
      toast.success(`« ${v.name} » ajoutée à vos voix`, { action: { label: "Modifier", onClick: () => openStudio({ voiceId: v.id }) } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: "Supprimer cette prise ?", description: "Le fichier audio sera supprimé.", confirmLabel: "Supprimer", danger: true });
    if (ok) api.deleteAsset(asset.id).catch((e) => toast.error(e.message));
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button aria-label="Plus d'actions" className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink">
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content collisionPadding={12} align="end" sideOffset={4} className="menu min-w-60">
          <DropdownMenu.Item className="menu-item" onSelect={saveAsVoice}>
            <Mic className="size-4" /> Garder comme voix de référence
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => copy(String(asset.meta.prompt ?? ""))}>
            <Copy className="size-4" /> Copier le texte
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className="menu-item" data-danger onSelect={remove}>
            <Trash2 className="size-4" /> Supprimer la prise
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PendingTake({ running, fraction }: { running: boolean; fraction: number }) {
  return (
    <div className="panel relative overflow-hidden rounded-2xl">
      {running && <div className="shimmer pointer-events-none absolute inset-0" />}
      <div className="flex items-center gap-3 px-3.5 py-3.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-faint">
          {running ? <Spinner /> : <Play className="ml-0.5 size-4 fill-current opacity-50" />}
        </div>
        <div className="h-12 flex-1">
          <WaveformPending fraction={fraction} active={running} />
        </div>
        <div className="w-[76px] shrink-0 text-right font-mono text-[11.5px] text-faint">{running ? `${Math.round(fraction * 100)} %` : "en attente"}</div>
      </div>
    </div>
  );
}

// --- Actions du message --------------------------------------------------------------------------------------

function Footer({ message, active }: { message: Message; active: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    return (
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={run(() => api.cancel(message.id))}
          disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 transition-colors hover:border-danger/50 hover:text-danger"
        >
          <Square className="size-3 fill-current" /> Annuler
        </button>
      </div>
    );
  }

  const reuse = () => {
    const s = useStore.getState();
    const id = message.model_id!;
    s.setAudioModel(id);
    s.setAudioPrompt(message.prompt);
    const { voice, language, instruct, seeds, count, steps, seed, ...rest } = message.params as Record<string, unknown> & { seeds?: number[]; count?: number };
    void steps;
    void seed;
    if (voice) s.setVoice(id, voice as never);
    if (typeof language === "string") s.setLanguage(id, language);
    if (typeof instruct === "string") s.setInstruct(id, instruct);
    s.setParams(id, Object.fromEntries(Object.entries(rest).filter(([k]) => !["cast", "references_used"].includes(k))));
    if (count) s.setAudioCount(count);
    s.setSeed(seeds?.[0] ?? null);
    toast.success("Réglages repris (graine fixée)", { duration: 1800 });
    focusComposer(true);
  };
  const remove = async () => {
    const ok = await confirm({ title: "Supprimer cette synthèse ?", description: "Les fichiers audio seront supprimés.", confirmLabel: "Supprimer", danger: true });
    if (ok) run(() => api.deleteMessage(message.id))();
  };

  return (
    <div className="mt-2 flex items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
      <Tip label="Nouvelles prises (graines aléatoires)">
        <button
          onClick={run(() => api.retry(message.id))}
          disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <RefreshCw className="size-3.5" /> Refaire
        </button>
      </Tip>
      <IconButton label="Relancer avec les mêmes graines" size="sm" onClick={run(() => api.retry(message.id, { keep_seed: true }))}>
        <Repeat className="size-3.5" />
      </IconButton>
      <IconButton label="Reprendre texte et réglages dans le composer" size="sm" onClick={reuse}>
        <PencilLine className="size-3.5" />
      </IconButton>
      <IconButton label="Supprimer la synthèse" size="sm" tone="danger" onClick={remove}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </div>
  );
}

export function downloadAudio(asset: Asset) {
  const a = document.createElement("a");
  a.href = asset.url;
  const text = String(asset.meta?.prompt ?? "audio");
  const slug = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
  a.download = `${slug || "audio"}-${asset.seed ?? asset.id}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

