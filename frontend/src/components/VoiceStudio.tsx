// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { CloudDownload, Mic, Pause, Play, Sparkles, Square, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Voice } from "../lib/api";
import { clock, filePeaks, toWavFile, usePlayer, useRecorder } from "../lib/audio";
import { cx } from "../lib/format";
import { keys, queryClient, useModels, useVoices } from "../lib/queries";
import { useStore } from "../lib/store";
import { Waveform } from "./Waveform";
import { HELP } from "../lib/help";
import { Button, IconButton, InfoTip, Spinner, type Help } from "./ui";

const LANGS = [
  ["fr", "Français"], ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"],
  ["nl", "Nederlands"], ["zh", "中文"], ["ja", "日本語"], ["ko", "한국어"], ["ru", "Русский"],
] as const;

// Text read aloud while recording: varied vowels, consonants and intonation, about 20 s at a calm pace.
const READING: Record<string, string> = {
  fr: "Le matin, quand la ville s'éveille, j'aime marcher lentement le long du fleuve. L'air est frais, les péniches glissent sans un bruit, et quelque part une boulangerie ouvre ses portes. Est-ce que vous avez déjà remarqué à quel point le silence peut être beau ?",
  en: "In the morning, when the city wakes up, I like to walk slowly along the river. The air is cool, the barges glide by without a sound, and somewhere a bakery opens its doors. Have you ever noticed how beautiful silence can be?",
};

