// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// Video model specifics shared by the picker and the model cards.
import { KeyRound, TriangleAlert, Volume2 } from "lucide-react";
import type { ModelInfo } from "../lib/api";
import { cx, formatSeconds } from "../lib/format";
import { HELP } from "../lib/help";
import { TASK_LABEL } from "../lib/video";
import { HelpBody, InfoTip, Tip } from "./ui";

const TASK_HELP = {
  t2v: "Texte → vidéo : le modèle invente le clip à partir de votre description seule.",
  i2v: "Image → vidéo : le modèle anime une image de départ (et parfois d'arrivée) en suivant votre prompt.",
  v2v: "Montage vidéo : le modèle modifie une vidéo existante selon votre prompt, en gardant son mouvement.",
} as const;

const chip = "rounded-md bg-surface px-1.5 py-px font-mono text-[9.5px] text-muted ring-1 ring-line";

/** What the model can do: tasks, maximum length, sound, language. */
export function VideoBadges({ model }: { model: ModelInfo }) {
  const v = model.video;
  if (!v) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {v.tasks.map((t) => (
        <Tip key={t} wide label={TASK_HELP[t]}>
          <span className={cx(chip, "cursor-help")}>{TASK_LABEL[t]}</span>
        </Tip>
      ))}
      <Tip wide label={<HelpBody {...HELP.seconds} title="Durée maximale d'un clip" />}>
        <span className={cx(chip, "cursor-help")}>jusqu'à {formatSeconds(v.max_seconds)}</span>
      </Tip>
      {v.resolutions.length > 0 && (
        <Tip wide label={<HelpBody {...HELP.resolution} title="Définitions proposées" />}>
          <span className={cx(chip, "cursor-help")}>{v.resolutions.map((r) => r.label).join(" · ")}</span>
        </Tip>
      )}
      {v.audio_out && (
        <Tip wide label={<HelpBody {...HELP.audio_out} />}>
          <span className={cx(chip, "flex cursor-help items-center gap-1")}>
            <Volume2 className="size-3" /> avec son
          </span>
        </Tip>
      )}
      {v.english_only && (
        <Tip wide label={<HelpBody {...HELP.english_only} />}>
          <span className={cx(chip, "cursor-help")}>anglais</span>
        </Tip>
      )}
    </div>
  );
}

/** Licence restriction, in warning tone. Renders nothing when the model has none. */
export function LicenseWarning({ model, className }: { model: ModelInfo; className?: string }) {
  const text = model.video?.license_warning;
  if (!text) return null;
  return (
    <div className={cx("flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] leading-snug text-ink-2", className)}>
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
      <span className="min-w-0 flex-1">
        <b className="font-medium text-warn">Licence :</b> {text}
      </span>
      <InfoTip {...HELP.license} />
    </div>
  );
}

/** Gated Hugging Face files: what to do before downloading. Renders nothing for the other models. */
export function GatedNotice({ model, className }: { model: ModelInfo; className?: string }) {
  if (!model.gated) return null;
  return (
    <div className={cx("flex items-start gap-2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-[12px] leading-snug text-ink-2", className)}>
      <KeyRound className="mt-px size-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <b className="font-medium text-ink">Accès restreint :</b> acceptez la licence sur Hugging Face, puis renseignez votre jeton dans Réglages → Modèles.
      </span>
    </div>
  );
}
