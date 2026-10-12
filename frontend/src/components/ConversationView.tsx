// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Pin } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useConversation } from "../lib/queries";
import { navigate, paths } from "../lib/router";
import { AudioComposer } from "./AudioComposer";
import { AudioAssistantMessage } from "./AudioMessage";
import { Composer } from "./Composer";
import { AssistantMessage, UserMessage } from "./Message";
import { Spinner } from "./ui";

export function ConversationView({ id }: { id: string }) {
  const { data: conv, isLoading, error } = useConversation(id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastCount = useRef(0);

  // Scroll to the bottom on open, then on each new message if already at the bottom.
  useLayoutEffect(() => {
    lastCount.current = 0;
  }, [id]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !conv) return;
    const count = conv.messages.length;
    if (lastCount.current === 0) el.scrollTop = el.scrollHeight;
    else if (count > lastCount.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    lastCount.current = count;
  }, [conv]);

  // Images load late: stay pinned to the bottom if the user is there.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottom) el.scrollTop = el.scrollHeight;
    });
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [atBottom, conv?.id]);

  useEffect(() => {
    if (error && (error as { status?: number }).status === 404) {
      toast.error("Conversation introuvable.");
      navigate(paths.home, { replace: true });
    }
  }, [error]);

  if (isLoading || !conv) {
    return (
      <div className="grid flex-1 place-items-center text-muted">
        <Spinner />
      </div>
    );
  }

  const audio = conv.mode === "audio";
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line/60 px-5 pl-14 md:pl-5">
        <TitleEditor id={conv.id} title={conv.title} />
        {conv.pinned && <Pin className="size-3.5 text-faint" />}
        <span className="ml-auto font-mono text-[11px] text-faint">{conv.generation_count} {audio ? "synthèse(s)" : "génération(s)"}</span>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[880px] space-y-7 px-5 pb-48 pt-8">
          {conv.messages.map((m) =>
            m.role === "user" ? (
              <UserMessage key={m.id} message={m} audio={audio} />
            ) : audio ? (
              <AudioAssistantMessage key={m.id} message={m} />
            ) : (
              <AssistantMessage key={m.id} message={m} />
            ),
          )}
          {conv.messages.length === 0 && (
            <p className="py-20 text-center text-sm text-faint">
              {audio ? "Conversation vide. Écrivez un premier texte ci-dessous." : "Conversation vide. Décrivez une première image ci-dessous."}
            </p>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg via-bg/90 to-transparent pb-4 pt-10">
        <div className="pointer-events-auto relative mx-auto w-full max-w-[880px] px-5">
          {!atBottom && (
            <button
              onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
              className="absolute -top-12 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line-strong bg-surface-2 text-ink-2 shadow-lg animate-fade hover:text-ink"
              aria-label="Aller en bas"
            >
              <ArrowDown className="size-4" />
            </button>
          )}
          {audio ? <AudioComposer conversationId={conv.id} /> : <Composer conversationId={conv.id} />}
        </div>
      </div>
    </div>
  );
}

function TitleEditor({ id, title }: { id: string; title: string }) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  const save = () => {
    const next = value.trim();
    if (!next) return setValue(title);
    if (next !== title) api.patchConversation(id, { title: next }).catch((e) => toast.error(e.message));
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") (setValue(title), e.currentTarget.blur());
      }}
      aria-label="Titre de la conversation"
      className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 font-display text-xl text-ink hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
    />
  );
}
