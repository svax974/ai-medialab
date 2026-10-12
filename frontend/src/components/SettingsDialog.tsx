// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { api, type Settings } from "../lib/api";
import { cx } from "../lib/format";
import { keys, queryClient } from "../lib/queries";
import { useStore } from "../lib/store";
import { IconButton } from "./ui";

const KEEP_ALIVE = [
  { v: 0, label: "Aussitôt" },
  { v: 5, label: "5 min" },
  { v: 10, label: "10 min" },
  { v: 30, label: "30 min" },
  { v: -1, label: "Jamais" },
];

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const { data: settings } = useQuery({ queryKey: keys.settings, queryFn: api.settings, enabled: open });

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.saveSettings(patch),
    onSuccess: (s) => {
      queryClient.setQueryData(keys.settings, s);
      queryClient.invalidateQueries({ queryKey: keys.models });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm animate-fade" />
        <Dialog.Content
          aria-describedby={undefined}
          className="panel fixed left-1/2 top-1/2 z-[61] flex max-h-[min(720px,90vh)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl animate-rise"
        >
          <div className="flex items-center justify-between px-6 pb-2 pt-5">
            <Dialog.Title className="font-display text-[28px] text-ink">Réglages</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Fermer">
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>

          {settings && (
            <div className="space-y-7 overflow-y-auto px-6 pb-6 pt-2">
              <section>
                <h3 className="eyebrow mb-1">Mémoire</h3>
                <p className="mb-3 text-[13px] leading-relaxed text-muted">
                  Un modèle chargé reste en mémoire pour enchaîner les générations sans attendre. Délai avant de le décharger :
                </p>
                <div className="grid grid-cols-5 gap-1 rounded-xl bg-surface-2 p-1 ring-1 ring-line">
                  {KEEP_ALIVE.map((o) => (
                    <button
                      key={o.v}
                      onClick={() => save.mutate({ keep_alive_minutes: o.v })}
                      className={cx(
                        "rounded-lg py-1.5 text-[12.5px] transition-colors",
                        settings.keep_alive_minutes === o.v ? "bg-surface-3 text-ink shadow-sm" : "text-muted hover:text-ink",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="flex items-start justify-between gap-6">
                <div>
                  <h3 className="eyebrow mb-1">Aperçus pendant la génération</h3>
                  <p className="text-[13px] leading-relaxed text-muted">
                    Montre l'image se former quelques fois en cours de calcul. Coûte un peu de temps et de mémoire.
                  </p>
                </div>
                <Switch.Root
                  checked={settings.previews}
                  onCheckedChange={(previews) => save.mutate({ previews })}
                  className="relative mt-1 h-6 w-11 shrink-0 rounded-full bg-surface-3 ring-1 ring-line transition-colors data-[state=checked]:bg-safe"
                >
                  <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
                </Switch.Root>
              </section>

              <section className="flex items-start justify-between gap-6">
                <div>
                  <h3 className="eyebrow mb-1">Économie de mémoire</h3>
                  <p className="text-[13px] leading-relaxed text-muted">
                    Libère l'encodeur de texte (17 Go) dès que le prompt est encodé : le calcul tient dans ~9 Go au lieu de ~26 Go, et évite le swap
                    qui fait expirer le GPU. Un nouveau prompt recharge l'encodeur depuis le disque (quelques secondes).
                  </p>
                </div>
                <Switch.Root
                  checked={settings.low_memory}
                  onCheckedChange={(low_memory) => save.mutate({ low_memory })}
                  className="relative mt-1 h-6 w-11 shrink-0 rounded-full bg-surface-3 ring-1 ring-line transition-colors data-[state=checked]:bg-safe"
                >
                  <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
                </Switch.Root>
              </section>

              <section>
                <h3 className="eyebrow mb-2">Raccourcis</h3>
                <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
                  {[
                    ["Générer", "↵"],
                    ["Nouvelle ligne", "⇧ ↵"],
                    ["Nouvelle création", "⌘ ⇧ O"],
                    ["Rechercher", "⌘ K"],
                    ["Panneau latéral", "⌘ B"],
                    ["Écrire le prompt", "/"],
                    ["Visionneuse : naviguer · infos · favori", "← → · I · F"],
                  ].map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="font-mono text-[12px] text-ink-2">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
