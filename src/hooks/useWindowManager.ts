import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, currentMonitor, PhysicalPosition } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

interface WindowManagerOptions {
  windowLabel: string;
  status: string;
  errorMessage: string;
  rawText: string;
  refinedText: string;
  activeTab: "main" | "history" | "settings";
  onCancel: () => void;
  onCommit: () => void;
  getAnalyser: () => AnalyserNode | null;
}

export function useWindowManager({
  windowLabel,
  status,
  errorMessage,
  rawText,
  refinedText,
  activeTab,
  onCancel,
  onCommit,
  getAnalyser
}: WindowManagerOptions) {
  
  // 1. 同步状态至独立浮空胶囊窗口并统一管控其显隐与自适应定位
  useEffect(() => {
    async function manageIndicatorWindow() {
      if (windowLabel !== "main") return;
      try {
        const indicatorWin = await WebviewWindow.getByLabel("indicator");
        if (!indicatorWin) return;

        // 同步广播状态数据
        const text = status === "success" ? (refinedText || rawText) : "";
        await indicatorWin.emit("indicator-state", { status, errorMessage, text });

        // 统一指挥定位与显隐
        if (status === "recording" || status === "transcribing" || status === "rewriting") {
          try {
            const monitor = await currentMonitor();
            if (monitor) {
              const scale = monitor.scaleFactor;
              const screenWidth = monitor.size.width / scale;
              const screenHeight = monitor.size.height / scale;

              const winWidth = 320;
              const winHeight = 100;

              const x = Math.round((screenWidth - winWidth) / 2);
              const y = Math.round(screenHeight - winHeight - 80);

              await indicatorWin.setPosition(new PhysicalPosition(Math.round(x * scale), Math.round(y * scale)));
            }
          } catch (posErr) {
            console.error("Failed to position indicator window:", posErr);
          }
          await indicatorWin.show();
        } else if (status === "success" || status === "error") {
          setTimeout(async () => {
            try {
              await indicatorWin.hide();
            } catch (hideErr) {
              console.error(hideErr);
            }
          }, 1500);
        } else if (status === "idle") {
          await indicatorWin.hide();
        }
      } catch (e) {
        console.error("Indicator window controller error:", e);
      }
    }
    
    manageIndicatorWindow();
  }, [status, errorMessage, windowLabel, rawText, refinedText]);

  // 2. 监听听写界面内容高度，自动调整主窗口高度
  useEffect(() => {
    if (windowLabel !== "main") return;

    if (activeTab === "main") {
      const observer = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const contentHeight = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
          // 加上顶部导航栏高度(48) + main-pane上下padding(80) + 一点缓冲
          let desiredHeight = contentHeight + 140;
          
          if (desiredHeight < 350) desiredHeight = 350;
          if (desiredHeight > 800) desiredHeight = 800;

          getCurrentWindow().setSize(new LogicalSize(520, desiredHeight)).catch(console.error);
        }
      });

      const workspaceEl = document.querySelector('.main-pane > div');
      if (workspaceEl) {
        observer.observe(workspaceEl);
      }

      return () => {
        observer.disconnect();
      };
    }
  }, [activeTab, rawText, refinedText, status, windowLabel]);

  // 3. 监听实时音量并广播给独立小药丸窗口
  useEffect(() => {
    let intervalId: any;
    let indicatorWin: any = null;

    async function setupVolumeTracker() {
      if (status !== "recording" || windowLabel !== "main") return;
      try {
        indicatorWin = await WebviewWindow.getByLabel("indicator");
        if (!indicatorWin) return;

        let analyser = null;
        for (let i = 0; i < 20; i++) {
          analyser = getAnalyser();
          if (analyser) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (!analyser) {
          console.warn("Volume tracker: AnalyserNode not ready.");
          return;
        }

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        intervalId = setInterval(() => {
          analyser.getByteTimeDomainData(dataArray);

          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            const val = (dataArray[i] - 128) / 128;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / bufferLength);
          const volume = Math.round(Math.min(100, rms * 600));

          indicatorWin.emit("indicator-volume", { volume }).catch((err: any) => {
            console.error("Failed to emit volume:", err);
          });
        }, 50);

      } catch (err) {
        console.error("Volume tracker init failed:", err);
      }
    }

    setupVolumeTracker();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [status, windowLabel, getAnalyser]);

  // 4. 监听独立浮空小药丸发过来的取消/强制提交事件
  useEffect(() => {
    if (windowLabel === "main") {
      const unlisten = listen("pill-action", (event) => {
        const payload = event.payload as { action: string };
        if (payload.action === "cancel") {
          onCancel();
        } else if (payload.action === "commit") {
          onCommit();
        }
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }
  }, [windowLabel, onCancel, onCommit]);
}
