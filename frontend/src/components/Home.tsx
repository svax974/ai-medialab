import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { api } from "../lib/api";
import { focusComposer } from "../lib/composer";
import { useStore } from "../lib/store";
import { Composer } from "./Composer";

const SUGGESTIONS = [
  {
    label: "Portrait",
    prompt: "Portrait en clair-obscur d'une vieille horlogère dans son atelier, loupe à l'œil, poussière dans un rai de lumière, pellicule Portra 400, grain fin",
  },
  {
    label: "Affiche",
    prompt: "Affiche rétro d'un festival de jazz à Lyon, typographie art déco dorée, texte « Jazz à Fourvière — Juillet 1958 », saxophoniste en silhouette",
  },
  {
    label: "Miniature",
    prompt: "Vue isométrique d'un minuscule café parisien la nuit, style diorama miniature, éclairage chaud aux fenêtres, pavés mouillés, profondeur de champ réduite",
  },
  {
    label: "Produit",
    prompt: "Photographie produit d'un flacon de parfum en verre fumé posé sur une pierre volcanique, fond sable, lumière rasante, ombres douces, style éditorial",
  },
];

export function Home() {
  const setPrompt = useStore((s) => s.setPrompt);
  const { data: recent } = useQuery({ queryKey: ["assets", false, "", "recent"], queryFn: () => api.assets({}) });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Halo de lumière inactinique */}
      <div className="pointer-events-none absolute left-1/2 top-[-20%] h-[60vh] w-[80vw] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--safe-soft),transparent)] blur-2xl" />

      <div className="relative mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center px-5 py-16">
        <div className="mb-9 text-center">
          <p className="eyebrow mb-4 animate-rise">Studio local · Apple Silicon</p>
          <h1 className="font-display text-[clamp(40px,6vw,68px)] leading-[0.95] tracking-tight text-ink animate-rise [animation-delay:60ms]">
            Que voulez-vous <em className="text-safe">révéler</em>&nbsp;?
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted animate-rise [animation-delay:120ms]">
            Décrivez une image, ou glissez des photos pour les transformer. Tout est calculé sur cette machine.
          </p>
        </div>

        <div className="animate-rise [animation-delay:180ms]">
          <Composer conversationId={null} hero />
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
            <div className="eyebrow mb-3">Derniers tirages</div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {recent.items.slice(0, 12).map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => useStore.getState().openLightbox(recent.items, i)}
                  className="size-24 shrink-0 overflow-hidden rounded-xl ring-1 ring-line transition-transform hover:-translate-y-0.5"
                >
                  <img src={a.thumb_url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
