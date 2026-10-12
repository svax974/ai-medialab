import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart, Search } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { keys } from "../lib/queries";
import { navigate, paths } from "../lib/router";
import { TakeCard } from "./AudioMessage";
import { Spinner } from "./ui";

/** Toutes les prises audio générées, de la plus récente à la plus ancienne. */
export function AudioGallery() {
  const [favorites, setFavorites] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: keys.assets(favorites, q, "audio"),
    queryFn: ({ pageParam }) => api.assets({ favorites, q, before: pageParam, media: "audio" }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before,
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && hasNextPage && !isFetchingNextPage && fetchNextPage(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line/60 px-5 pl-14 md:pl-5">
        <h1 className="font-display text-2xl text-ink">Bibliothèque</h1>
        <span className="font-mono text-[11px] text-faint">{items.length}{hasNextPage ? "+" : ""} prises</span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer par texte"
            className="h-8 w-56 rounded-lg border border-line bg-surface pl-8 pr-2 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
        </div>
        <button
          onClick={() => setFavorites((f) => !f)}
          className={cx("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors", favorites ? "border-safe/50 bg-safe-soft text-ink" : "border-line text-ink-2 hover:border-line-strong")}
        >
          <Heart className={cx("size-3.5", favorites && "fill-[var(--safe)] text-safe")} /> Favoris
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isLoading && <div className="grid h-40 place-items-center text-muted"><Spinner /></div>}
        {!isLoading && items.length === 0 && (
          <p className="py-24 text-center text-sm text-faint">
            {favorites ? "Aucun favori pour l'instant — utilisez ♥ sur une prise." : q ? "Aucun résultat." : "Aucune prise audio pour l'instant."}
          </p>
        )}
        <div className="mx-auto max-w-[760px] space-y-4">
          {items.map((a) => (
            <div key={a.id} className="animate-fade">
              <button
                onClick={() => a.conversation_id && navigate(paths.conversation(a.conversation_id))}
                className="mb-1.5 block max-w-full px-1 text-left"
                title="Ouvrir la conversation"
              >
                <span className="line-clamp-2 text-[13px] leading-snug text-ink-2 hover:text-ink">{a.prompt}</span>
                <span className="font-mono text-[10.5px] text-faint">{a.conversation_title}</span>
              </button>
              <TakeCard asset={a} />
            </div>
          ))}
        </div>
        <div ref={sentinel} className="h-10">{isFetchingNextPage && <Spinner className="mx-auto size-4 text-muted" />}</div>
      </div>
    </div>
  );
}
