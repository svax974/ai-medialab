// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { PanelLeftOpen, Upload } from "lucide-react";
import { Toaster, toast } from "sonner";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { Asset } from "./lib/api";
import { focusComposer, uploadFiles, addAsReference } from "./lib/composer";
import { useConversation, useServerEvents } from "./lib/queries";
import { navigate, paths, useRoute } from "./lib/router";
import { useStore } from "./lib/store";
import { AudioGallery } from "./components/AudioGallery";
import { AudioHome } from "./components/AudioHome";
import { ConfirmHost } from "./components/Confirm";
import { ConversationView } from "./components/ConversationView";
import { Gallery } from "./components/Gallery";
import { Home } from "./components/Home";
import { Lightbox } from "./components/Lightbox";
import { ModelsDialog } from "./components/ModelsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { SetupController } from "./components/Setup";
import { Sidebar, lastPathByMode } from "./components/Sidebar";
import { VoiceStudio } from "./components/VoiceStudio";
import { VoicesPage } from "./components/VoicesPage";
import { IconButton } from "./components/ui";

/** The mode (image / audio) follows the current page; the last page of each mode is remembered for the mode switch. */
function useModeSync() {
  const route = useRoute();
  const setMode = useStore((s) => s.setMode);
  const convId = route.name === "conversation" ? route.id : null;
  const { data: conv } = useConversation(convId);

  useEffect(() => {
    const path = location.pathname;
    if (route.name === "home" || route.name === "gallery") {
      setMode("image");
      lastPathByMode.image = path;
    } else if (route.name === "audio-home" || route.name === "voices" || route.name === "audio-gallery") {
      setMode("audio");
      lastPathByMode.audio = path;
    } else if (conv) {
      setMode(conv.mode);
      lastPathByMode[conv.mode] = path;
    }
  }, [route, conv, setMode]);
}

export default function App() {
  useServerEvents();
  useModeSync();
  const route = useRoute();
  const mode = useStore((s) => s.mode);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const theme = useStore((s) => s.theme);
  const dragging = useFileDrop();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable]");
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        navigate(useStore.getState().mode === "audio" ? paths.audioHome : paths.home);
        focusComposer();
      } else if (e.key === "/" && !typing && !useStore.getState().lightbox) {
        e.preventDefault();
        focusComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <TooltipPrimitive.Provider>
      <div className="flex h-full">
        {sidebarOpen && <Sidebar />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {!sidebarOpen && (
            <div className="absolute left-3 top-2.5 z-20">
              <IconButton label="Afficher le panneau" kbd="⌘B" onClick={toggleSidebar} tipSide="right">
                <PanelLeftOpen className="size-4" />
              </IconButton>
            </div>
          )}
          {route.name === "home" && <Home />}
          {route.name === "conversation" && <ConversationView key={route.id} id={route.id} />}
          {route.name === "gallery" && <Gallery />}
          {route.name === "audio-home" && <AudioHome />}
          {route.name === "voices" && <VoicesPage />}
          {route.name === "audio-gallery" && <AudioGallery />}
        </main>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center bg-bg/70 backdrop-blur-sm animate-fade">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-safe/60 bg-surface/80 px-14 py-10 shadow-[0_0_80px_-20px_var(--safe-glow)]">
            <Upload className="size-8 text-safe" />
            <div className="font-display text-3xl text-ink">{mode === "audio" ? "Déposez un enregistrement" : "Déposez vos images"}</div>
            <div className="text-sm text-muted">
              {mode === "audio" ? "Il servira à cloner une voix, avec quelques secondes de parole." : "Elles serviront de références pour la prochaine génération."}
            </div>
          </div>
        </div>
      )}

      <Lightbox />
      <SettingsDialog />
      <SetupController />
      <ModelsDialog />
      <VoiceStudio />
      <ConfirmHost />
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{ className: "!rounded-xl !border-line-strong !bg-surface-2 !text-ink !font-sans" }}
      />
    </TooltipPrimitive.Provider>
  );
}

/** Drag and drop of files (or conversation images) anywhere in the window. */
function useFileDrop() {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasPayload = (e: DragEvent) =>
      !!e.dataTransfer &&
      (e.dataTransfer.types.includes("Files") ||
        (e.dataTransfer.types.includes("application/x-cn-asset") && useStore.getState().mode === "image"));
    const enter = (e: DragEvent) => {
      if (!hasPayload(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasPayload(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasPayload(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasPayload(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const internal = e.dataTransfer!.getData("application/x-cn-asset");
      if (internal) {
        addAsReference(JSON.parse(internal) as Asset);
        return;
      }
      const files = Array.from(e.dataTransfer!.files);
      if (useStore.getState().mode === "audio") {
        const audio = files.find((f) => f.type.startsWith("audio/") || /\.(wav|mp3|m4a|flac|ogg|opus|aac|webm|mp4)$/i.test(f.name));
        if (audio) useStore.getState().openVoiceStudio({ file: audio });
        else if (files.length) toast.warning("Déposez un fichier audio (WAV, MP3, M4A, FLAC, OGG…).");
        return;
      }
      if (files.length) uploadFiles(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return dragging;
}
