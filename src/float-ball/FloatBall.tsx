import { useEffect } from 'react';
import { appWindow } from '@tauri-apps/api/window';

export default function FloatBall() {
  useEffect(() => {
    void appWindow.hide();
  }, []);

  return null;
}