export function VoiceStudio() {
  const state = useStore((s) => s.voiceStudio);
  const close = useStore((s) => s.closeVoiceStudio);
  return (
    <Dialog.Root open={!!state} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm animate-fade" />
        <Dialog.Content
          aria-describedby={undefined}
          className="panel fixed left-1/2 top-1/2 z-[61] flex max-h-[min(780px,92vh)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl animate-rise"
        >
          {state && <Studio key={state.voiceId ?? "new"} initialFile={state.file} voiceId={state.voiceId} onClose={close} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Studio({ initialFile, voiceId, onClose }: { initialFile?: File; voiceId?: string; onClose: () => void }) {
  const { data: voices } = useVoices();
  const existing = voiceId ? voices?.find((v) => v.id === voiceId) : undefined;
  const { data: catalog } = useModels();
  const whisperReady = catalog?.models.some((m) => m.audio?.task === "stt" && m.ready) ?? false;

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ peaks: number[]; duration: number; url: string } | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>(voiceId);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("fr");
  const [transcript, setTranscript] = useState("");
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "transcribe" | "decode">("");
  const dropRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (existing && !name) {
      setName(existing.name);
      setLanguage(existing.language ?? "fr");
      setTranscript(existing.transcript);
    }
  }, [existing]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (raw: Blob, fileName: string) => {
    setBusy("decode");
    try {
      let wav: File;
      try {
        wav = await toWavFile(raw, fileName);
      } catch {
        wav = raw instanceof File ? raw : new File([raw], fileName); // format the browser can't decode: let the server try
      }
      const info = await filePeaks(wav).catch(() => ({ peaks: [], duration: 0 }));
      if (info.duration && info.duration < 1) return toast.error("Extrait trop court : il faut au moins une seconde de parole.");
      setFile(wav);
      setPreview({ ...info, url: URL.createObjectURL(wav) });
      if (!name) setName(fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60) || "Ma voix");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (initialFile) void load(initialFile, initialFile.name);
  }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const recorder = useRecorder((blob) => {
    setRecorded(true);
    setTranscript((t) => t || READING[language] || READING.en);
    void load(blob, "Enregistrement.wav");
  });

  /** Creates the voice once; later calls only update it. */
  const ensureSaved = async (): Promise<Voice | null> => {
    if (savedId) {
      return api.patchVoice(savedId, { name: name.trim() || "Ma voix", transcript, language });
    }
    if (!file) return null;
    const form = new FormData();
    form.append("file", file);
    form.append("name", name.trim() || "Ma voix");
    form.append("transcript", transcript);
    form.append("language", language);
    const v = await api.createVoice(form);
    setSavedId(v.id);
    return v;
  };

  const save = async () => {
    setBusy("save");
    try {
      const v = await ensureSaved();
      if (v) {
        await queryClient.invalidateQueries({ queryKey: keys.voices });
        toast.success(`Voix « ${v.name} » enregistrée`);
      }
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const transcribe = async () => {
    setBusy("transcribe");
    try {
      const v = await ensureSaved();
      if (!v) return;
      const r = await api.transcribeVoice(v.id, { language });
      setTranscript(r.text);
      await api.patchVoice(v.id, { transcript: r.text });
      queryClient.invalidateQueries({ queryKey: keys.voices });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const hasAudio = !!file || !!existing;
  const peaks = preview?.peaks ?? existing?.peaks ?? [];
  const url = preview?.url ?? existing?.url ?? null;
  const duration = preview?.duration || existing?.duration || 0;
  const canSave = hasAudio && name.trim().length > 0 && !busy && !(preview?.duration && preview.duration < 1);

  return (
    <>
      <div className="flex items-center justify-between px-6 pb-1 pt-5">
        <Dialog.Title className="font-display text-[28px] text-ink">{voiceId ? "Modifier la voix" : "Nouvelle voix"}</Dialog.Title>
        <Dialog.Close asChild>
          <IconButton label="Fermer"><X className="size-4" /></IconButton>
        </Dialog.Close>
      </div>

      <div className="space-y-5 overflow-y-auto px-6 pb-6 pt-2">
        {!hasAudio && (
          <>
            {recorder.state === "recording" ? (
              <RecordingPanel seconds={recorder.seconds} level={recorder.level} onStop={recorder.stop} script={READING[language] ?? READING.en} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <BigChoice
                  icon={<Mic className="size-6" />}
                  title="Enregistrer"
                  sub={recorder.state === "denied" ? "Accès au micro refusé par le navigateur" : recorder.state === "unsupported" ? "Micro indisponible ici" : "Lisez un court texte, 15 à 30 s"}
                  disabled={recorder.state === "unsupported" || recorder.state === "requesting"}
                  warn={recorder.state === "denied"}
                  onClick={recorder.start}
                />
                <BigChoice
                  icon={busy === "decode" ? <Spinner className="size-6" /> : <Upload className="size-6" />}
                  title="Importer un fichier"
                  sub="WAV, MP3, M4A, FLAC, OGG… ou glissez-le ici"
                  onClick={() => dropRef.current?.click()}
                />
                <input
                  ref={dropRef}
                  type="file"
                  accept="audio/*,video/mp4,video/webm"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void load(f, f.name);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            {recorder.state !== "recording" && (
              <div className="flex items-center gap-1 text-[12.5px] text-ink-2">
                Extrait de référence <InfoTip {...HELP.clone_sample} />
              </div>
            )}
            {recorder.state !== "recording" && (
              <ul className="-mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
                <li>· 10 à 30 secondes d'une seule voix, sans musique ni écho, à distance constante du micro.</li>
                <li>· Une voix claire, au ton que vous voulez retrouver : le modèle imite aussi l'émotion et le rythme de l'extrait.</li>
                <li>· Ne clonez que votre propre voix, ou celle d'une personne qui y a consenti.</li>
              </ul>
            )}
          </>
        )}

        {hasAudio && (
          <>
            <PreviewPlayer id={`studio-${savedId ?? "new"}`} url={url} peaks={peaks} duration={duration} />
            {preview && !voiceId && !savedId && (
              <button onClick={() => { setFile(null); setPreview(null); setRecorded(false); }} className="text-[12px] text-faint underline-offset-2 hover:text-ink hover:underline">
                Choisir un autre extrait
              </button>
            )}
            {duration > 30 && <p className="text-[12px] text-warn">Seules les 30 premières secondes seront utilisées.</p>}

            <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
              <Field label="Nom">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ma voix" maxLength={80} className={inputCls} />
              </Field>
              <Field
                label="Langue parlée"
                help={{ title: "Langue parlée", body: "Langue de l'extrait. Elle sert à retrouver la voix par langue et à guider la transcription automatique ; le modèle sait ensuite faire parler cette voix dans d'autres langues (avec un accent possible)." }}
              >
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={cx(inputCls, "pr-2")}>
                  {LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </select>
              </Field>
            </div>

            <Field
              label="Transcription de l'extrait"
              hint="Facultative ; améliore le clonage."
              help={HELP.transcript}
              action={
                whisperReady ? (
                  <button onClick={transcribe} disabled={!!busy} className="flex items-center gap-1.5 text-[12px] text-safe hover:brightness-125 disabled:opacity-50">
                    {busy === "transcribe" ? <Spinner className="size-3" /> : <Sparkles className="size-3.5" />} Transcrire automatiquement
                  </button>
                ) : (
                  <span className="text-[11.5px] text-faint">Aucun modèle de transcription installé (voir Modèles → Audio) · <WhisperInstall /></span>
                )
              }
            >
              <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} placeholder="Ce que dit la personne dans l'extrait…" className={cx(inputCls, "h-auto resize-none py-2 leading-relaxed")} />
              {recorded && transcript && <p className="mt-1 text-[11.5px] text-faint">Pré-remplie avec le texte proposé : corrigez-la si vous avez lu autre chose.</p>}
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>Annuler</Button>
              <Button variant="primary" onClick={save} disabled={!canSave}>
                {busy === "save" && <Spinner />} {voiceId ? "Enregistrer" : "Ajouter à mes voix"}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

const inputCls =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none";

function Field({ label, hint, help, action, children }: { label: string; hint?: string; help?: Help; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-2">
          {label} {help && <InfoTip {...help} />}
        </span>
        {action}
      </div>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

function BigChoice({ icon, title, sub, onClick, disabled, warn }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean; warn?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface-2/60 p-4 text-left transition-colors hover:border-safe/50 hover:bg-safe-soft disabled:opacity-50"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-surface-3 text-ink-2 transition-colors group-hover:bg-safe group-hover:text-safe-ink">{icon}</span>
      <span>
        <span className="block text-[15px] font-medium text-ink">{title}</span>
        <span className={cx("mt-0.5 block text-[12px] leading-snug", warn ? "text-warn" : "text-muted")}>{sub}</span>
      </span>
    </button>
  );
}

function RecordingPanel({ seconds, level, onStop, script }: { seconds: number; level: number; onStop: () => void; script: string }) {
  return (
    <div className="rounded-2xl border border-safe/40 bg-safe-soft p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="relative grid size-12 shrink-0 place-items-center">
          <span className="absolute inset-0 rounded-full bg-safe/30" style={{ transform: `scale(${1 + level * 0.9})`, transition: "transform 80ms linear" }} />
          <span className="relative grid size-9 place-items-center rounded-full bg-safe text-safe-ink"><Mic className="size-4" /></span>
        </span>
        <div className="flex-1">
          <div className="text-[13px] font-medium text-ink">Enregistrement en cours</div>
          <div className="font-mono text-[12px] tabular-nums text-ink-2">{clock(seconds)}{seconds < 8 ? " · continuez, 15 à 30 s c'est idéal" : seconds > 30 ? " · c'est largement assez" : ""}</div>
        </div>
        <Button variant="primary" onClick={onStop}><Square className="size-3.5 fill-current" /> Terminer</Button>
      </div>
      <div className="eyebrow mb-1.5">Lisez à voix naturelle</div>
      <p className="rounded-xl bg-surface/70 p-3 text-[15px] leading-relaxed text-ink">{script}</p>
    </div>
  );
}

export function PreviewPlayer({ id, url, peaks, duration }: { id: string; url: string | null; peaks: number[]; duration: number }) {
  const playing = usePlayer((s) => s.id === id && s.playing);
  const time = usePlayer((s) => (s.id === id ? s.time : 0));
  const toggle = usePlayer((s) => s.toggle);
  const seek = usePlayer((s) => s.seek);
  if (!url) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/60 px-3.5 py-3">
      <button
        onClick={() => toggle(id, url)}
        aria-label={playing ? "Pause" : "Écouter"}
        className={cx("grid size-10 shrink-0 place-items-center rounded-full transition-colors", playing ? "bg-safe text-safe-ink" : "bg-surface-3 text-ink hover:bg-safe hover:text-safe-ink")}
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <Waveform peaks={peaks} progress={duration ? time / duration : 0} active={playing} onSeek={(f) => seek(id, url, f)} className="h-11 flex-1" />
      <div className="w-[76px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-ink-2">
        {clock(time)}<span className="text-faint"> / {clock(duration)}</span>
      </div>
    </div>
  );
}

function WhisperInstall() {
  const dl = useStore((s) => s.downloads["whisper-small"]);
  const { data: system } = useQuery({ queryKey: ["system"], queryFn: api.system, staleTime: 10_000 });
  const packOk = system?.packs.speech?.installed;
  const running = dl?.state === "running";
  return (
    <button
      disabled={running}
      onClick={async () => {
        try {
          if (!packOk) {
            // Engine first; the Whisper download follows automatically (SetupController).
            useStore.getState().setPendingModel("whisper-small");
            useStore.getState().setPackInstall(await api.installPack("speech"));
          } else {
            useStore.getState().setDownload(await api.downloadModel("whisper-small"));
          }
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
      className="inline-flex items-center gap-1 text-safe hover:brightness-125 disabled:opacity-60"
    >
      <CloudDownload className="size-3.5" /> {running ? "téléchargement…" : "l'installer (≈ 0,5 Go)"}
    </button>
  );
}
