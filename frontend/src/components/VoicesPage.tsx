// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useMemo } from "react";
import { AudioLines, Mic, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Voice } from "../lib/api";
import { clock, usePlayer } from "../lib/audio";
import { focusComposer } from "../lib/composer";
import { cx } from "../lib/format";
import { useModels, useVoices } from "../lib/queries";
import { navigate, paths } from "../lib/router";
import { useStore } from "../lib/store";
import { confirm } from "./Confirm";
import { VoiceAvatar } from "./VoicePicker";
import { Waveform } from "./Waveform";
import { Button, IconButton, Spinner } from "./ui";

export function VoicesPage() {
  const { data: voices, isLoading } = useVoices();
  const openStudio = useStore((s) => s.openVoiceStudio);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line/60 px-5 pl-14 md:pl-5">
        <h1 className="font-display text-2xl text-ink">Mes voix</h1>
        <span className="font-mono text-[11px] text-faint">{voices?.length ?? 0} voix</span>
        <div className="flex-1" />
        <Button variant="primary" onClick={() => openStudio()}>
          <Plus className="size-4" /> Ajouter une voix
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isLoading && <div className="grid h-40 place-items-center text-muted"><Spinner /></div>}
        {!isLoading && voices?.length === 0 && (
          <div className="mx-auto mt-16 max-w-md text-center">
            <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-surface-2 text-safe ring-1 ring-line">
              <Mic className="size-7" />
            </div>
            <h2 className="font-display text-3xl text-ink">Donnez-leur <em className="text-safe">votre</em> voix</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted">
              Enregistrez-vous ou importez un extrait de quelques secondes : n'importe quel texte pourra ensuite être lu avec cette voix,
              en local, sans rien envoyer à personne.
            </p>
            <Button variant="primary" className="mt-6" onClick={() => openStudio()}>
              <Mic className="size-4" /> Enregistrer ma voix
            </Button>
          </div>
        )}
        <div className="mx-auto grid max-w-[1000px] gap-3 md:grid-cols-2">
          {voices?.map((v) => <VoiceCard key={v.id} voice={v} />)}
        </div>
      </div>
    </div>
  );
}

function VoiceCard({ voice: v }: { voice: Voice }) {
  const openStudio = useStore((s) => s.openVoiceStudio);
  const { data: catalog } = useModels();
  const playing = usePlayer((s) => s.id === v.id && s.playing);
  const time = usePlayer((s) => (s.id === v.id ? s.time : 0));
  const toggle = usePlayer((s) => s.toggle);
  const seek = usePlayer((s) => s.seek);

  // A model that can clone: a ready one first, else the easiest to install.
  const cloner = useMemo(
    () =>
      (catalog?.models ?? [])
        .filter((m) => m.kind === "audio" && m.audio?.task === "tts" && m.audio.clone !== "none" && m.compatible)
        .sort((a, b) => Number(b.ready) - Number(a.ready) || (a.download_size_gb ?? 0) - (b.download_size_gb ?? 0)),
    [catalog],
  );

  const use = () => {
    const s = useStore.getState();
    const current = catalog?.models.find((m) => m.id === s.audioModelId);
    const model = current?.audio?.clone !== "none" && current?.audio?.task === "tts" && current?.compatible ? current : cloner[0];
    if (!model) return toast.error("Aucun modèle de clonage n'est disponible sur cette machine.");
    s.setAudioModel(model.id);
    s.setVoice(model.id, { source: "library", id: v.id });
    if (v.language && model.audio?.languages.some((l) => l.code === v.language)) s.setLanguage(model.id, v.language);
    navigate(paths.audioHome);
    focusComposer();
    toast.success(`« ${v.name} » sélectionnée avec ${model.name}`, { duration: 2200 });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer « ${v.name} » ?`,
      description: "L'enregistrement de référence sera supprimé. Les prises déjà générées avec cette voix sont conservées.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok) api.deleteVoice(v.id).catch((e) => toast.error(e.message));
  };

  return (
    <article className="panel group rounded-2xl p-4 animate-rise">
      <div className="flex items-center gap-3">
        <VoiceAvatar name={v.name} size={38} library />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium text-ink">{v.name}</h3>
          <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-faint">
            <span>{v.kind === "design" ? "voix inventée" : "voix clonée"}</span>
            {v.language && <span>· {v.language.toUpperCase()}</span>}
            {v.duration && <span>· {clock(v.duration)}</span>}
            {!v.transcript && <span className="text-warn">· sans transcription</span>}
          </div>
        </div>
        <IconButton label="Modifier" size="sm" onClick={() => openStudio({ voiceId: v.id })}><Pencil className="size-3.5" /></IconButton>
        <IconButton label="Supprimer" size="sm" tone="danger" onClick={remove}><Trash2 className="size-3.5" /></IconButton>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => v.url && toggle(v.id, v.url)}
          aria-label={playing ? "Pause" : "Écouter"}
          className={cx("grid size-9 shrink-0 place-items-center rounded-full transition-colors", playing ? "bg-safe text-safe-ink" : "bg-surface-3 text-ink hover:bg-safe hover:text-safe-ink")}
        >
          {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}
        </button>
        <Waveform peaks={v.peaks} progress={v.duration ? time / v.duration : 0} active={playing} onSeek={(f) => v.url && seek(v.id, v.url, f)} className="h-9 flex-1" />
      </div>

      {(v.transcript || v.description) && (
        <p className="mt-3 line-clamp-2 text-[12.5px] italic leading-snug text-muted">« {v.transcript || v.description} »</p>
      )}

      <Button variant="secondary" className="mt-3 w-full" onClick={use}>
        <AudioLines className="size-4" /> Écrire avec cette voix
      </Button>
    </article>
  );
}
