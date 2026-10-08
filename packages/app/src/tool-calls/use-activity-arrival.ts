import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
import {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export function useActivityArrival({ active, label }: { active: boolean; label: string }) {
  const arrival = useSharedValue(active ? 0 : 1);
  useEffect(() => {
    cancelAnimation(arrival);
    if (active) {
      arrival.value = 0;
      arrival.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    } else {
      arrival.value = 1;
    }
    return () => cancelAnimation(arrival);
  }, [active, arrival, label]);

  return useAnimatedStyle(() => {
    const progress = Math.min(1, Math.max(0, arrival.value));
    const opacity = 0.45 + 0.55 * progress;
    if (isWeb) return { opacity, filter: `blur(${(1 - progress) * 3}px)` };
    return { opacity };
  });
}
