// Routeur minimal (History API) : "/", "/c/:id", "/galerie".
import { useSyncExternalStore } from "react";

export type Route = { name: "home" } | { name: "conversation"; id: string } | { name: "gallery" };

function parse(pathname: string): Route {
  const conv = pathname.match(/^\/c\/([\w-]+)\/?$/);
  if (conv) return { name: "conversation", id: conv[1] };
  if (/^\/galerie\/?$/.test(pathname)) return { name: "gallery" };
  return { name: "home" };
}

const listeners = new Set<() => void>();
let current = parse(location.pathname);

function emit() {
  current = parse(location.pathname);
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", emit);

export function navigate(path: string, { replace = false } = {}) {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  emit();
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export const paths = {
  home: "/",
  conversation: (id: string) => `/c/${id}`,
  gallery: "/galerie",
};
