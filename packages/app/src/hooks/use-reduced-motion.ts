import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

// Native reads asynchronously. Do not animate before the current preference is known.
let reducedMotion = true;
const listeners = new Set<() => void>();
let stopListening: (() => void) | null = null;

function updateReducedMotion(value: boolean): void {
  if (reducedMotion === value) return;
  reducedMotion = value;
  for (const listener of listeners) listener();
}

function startListening(): () => void {
  let active = true;
  let changed = false;
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
    changed = true;
    updateReducedMotion(value);
  });

  void AccessibilityInfo.isReduceMotionEnabled().then(
    (value) => {
      // A newer OS event wins over an in-flight initial query.
      if (active && !changed) updateReducedMotion(value);
      return undefined;
    },
    (error) => {
      if (active) console.warn("[ReducedMotion] Failed to read accessibility preference", error);
    },
  );

  return () => {
    active = false;
    subscription.remove();
    // Changes while unsubscribed must not leave the next mount using a stale false snapshot.
    reducedMotion = true;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stopListening = startListening();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopListening !== null) {
      stopListening();
      stopListening = null;
    }
  };
}

function getSnapshot(): boolean {
  return reducedMotion;
}

export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
