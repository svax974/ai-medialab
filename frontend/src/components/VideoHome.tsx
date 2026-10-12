// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Play } from "lucide-react";
import { api } from "../lib/api";
import { clock } from "../lib/audio";
import { focusComposer } from "../lib/composer";
import { useStore } from "../lib/store";
import { WelcomeSetup } from "./Setup";
import { VideoComposer } from "./VideoComposer";

const SUGGESTIONS = [
  {
    label: "Paysage",
    prompt: "Plan large au drone au-dessus d'un lac de montagne à l'aube, brume qui se lève lentement entre les sapins, lumière dorée, mouvement de caméra fluide vers l'avant",
  },
  {
    label: "Portrait",
    prompt: "Gros plan sur une vieille horlogère qui ajuste un mouvement avec une pince fine, poussière dans un rai de lumière, profondeur de champ réduite, léger travelling latéral",
  },
  {
    label: "Urbain",
    prompt: "Rue de Paris sous la pluie, la nuit, néons qui se reflètent sur les pavés mouillés, passants avec des parapluies, caméra à l'épaule qui suit une cycliste",
  },
  {
    label: "Animation",
    prompt: "Un petit renard en papier plié traverse une forêt de papier découpé, animation en volume, éclairage chaud de studio, mouvement image par image",
  },
];

export function VideoHome() {
  const setPrompt = useStore((s) => s.setVideoPrompt);
  const { data: recent } = useQuery({ queryKey: ["assets", false, "", "video", "recent"], queryFn: () => api.assets({ media: "video" }) });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="pointer-events-none absolute left-1/2 top-[-20%] h-[60vh] w-[80vw] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--safe-soft),transparent)] blur-2xl" />

      <div className="relative mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center px-5 py-16">
        <div className="mb-9 text-center">
          <p className="eyebrow mb-4 animate-rise">Studio vidéo local</p>
          <h1 className="font-display text-[clamp(40px,6vw,68px)] leading-[0.95] tracking-tight text-ink animate-rise [animation-delay:60ms]">
            Que voulez-vous <em className="text-safe">tourner</em>&nbsp;?
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted animate-rise [animation-delay:120ms]">
            Décrivez une scène, animez une image — ou déposez une vidéo pour la modifier. Tout est calculé sur cette machine.
          </p>
        </div>

        <div className="animate-rise [animation-delay:180ms]">
          <WelcomeSetup kind="video" />
          <VideoComposer conversationId={null} hero />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 animate-rise [animation-delay:240ms]">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setPrompt(s.prompt);
                focusComposer();
              }}
              className="group flex items-start gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface"
            >
              <div className="min-w-0 flex-1">
                <div className="eyebrow mb-1 text-safe">{s.label}</div>
                <div className="line-clamp-2 text-[13px] leading-snug text-ink-2">{s.prompt}</div>
              </div>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint transition-colors group-hover:text-ink" />
            </button>
          ))}
        </div>

        {recent && recent.items.length > 0 && (
          <div className="mt-12 animate-rise [animation-delay:300ms]">
            <div className="eyebrow mb-3">Derniers clips</div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {recent.items.slice(0, 10).map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => useStore.getState().openLightbox(recent.items, i)}
                  className="relative aspect-video h-24 shrink-0 overflow-hidden rounded-xl ring-1 ring-line transition-transform hover:-translate-y-0.5"
                >
                  <img src={a.thumb_url} alt="" className="size-full object-cover" loading="lazy" />
                  <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-black/60 px-1 font-mono text-[9px] text-white/90">
                    <Play className="size-2 fill-current" /> {a.duration ? clock(a.duration) : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
