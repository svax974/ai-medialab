// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// Async confirmation dialog: `const ok = await confirm({...})`.
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { Button } from "./ui";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
}

const useConfirmStore = create<ConfirmState>(() => ({ options: null, resolve: null }));

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ options, resolve }));
}

export function ConfirmHost() {
  const { options, resolve } = useConfirmStore();
  const [busy, setBusy] = useState(false);
  const close = (ok: boolean) => {
    resolve?.(ok);
    setBusy(false);
    useConfirmStore.setState({ options: null, resolve: null });
  };
  return (
    <Dialog.Root open={!!options} onOpenChange={(open) => !open && close(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm animate-fade" />
        <Dialog.Content className="panel fixed left-1/2 top-1/2 z-[81] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 animate-rise">
          <Dialog.Title className="font-display text-2xl text-ink">{options?.title}</Dialog.Title>
          {options?.description && (
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted">{options.description}</Dialog.Description>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              Annuler
            </Button>
            <Button
              autoFocus
              variant={options?.danger ? "danger" : "primary"}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                close(true);
              }}
            >
              {options?.confirmLabel ?? "Confirmer"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
