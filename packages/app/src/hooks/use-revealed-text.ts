import { useEffect, useRef, useState } from "react";

import {
  advanceTextReveal,
  beginTextReveal,
  completeTextReveal,
  isTextRevealPacingSupported,
  isTextRevealSettled,
  nextTextRevealFrame,
  retargetTextReveal,
  type TextRevealState,
  visibleRevealedText,
} from "@/agent-stream/text-reveal";
import type { MarkdownPhase } from "@/components/markdown/fence/types";
import { useReducedMotionPreference } from "@/hooks/use-reduced-motion";

/**
 * Binds the paced reveal in @/agent-stream/text-reveal to a frame clock.
 *
 * The reveal module owns pacing and safe cuts. This hook connects it to
 * requestAnimationFrame and the OS reduced-motion preference. Rendered pacing
 * is covered end to end by
 * `packages/app/e2e/browser/agent-stream-smoothness.spec.ts`.
 */
export function useRevealedText(text: string, phase: MarkdownPhase): string {
  const reducedMotion = useReducedMotionPreference();
  const shouldPace = isTextRevealPacingSupported() && !reducedMotion && phase === "streaming";
  const stateRef = useRef<TextRevealState>(beginTextReveal(text));
  const [, forceRender] = useState(0);
  const frameRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number | null>(null);

  stateRef.current = retargetTextReveal(stateRef.current, text);
  if (!shouldPace) {
    stateRef.current = completeTextReveal(stateRef.current);
    lastFrameAtRef.current = null;
  }

  useEffect(() => {
    const settle = () => {
      lastFrameAtRef.current = null;
      const next = completeTextReveal(stateRef.current);
      if (next !== stateRef.current) {
        stateRef.current = next;
        forceRender((tick) => tick + 1);
      }
    };

    if (!shouldPace) {
      settle();
      return;
    }
    if (isTextRevealSettled(stateRef.current)) {
      lastFrameAtRef.current = null;
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      settle();
      return;
    }

    const tick = (timestamp: number) => {
      frameRef.current = null;
      const frame = nextTextRevealFrame(lastFrameAtRef.current, timestamp);
      if (!frame) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameAtRef.current = frame.frameAtMs;

      const next = advanceTextReveal(stateRef.current, frame.elapsedMs);
      if (next !== stateRef.current) {
        stateRef.current = next;
        forceRender((count) => count + 1);
      }
      if (!isTextRevealSettled(stateRef.current)) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [text, shouldPace]);

  if (!shouldPace) return text;
  return visibleRevealedText(stateRef.current, { streaming: true });
}
