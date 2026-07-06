import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

interface GlobalHotkeysOptions {
  status: string;
  isRecording: boolean;
  onPress: (appName?: string, windowTitle?: string) => Promise<void>;
  onRelease: () => Promise<void>;
}

export function useGlobalHotkeys({ status, isRecording, onPress, onRelease }: GlobalHotkeysOptions) {
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen("shortcut-state", async (event) => {
      console.log("前端收到按键状态:", event.payload);
      if (status === "initializing") {
        console.log("系统正在初始化，忽略按键");
        return;
      }
      
      const payload = event.payload as { pressed: boolean; app_name?: string; window_title?: string };
      
      if (payload.pressed && !isRecording) {
        console.log("准备开始录音... 目标应用:", payload.app_name);
        await onPress(payload.app_name, payload.window_title);
      } else if (!payload.pressed && isRecording) {
        console.log("准备停止录音并处理...");
        await onRelease();
      }
    }).then(fn => {
      unlistenFn = fn;
    }).catch(e => console.warn("Tauri events not available:", e));

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [status, isRecording, onPress, onRelease]);
}
