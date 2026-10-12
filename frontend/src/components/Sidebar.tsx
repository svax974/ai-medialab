// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  AudioLines, Boxes, Clapperboard, Ellipsis, Image as ImageIcon, Images, Library, Mic, Moon, PanelLeftClose, Pencil, Pin, PinOff, Search,
  Settings2, SquarePen, Sun, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, type ConversationSummary, type ModelKind } from "../lib/api";
import { cx, formatTime, periodOf } from "../lib/format";
import { useConversations } from "../lib/queries";
import { navigate, paths, useRoute } from "../lib/router";
import { useStore } from "../lib/store";
import { confirm } from "./Confirm";
import { EngineCard } from "./EngineCard";
import { IconButton, Kbd, Mark } from "./ui";

export function Sidebar() {
  const route = useRoute();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const mode = useStore((s) => s.mode);
  const { data: conversations = [], isLoading } = useConversations(debounced, mode);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setModelsOpen = useStore((s) => s.setModelsOpen);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(() => {
    const out: { label: string; items: ConversationSummary[] }[] = [];
    for (const c of conversations) {
      const label = c.pinned ? "Épinglées" : periodOf(c.updated_at);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [conversations]);

  const activeId = route.name === "conversation" ? route.id : null;

  return (
    <aside className="flex h-full w-[284px] shrink-0 flex-col border-r border-line bg-bg-elev">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Mark className="size-6" />
        <span className="font-display text-[22px] italic leading-none tracking-tight text-ink">AI MediaLab</span>
        <div className="flex-1" />
        <IconButton label="Masquer le panneau" kbd="⌘B" size="sm" onClick={toggleSidebar} tipSide="right">
          <PanelLeftClose className="size-4" />
        </IconButton>
      </div>

      <ModeSwitch />

      <div className="space-y-1 px-3">
        {mode === "image" ? (
          <>
            <NavButton
              active={route.name === "home"}
              onClick={() => navigate(paths.home)}
              icon={<SquarePen className="size-4" />}
              label="Nouvelle création"
              kbd="⌘⇧O"
            />
            <NavButton
              active={route.name === "gallery"}
              onClick={() => navigate(paths.gallery)}
              icon={<Images className="size-4" />}
              label="Galerie"
            />
          </>
        ) : mode === "video" ? (
          <>
            <NavButton
              active={route.name === "video-home"}
              onClick={() => navigate(paths.videoHome)}
              icon={<SquarePen className="size-4" />}
              label="Nouvelle vidéo"
              kbd="⌘⇧O"
            />
            <NavButton
              active={route.name === "video-gallery"}
              onClick={() => navigate(paths.videoGallery)}
              icon={<Library className="size-4" />}
              label="Bibliothèque"
            />
          </>
        ) : (
          <>
            <NavButton
              active={route.name === "audio-home"}
              onClick={() => navigate(paths.audioHome)}
              icon={<SquarePen className="size-4" />}
              label="Nouvel audio"
              kbd="⌘⇧O"
            />
            <NavButton
              active={route.name === "voices"}
              onClick={() => navigate(paths.voices)}
              icon={<Mic className="size-4" />}
              label="Mes voix"
            />
            <NavButton
              active={route.name === "audio-gallery"}
              onClick={() => navigate(paths.audioGallery)}
              icon={<Library className="size-4" />}
              label="Bibliothèque"
            />
          </>
        )}
      </div>

      <div className="relative mx-3 mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
          placeholder="Rechercher"
          className="h-9 w-full rounded-xl border border-line bg-surface pl-8 pr-14 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          {query ? (
            <button onClick={() => setQuery("")} className="rounded p-1 text-faint hover:text-ink" aria-label="Effacer">
              <X className="size-3.5" />
            </button>
          ) : (
            <Kbd>⌘K</Kbd>
          )}
        </div>
      </div>

      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-4">
        {isLoading && <div className="px-3 py-6 text-sm text-faint">Chargement…</div>}
        {!isLoading && conversations.length === 0 && (
          <div className="px-3 py-8 text-center text-sm leading-relaxed text-faint">
            {debounced ? "Aucun résultat." : mode === "audio" ? "Vos créations audio apparaîtront ici." : mode === "video" ? "Vos vidéos apparaîtront ici." : "Vos créations apparaîtront ici."}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mt-4 first:mt-2">
            <div className="eyebrow px-3 pb-1.5">{g.label}</div>
            {g.items.map((c) => (
              <ConversationItem key={c.id} conv={c} active={c.id === activeId} />
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        <EngineCard />
        <button
          onClick={() => setModelsOpen(true)}
          className="flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <Boxes className="size-4" /> Modèles
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 flex-1 items-center gap-2.5 rounded-xl px-3 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            <Settings2 className="size-4" /> Réglages
          </button>
          <IconButton
            label={theme === "dark" ? "Thème clair" : "Thème sombre"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
        </div>
      </div>
    </aside>
  );
}

/** Last page visited in each mode, so switching modes returns you where you were. */
export const lastPathByMode: Record<ModelKind, string> = { image: "/", audio: "/audio", video: "/video" };

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const options: { id: ModelKind; label: string; icon: React.ReactNode }[] = [
    { id: "image", label: "Image", icon: <ImageIcon className="size-4" /> },
    { id: "audio", label: "Audio", icon: <AudioLines className="size-4" /> },
    { id: "video", label: "Vidéo", icon: <Clapperboard className="size-4" /> },
  ];
  const go = (target: ModelKind) => {
    if (target === mode) return;
    setMode(target);
    navigate(lastPathByMode[target] ?? (target === "audio" ? paths.audioHome : target === "video" ? paths.videoHome : paths.home));
  };
  return (
    <div className="px-3 pb-3 pt-0.5">
      <div role="tablist" aria-label="Type de création" className="relative grid grid-cols-3 rounded-xl bg-surface p-1 ring-1 ring-line">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(33.333%-2.667px)] rounded-lg bg-surface-3 shadow-sm ring-1 ring-line-strong transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
          style={{ transform: `translateX(${mode === "audio" ? 100 : mode === "video" ? 200 : 0}%)` }}
        />
        {options.map((o) => (
          <button
            key={o.id}
            role="tab"
            aria-selected={mode === o.id}
            onClick={() => go(o.id)}
            className={cx(
              "relative z-10 flex h-8 items-center justify-center gap-2 rounded-lg text-[13.5px] font-medium transition-colors",
              mode === o.id ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            <span className={cx("transition-colors", mode === o.id && "text-safe")}>{o.icon}</span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, kbd }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; kbd?: string }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "group flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm transition-colors",
        active ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {kbd && <span className="opacity-0 transition-opacity group-hover:opacity-100"><Kbd>{kbd}</Kbd></span>}
    </button>
  );
}

function ConversationItem({ conv, active }: { conv: ConversationSummary; active: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conv.title);
  const qc = useQueryClient();

  const saveTitle = async () => {
    setRenaming(false);
    const next = title.trim();
    if (!next || next === conv.title) return setTitle(conv.title);
    try {
      await api.patchConversation(conv.id, { title: next });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Supprimer la conversation ?",
      description: `« ${conv.title} » et ses ${conv.generation_count} génération(s) seront définitivement supprimées, ${conv.mode === "video" ? "vidéos" : conv.mode === "audio" ? "fichiers audio" : "images"} comprises.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteConversation(conv.id);
      if (active) navigate(conv.mode === "video" ? paths.videoHome : conv.mode === "audio" ? paths.audioHome : paths.home, { replace: true });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div
      className={cx(
        "group relative flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors",
        active ? "bg-surface-3" : "hover:bg-surface-2",
      )}
    >
      <button
        className="absolute inset-0 rounded-xl"
        aria-label={conv.title}
        onClick={() => navigate(paths.conversation(conv.id))}
        onDoubleClick={() => setRenaming(true)}
      />
      <div className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-surface-3 ring-1 ring-line">
        {conv.cover ? (
          <img src={conv.cover.thumb_url} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="tray grid size-full place-items-center">
            {conv.mode === "audio" && <AudioLines className="size-4 text-safe/80" />}
            {conv.mode === "video" && <Clapperboard className="size-4 text-safe/80" />}
          </div>
        )}
        {conv.busy && (
          <span className="absolute inset-0 grid place-items-center bg-black/40">
            <span className="size-2 rounded-full bg-safe shadow-[0_0_10px_var(--safe)] animate-breathe" />
          </span>
        )}
      </div>
      <div className="pointer-events-none relative min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") (setTitle(conv.title), setRenaming(false));
            }}
            className="pointer-events-auto w-full rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-sm text-ink focus:outline-none"
          />
        ) : (
          <div className={cx("truncate text-[13.5px]", active ? "text-ink" : "text-ink-2")}>{conv.title}</div>
        )}
        <div className="truncate font-mono text-[10.5px] text-faint">
          {conv.generation_count} {conv.mode === "audio" ? "prise(s)" : conv.mode === "video" ? "clip(s)" : "gén."} · {formatTime(conv.updated_at)}
        </div>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="relative rounded-md p-1 text-faint opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Actions"
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content collisionPadding={12} align="start" sideOffset={4} className="menu min-w-44">
            <DropdownMenu.Item className="menu-item" onSelect={() => api.patchConversation(conv.id, { pinned: !conv.pinned })}>
              {conv.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {conv.pinned ? "Désépingler" : "Épingler"}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => setRenaming(true)}>
              <Pencil className="size-4" /> Renommer
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className="menu-item" data-danger onSelect={remove}>
              <Trash2 className="size-4" /> Supprimer
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
