import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { AppState } from "react-native";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { keyOf, preloadView, type LiveView } from "./views";

/** A page on screen this lately is never dropped to load another ahead. */
const RECENT_MS = 60_000;
/** A page loaded ahead that has not posted `ready` by then no longer holds the next one back. */
const PRELOAD_TIMEOUT_MS = 30_000;
/** After memory pressure, nothing is loaded ahead for this long. */
const PRESSURE_PAUSE_MS = 5 * 60_000;

/** A page to load ahead: the page of a phone row, or of a peer its computer mounts. */
export interface PreloadTarget {
  machine: Machine;
  peer: LiveView["peer"];
}

export interface Preloader {
  /** Load these pages ahead, hidden and one at a time, instead of the ones still waiting. */
  plan(targets: readonly PreloadTarget[]): void;
  /** A page posted `ready`: when it was loading ahead, the next one may start. */
  loaded(viewKey: string): void;
  /** Short of memory: nothing waits, and nothing is loaded ahead for a while. */
  pause(): void;
}

/**
 * Load pages ahead of a switch to them (`preloadView`): one at a time, only
 * while the app is in front, never the page on screen, and never by dropping
 * the page on screen or one on screen in the last {@link RECENT_MS}. A page
 * that fails to load goes by itself (App's `onFailed`, `onGone`); one still
 * loading when the app leaves the front goes too.
 */
export function usePreloader(
  machines: readonly Machine[],
  views: readonly LiveView[],
  shown: string | null,
  setViews: Dispatch<SetStateAction<LiveView[]>>,
): Preloader {
  const machinesRef = useRef(machines);
  const viewsRef = useRef(views);
  const shownRef = useRef(shown);
  machinesRef.current = machines;
  viewsRef.current = views;
  shownRef.current = shown;
  /** When each page (`LiveView.key`) was last on screen. */
  const onScreenAt = useRef(new Map<string, number>());
  const lastShown = useRef<string | null>(null);
  /** The page loading ahead; `seen` once it is in the views, so a later absence means it went. */
  const loading = useRef<{
    key: string;
    seen: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const queue = useRef<{ machine: string; peer: LiveView["peer"] }[]>([]);
  /** The pages of the current plan, which never make room for one another. */
  const batch = useRef<ReadonlySet<string>>(new Set());
  const pausedAt = useRef(Number.NEGATIVE_INFINITY);

  const preloader = useMemo(() => {
    function pump(): void {
      if (loading.current !== null) return;
      const now = Date.now();
      if (AppState.currentState !== "active" || now - pausedAt.current < PRESSURE_PAUSE_MS) {
        queue.current = [];
        return;
      }
      for (let item = queue.current.shift(); item !== undefined; item = queue.current.shift()) {
        const { peer } = item;
        const id = item.machine;
        const machine = machinesRef.current.find((row) => row.id === id);
        if (machine === undefined) continue;
        const key = keyOf(machine.id, peer);
        if (key === shownRef.current) continue;
        const keep = new Set(batch.current);
        if (shownRef.current !== null) keep.add(shownRef.current);
        for (const [page, at] of onScreenAt.current) if (now - at < RECENT_MS) keep.add(page);
        // Decided on the views as rendered, applied to the latest.
        const next = preloadView(viewsRef.current, machine, peer, keep);
        if (next === null || next === viewsRef.current) continue;
        setViews((live) => preloadView(live, machine, peer, keep) ?? live);
        loading.current = {
          key,
          seen: false,
          timer: setTimeout(() => done(key), PRELOAD_TIMEOUT_MS),
        };
        return;
      }
    }
    function done(key: string): void {
      if (loading.current?.key !== key) return;
      clearTimeout(loading.current.timer);
      loading.current = null;
      pump();
    }
    return {
      plan(targets: readonly PreloadTarget[]): void {
        queue.current = targets.map((target) => ({
          machine: target.machine.id,
          peer: target.peer,
        }));
        batch.current = new Set(targets.map((target) => keyOf(target.machine.id, target.peer)));
        pump();
      },
      loaded: done,
      pause(): void {
        pausedAt.current = Date.now();
        queue.current = [];
      },
      /** Out of the front: nothing more loads ahead, and the page loading ahead goes. */
      stop(): void {
        queue.current = [];
        const key = loading.current?.key;
        if (key === undefined) return;
        setViews((live) => live.filter((view) => view.key !== key || !view.preloaded));
      },
    };
  }, [setViews]);

  // When each page was last on screen: the one leaving it, and the one coming.
  useEffect(() => {
    const now = Date.now();
    if (lastShown.current !== null) onScreenAt.current.set(lastShown.current, now);
    if (shown !== null) onScreenAt.current.set(shown, now);
    lastShown.current = shown;
  }, [shown]);

  // Only live pages shown lately are remembered.
  useEffect(() => {
    const now = Date.now();
    for (const [key, at] of onScreenAt.current)
      if (now - at >= RECENT_MS || !views.some((view) => view.key === key))
        onScreenAt.current.delete(key);
  }, [views, shown]);

  // The page loading ahead went (failed, renderer gone, dropped): the next one may start.
  useEffect(() => {
    const current = loading.current;
    if (current === null) return;
    if (views.some((view) => view.key === current.key)) current.seen = true;
    else if (current.seen) preloader.loaded(current.key);
  }, [views, preloader]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") preloader.stop();
    });
    return () => subscription.remove();
  }, [preloader]);

  return preloader;
}
