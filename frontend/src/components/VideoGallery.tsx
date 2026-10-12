// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart, Play, Search } from "lucide-react";
import { api, type Asset } from "../lib/api";
import { clock } from "../lib/audio";
import { cx } from "../lib/format";
import { keys } from "../lib/queries";
import { useStore } from "../lib/store";
import { ClipActions } from "./VideoMessage";
import { Spinner } from "./ui";

/** All generated clips, newest first. */
export function VideoGallery() {
  const [favorites, setFavorites] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const openLightbox = useStore((s) => s.openLightbox);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: keys.assets(favorites, q, "video"),
    queryFn: ({ pageParam }) => api.assets({ favorites, q, before: pageParam, media: "video" }),
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
        <span className="font-mono text-[11px] text-faint">{items.length}{hasNextPage ? "+" : ""} clips</span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer par prompt"
            className="h-8 w-40 rounded-lg border border-line bg-surface pl-8 pr-2 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none sm:w-56"
          />
        </div>
        <button
          onClick={() => setFavorites((f) => !f)}
          className={cx(
            "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors",
            favorites ? "border-safe/50 bg-safe-soft text-ink" : "border-line text-ink-2 hover:border-line-strong",
          )}
        >
          <Heart className={cx("size-3.5", favorites && "fill-[var(--safe)] text-safe")} /> Favoris
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isLoading && (
          <div className="grid h-40 place-items-center text-muted">
            <Spinner />
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <p className="py-24 text-center text-sm text-faint">
            {favorites ? "Aucun favori pour l'instant — utilisez ♥ sur un clip." : q ? "Aucun résultat." : "Aucune vidéo générée pour l'instant."}
          </p>
        )}
        <div className="columns-1 gap-3 sm:columns-2 xl:columns-3 2xl:columns-4">
          {items.map((a, i) => (
            <PosterTile key={a.id} asset={a} onOpen={() => openLightbox(items, i)} />
          ))}
        </div>
        <div ref={sentinel} className="h-10">
          {isFetchingNextPage && <Spinner className="mx-auto size-4 text-muted" />}
        </div>
      </div>
    </div>
  );
}

/** Poster image that plays a muted preview on hover. */
export function PosterTile({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="group/tile relative mb-3 break-inside-avoid overflow-hidden rounded-xl bg-tray ring-1 ring-line animate-fade"
      style={{ aspectRatio: asset.width && asset.height ? asset.width / asset.height : 16 / 9 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button className="absolute inset-0" onClick={onOpen} aria-label="Ouvrir le clip">
        <img src={asset.thumb_url} alt={asset.prompt ?? ""} loading="lazy" className="size-full object-cover" />
        {hover && <video src={asset.url} poster={asset.thumb_url} muted loop autoPlay playsInline preload="auto" className="absolute inset-0 size-full object-cover" />}
      </button>
      {!hover && (
        <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur">
          <Play className="size-2.5 fill-current" /> {asset.duration ? clock(asset.duration) : "vidéo"}
        </span>
      )}
      <ClipActions asset={asset} />
      {asset.prompt && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8 opacity-0 transition-opacity group-hover/tile:opacity-100">
          <p className="line-clamp-2 text-[12px] leading-snug text-white/90">{asset.prompt}</p>
        </div>
      )}
    </div>
  );
}
