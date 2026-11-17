import { useCallback } from 'react';
import { useSettingsStore } from '@/stores';

export function useSound() {
  const { soundEnabled, soundVolume } = useSettingsStore();
  // Only explicitly requested custom audio remains; no automatic reply sound.
  const playCustom = useCallback(
    (src: string) => {
      if (!soundEnabled) return;
      const audio = new Audio(src);
      audio.volume = soundVolume;
      audio.play().catch((err) => {
        console.warn('[useSound] Custom play failed:', err);
      });
    },
    [soundEnabled, soundVolume]
  );

  return { playCustom };
}
