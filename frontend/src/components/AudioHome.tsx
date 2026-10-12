// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { api } from "../lib/api";
import { focusComposer } from "../lib/composer";
import { useStore } from "../lib/store";
import { AudioComposer } from "./AudioComposer";
import { TakeCard } from "./AudioMessage";
import { WelcomeSetup } from "./Setup";

const SUGGESTIONS = [
  {
    label: "Narration",
    text: "Il était une fois, au bord d'un lac que personne n'avait jamais cartographié, une petite maison dont la cheminée fumait même en plein été. Les villageois racontaient que son habitante parlait aux étoiles.",
  },
  {
    label: "Annonce",
    text: "Mesdames et messieurs, le train à destination de Lyon Part-Dieu partira dans quelques instants de la voie 7. Nous vous remercions de vous éloigner de la bordure du quai.",
  },
  {
    label: "Dialogue",
    text: "Alice : Tu as vu la lumière, ce matin ? On dirait qu'elle vient d'un autre siècle.\nMarc : Je croyais que c'était le lever du soleil.\nAlice : Justement. C'est ce que je dis.",
  },
  {
    label: "Publicité",
    text: "Et si votre café du matin avait enfin le goût de vacances ? Découvrez notre torréfaction lente, à l'ancienne. Torréfié près de chez vous, savouré partout.",
  },
];

export function AudioHome() {
  const setPrompt = useStore((s) => s.setAudioPrompt);
  const { data: recent } = useQuery({ queryKey: ["assets", false, "", "audio", "recent"], queryFn: () => api.assets({ media: "audio" }) });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="pointer-events-none absolute left-1/2 top-[-20%] h-[60vh] w-[80vw] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--safe-soft),transparent)] blur-2xl" />

      <div className="relative mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center px-5 py-16">
        <div className="mb-9 text-center">
          <p className="eyebrow mb-4 animate-rise">Studio vocal local</p>
          <h1 className="font-display text-[clamp(40px,6vw,68px)] leading-[0.95] tracking-tight text-ink animate-rise [animation-delay:60ms]">
            Que voulez-vous faire <em className="text-safe">entendre</em>&nbsp;?
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted animate-rise [animation-delay:120ms]">
            Écrivez un texte, choisissez une voix — ou clonez la vôtre à partir de quelques secondes d'enregistrement. Tout est calculé sur cette machine.
          </p>
        </div>

        <div className="animate-rise [animation-delay:180ms]">
          <WelcomeSetup kind="audio" />
          <AudioComposer conversationId={null} hero />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 animate-rise [animation-delay:240ms]">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setPrompt(s.text);
                focusComposer();
              }}
              className="group flex items-start gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface"
            >
              <div className="min-w-0 flex-1">
                <div className="eyebrow mb-1 text-safe">{s.label}</div>
                <div className="line-clamp-2 whitespace-pre-line text-[13px] leading-snug text-ink-2">{s.text}</div>
              </div>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint transition-colors group-hover:text-ink" />
            </button>
          ))}
        </div>

        {recent && recent.items.length > 0 && (
          <div className="mt-12 animate-rise [animation-delay:300ms]">
            <div className="eyebrow mb-3">Dernières prises</div>
            <div className="space-y-2">
              {recent.items.slice(0, 3).map((a) => (
                <div key={a.id}>
                  <p className="mb-1 line-clamp-1 px-1 text-[12px] text-muted">{a.prompt}</p>
                  <TakeCard asset={a} compact />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
