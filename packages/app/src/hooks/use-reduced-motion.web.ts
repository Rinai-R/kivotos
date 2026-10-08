import { useSyncExternalStore } from "react";

let mediaQuery: MediaQueryList | null = null;
const listeners = new Set<() => void>();

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  if (mediaQuery === null) {
    mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  }
  return mediaQuery;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  const query = getMediaQuery();
  listeners.add(listener);
  if (listeners.size === 1 && query !== null) {
    query.addEventListener("change", notify);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && query !== null) {
      query.removeEventListener("change", notify);
    }
  };
}

function getSnapshot(): boolean {
  const query = getMediaQuery();
  return query === null ? true : query.matches;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
