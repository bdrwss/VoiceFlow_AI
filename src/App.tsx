import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, currentMonitor, PhysicalPosition } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appDataDir, join } from "@tauri-apps/api/path";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { transcribeAudioApi } from "./utils/api_asr";
import { 
  Mic, 
  Settings, 
  History, 
  Sparkles, 
  RefreshCw, 
  Check, 
  AlertTriangle,
} from "lucide-react";
import { AudioRecorder, float32ToWav } from "./utils/audio";
import { initWhisper, transcribeAudio } from "./utils/whisper";
import { refineText, LLMConfig } from "./utils/llm";
import { writeFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import "./App.css";

import { useSettings } from "./hooks/useSettings";
import { useHistory } from "./hooks/useHistory";
import { MainPanel } from "./components/MainPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { AutoUpdater } from "./components/AutoUpdater";

function App() {
  const [logs, setLogs] = useState<string[]>([]);

  // 劫持 console 打印
  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const appendLog = (type: string, args: any[]) => {
      const msg = args.map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message;
        if (typeof arg === 'object') {
          try { return JSON.stringify(arg); } catch(e) { return String(arg); }
        }
        return String(arg);
      }).join(' ');
      const time = new Date().toLocaleTimeString();
      setLogs(prev => [...prev.slice(-99), `[${time}] [${type}] ${msg}`]);
    };

    console.log = (...args) => {
      appendLog("LOG", args);
      originalLog.apply(console, args);
    };
    console.warn = (...args) => {
      appendLog("WARN", args);
      originalWarn.apply(console, args);
    };
    console.error = (...args) => {
      appendLog("ERROR", args);
      originalError.apply(console, args);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  // 状态变量
  const [status, setStatus] = useState<"initializing" | "idle" | "recording" | "transcribing" | "rewriting" | "success" | "error">("initializing");
  const [modelProgress, setModelProgress] = useState<number>(0);
  const [downloadStep, setDownloadStep] = useState<string>("");
  const [windowLabel] = useState<string>(() => getCurrentWindow().label);
  
  const isRecordingRef = useRef(false);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const activeAppRef = useRef<string>("");
  const recordingTimeoutRef = useRef<number | null>(null);
  const focusLostRef = useRef<boolean>(false);
  const initialWindowRef = useRef<{app_name: string | null, window_title: string | null} | null>(null);

  const [rawText, setRawText] = useState("");
  const [refinedText, setRefinedText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "history" | "settings">("main");
  
  const { settings, updateSetting, saveSettings, saveStatus } = useSettings();
  const { history, addHistoryItem, updateHistoryItem, deleteHistoryItem, clearHistory, copyToClipboard, copiedId } = useHistory();

  const [lastContext, setLastContext] = useState("");

  const [autostartEnabled, setAutostartEnabled] = useState(false);

  useEffect(() => {
    async function checkAutostart() {
      try {
        const enabled = await isEnabled();
        setAutostartEnabled(enabled);
      } catch (e) {
        console.error("Failed to check autostart:", e);
      }
    }
    checkAutostart();
  }, []);

  const toggleAutostart = async () => {
    try {
      if (autostartEnabled) {
        await disable();
        setAutostartEnabled(false);
      } else {
        await enable();
        setAutostartEnabled(true);
      }
    } catch (e) {
      console.error("Failed to toggle autostart:", e);
    }
  };


  // 同步状态至独立浮空胶囊窗口并统一管控其显隐与自适应定位
  useEffect(() => {
    async function manageIndicatorWindow() {
      if (windowLabel !== "main") return;
      try {
        const indicatorWin = await WebviewWindow.getByLabel("indicator");
        if (!indicatorWin) return;

        // 1. 同步广播状态数据
        // 如果成功了，将转写内容一同发射过去展示
        const text = status === "success" ? (refinedText || rawText) : "";
        await indicatorWin.emit("indicator-state", { status, errorMessage, text });

        // 2. 统一指挥定位与显隐
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

  // 初始化设备与读取历史记录
  useEffect(() => {
    recorderRef.current = new AudioRecorder();

    // Show the main window after the component is mounted to prevent white flash
    if (windowLabel === "main") {
      getCurrentWindow().show().catch(console.error);
    }
  }, []);

  const [retryKey, setRetryKey] = useState(0);

  // 动态初始化或加载本地 Whisper 模型或 SenseVoice
  useEffect(() => {
    async function setupWhisper() {
      if (settings.asrEngine === "api") {
        setStatus("idle");
        return;
      }
      try {
        setStatus("initializing");
        setModelProgress(0);

        // 发送一次 Dummy IPC 请求以触发 Tauri 可能的 fallback (如 fetch 失败退回到 postMessage)
        try {
          await invoke("check_sensevoice_ready");
        } catch (fallbackErr) {
          console.warn("Initial IPC check failed, Tauri might be falling back to postMessage:", fallbackErr);
          // 给一点时间让 Tauri 完成内部的 protocol fallback 切换
          await new Promise(r => setTimeout(r, 500));
        }

        if (settings.whisperModel === "sensevoice-small") {
          const isReady: boolean = await invoke("check_sensevoice_ready");
          if (!isReady) {
            console.log("SenseVoice 模型未就绪，开始下载...");
            const unlisten = await listen("download-progress", (event: any) => {
              const { step, progress } = event.payload;
              console.log("Download progress:", step, progress);
              setModelProgress(Math.round(progress * 100));
              setDownloadStep(step);
            });
            await new Promise<void>(async (resolve, reject) => {
              const unlistenSuccess = await listen("download-success", () => {
                unlistenSuccess();
                unlistenError();
                resolve();
              });
              const unlistenError = await listen("download-error", (e: any) => {
                unlistenSuccess();
                unlistenError();
                reject(new Error(e.payload));
              });
              invoke("download_sensevoice").catch((err) => {
                unlistenSuccess();
                unlistenError();
                reject(err);
              });
            });
            unlisten();
          }
        } else {
          await initWhisper(settings.whisperModel, settings.inferenceDevice, (progress) => {
            setModelProgress(Math.round(progress));
          });
        }
        setStatus("idle");
      } catch (err: any) {
        console.error(err);
        setErrorMessage("识别引擎初始化失败，可能需要检查网络或重新运行：" + (err.message || err));
        setStatus("error");
      }
    }
    setupWhisper();
  }, [settings.whisperModel, settings.inferenceDevice, settings.asrEngine, retryKey]);

  const statusRef = useRef(status);
  const startRecordingRef = useRef<any>(null);
  const stopAndProcessRef = useRef<any>(null);
  const lastTypedLengthRef = useRef<number>(0);
  const isChunkProcessingRef = useRef<boolean>(false);

  useEffect(() => {
    statusRef.current = status;
    startRecordingRef.current = startRecording;
    stopAndProcessRef.current = stopAndProcess;
  });

  // 同步 blacklist 到 Rust
  useEffect(() => {
    if (!settings.blacklistStr) return;
    const list = settings.blacklistStr.split(/[,\n]/).map(s => s.trim()).filter(s => s);
    invoke("set_blacklist", { blacklist: list }).catch(console.error);
  }, [settings.blacklistStr]);

  // 初始化时等待动画后隐藏主窗口
  const isInitialBootRef = useRef(true);
  useEffect(() => {
    if (status === "idle" && isInitialBootRef.current) {
      isInitialBootRef.current = false;
      if (windowLabel === "main") {
        // 给用户1.5秒时间看“后台已就绪”然后隐藏
        setTimeout(() => {
          getCurrentWindow().hide().catch(console.error);
        }, 1500);
      }
    }
  }, [status, windowLabel]);

  // 当历史记录变化，或状态恢复空闲时，更新展示文本
  useEffect(() => {
    if (status === "idle" || status === "success" || status === "error") {
      if (history.length === 0) {
        setRawText("这是一款智能语音听写助手。只需按住快捷键说话，松开后，它就会自动将你的口语转化为流畅的书面文本。");
        setRefinedText("");
      } else {
        setRawText(history[0].rawText);
        setRefinedText(history[0].refinedText);
      }
    }
  }, [history, status]);

  // 监听听写界面内容高度，自动调整窗口高度
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

      // 我们监听 main-pane 内部的主容器（可能是 workspace 或者是 loading-container）
      const workspaceEl = document.querySelector('.main-pane > div');
      if (workspaceEl) {
        observer.observe(workspaceEl);
      }

      return () => {
        observer.disconnect();
      };
    }
  }, [activeTab, rawText, refinedText, status, windowLabel]);

  // 监听 Rust 全局快捷键状态
  useEffect(() => {
    const unlisten = listen("shortcut-state", async (event) => {
      console.log("前端收到按键状态:", event.payload);
      if (statusRef.current === "initializing") {
        console.log("系统正在初始化，忽略按键");
        return;
      }
      
      const payload = event.payload as { pressed: boolean; app_name?: string; window_title?: string };
      
      if (payload.pressed && !isRecordingRef.current) {
        console.log("准备开始录音... 目标应用:", payload.app_name);
        if (payload.app_name) {
          activeAppRef.current = payload.app_name;
        } else {
          activeAppRef.current = "";
        }
        // 按下快捷键 -> 开始录音
        await startRecordingRef.current();
      } else if (!payload.pressed && isRecordingRef.current) {
        console.log("准备停止录音并处理...");
        // 松开快捷键 -> 停止录音并处理
        await stopAndProcessRef.current();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 监听实时音量并广播给独立小药丸窗口
  useEffect(() => {
    let intervalId: any;
    let indicatorWin: any = null;

    async function setupVolumeTracker() {
      if (status !== "recording" || windowLabel !== "main") return;
      try {
        indicatorWin = await WebviewWindow.getByLabel("indicator");
        if (!indicatorWin) return;

        // 轮询等待麦克风启动和 analyser 初始化完毕（最多等待 2 秒）
        let analyser = null;
        for (let i = 0; i < 20; i++) {
          if (statusRef.current !== "recording") return; // 若中途取消则直接退出
          analyser = recorderRef.current?.getAnalyser();
          if (analyser) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (!analyser) {
          console.warn("Volume tracker: AnalyserNode not ready.");
          return;
        }

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // 每 50ms 采集一次音量并发送，配合 CSS 0.06s transition 实现极度平滑的波形动效
        intervalId = setInterval(() => {
          if (statusRef.current !== "recording") {
            clearInterval(intervalId);
            return;
          }

          analyser.getByteTimeDomainData(dataArray);

          // 计算 RMS 音量 (时域均方根)
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            const val = (dataArray[i] - 128) / 128;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / bufferLength);

          // 适当调大敏感度系数 (人声均值较低，乘以 600 会有极佳的起伏效果)
          const volume = Math.round(Math.min(100, rms * 600));

          // 异步发射，绝不使用 await 阻塞定时器
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
  }, [status, windowLabel]);

  // 监听独立浮空小药丸发过来的取消/强制提交事件
  useEffect(() => {
    if (windowLabel === "main") {
      const unlisten = listen("pill-action", (event) => {
        const payload = event.payload as { action: string };
        if (payload.action === "cancel") {
          cancelRecording();
        } else if (payload.action === "commit") {
          commitRecording();
        }
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }
  }, [windowLabel]);

  // 静默预热机制 (Cache Pre-warming)
  // 当配置为本地 SenseVoice 时，延迟 4 秒在后台静默执行一次极短推理，将 250MB 模型加载进操作系统 Page Cache
  useEffect(() => {
    let timeout: number | null = null;
    if (settings.asrEngine === 'local' && settings.whisperModel === 'sensevoice-small') {
      timeout = window.setTimeout(async () => {
        console.log("[预热] 延迟就绪，开始后台预热 SenseVoice 模型...");
        try {
          // 构造 0.1 秒的完全静音音频 (16000Hz * 0.1s = 1600 samples)
          const silentAudio = new Float32Array(1600);
          const wavBytes = float32ToWav(silentAudio, 16000);
          const dataDirPath = await appDataDir();
          const wavPath = await join(dataDirPath, "temp_sensevoice_warmup.wav");
          
          await writeFile(wavPath, wavBytes);
          // 调用底层执行推理。此时底层命令行程序会被启动，模型会被读取并常驻系统磁盘缓存
          await invoke("transcribe_sensevoice", { audioPath: wavPath });
          console.log("[预热] SenseVoice 预热执行完毕，模型已驻留缓存！");
        } catch (e: any) {
          // 由于音频是全静音，底层的 sherpa-onnx 极大可能会返回 "未能识别出文字" 的 Err，这是预期行为，完全忽略即可
          console.log("[预热] 预热过程结束 (若为'未能识别'属正常预期):", e.message || e);
        }
      }, 4000); // 延迟 4 秒，避开应用冷启动高负载期
    }
    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [settings.asrEngine, settings.whisperModel]);

  // 开始录音
  const startRecording = async () => {
    console.log("进入 startRecording...");
    if (!recorderRef.current) {
      console.log("失败: recorderRef.current 为 null");
      return;
    }
    try {
      isRecordingRef.current = true;
      setStatus("recording");
      setRawText("");
      setRefinedText("");
      setErrorMessage("");
      lastTypedLengthRef.current = 0;
      isChunkProcessingRef.current = false;

      focusLostRef.current = false;
      initialWindowRef.current = null;
      try {
        const winInfo: any = await invoke("get_active_window_info_cmd");
        initialWindowRef.current = { app_name: winInfo.app_name, window_title: winInfo.window_title };
      } catch (e) {
        console.error("无法获取初始焦点窗口信息", e);
      }

      if (recordingTimeoutRef.current !== null) {
        window.clearTimeout(recordingTimeoutRef.current);
      }
      invoke("duck_system_audio").catch((e) => console.error("Failed to duck audio", e));

      recordingTimeoutRef.current = window.setTimeout(() => {
        if (isRecordingRef.current) {
          console.warn("录音达到 5 分钟上限，自动停止");
          setErrorMessage("录音已达 5 分钟上限，正在为您自动转写");
          if (stopAndProcessRef.current) {
            stopAndProcessRef.current();
          }
        }
      }, 5 * 60 * 1000);

      // 如果不是 API 流式引擎，或开启了“纯剪贴板”模式，都不使用流式上屏
      const isStreamingAllowed = settings.asrEngine === 'api' && settings.typeMode !== 'clipboard';

      const onChunk = isStreamingAllowed ? async (chunk: Float32Array) => {
        if (isChunkProcessingRef.current || !isRecordingRef.current) return;
        if (focusLostRef.current) return; // 焦点已丢失，中止流式打字

        isChunkProcessingRef.current = true;
        try {
          // 焦点校验防流式乱打字
          if (initialWindowRef.current) {
            const currentWin: any = await invoke("get_active_window_info_cmd").catch(() => null);
            if (currentWin && currentWin.app_name !== initialWindowRef.current.app_name) {
              console.warn("焦点窗口已偏移！中止后续流式上屏以防错乱。");
              focusLostRef.current = true;
              return;
            }
          }

          const tempText = await transcribeAudioApi(chunk, {
            apiUrl: settings.asrApiUrl,
            apiKey: settings.asrApiKey,
            model: settings.asrApiModel
          });
          const cleanTemp = tempText.trim();
          if (cleanTemp && cleanTemp.length > 0 && isRecordingRef.current && !focusLostRef.current) {
            // Replace the previously typed text with the new temp text
            if (lastTypedLengthRef.current === 0) {
              await invoke("simulate_typing", { text: cleanTemp });
            } else {
              await invoke("replace_with_ai_text", {
                originalLen: lastTypedLengthRef.current,
                newText: cleanTemp
              });
            }
            lastTypedLengthRef.current = cleanTemp.length;
            setRawText(cleanTemp);
          }
        } catch (e) {
          console.error("Chunk transcription failed:", e);
        } finally {
          isChunkProcessingRef.current = false;
        }
      } : undefined;

      await recorderRef.current.start(onChunk, settings.asrEngine === 'api' ? 2000 : 0);
      console.log("麦克风启动成功");
    } catch (err: any) {
      console.error("麦克风启动抛出异常:", err);
      isRecordingRef.current = false;
      if (recordingTimeoutRef.current !== null) {
        window.clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      let friendlyError = "无法启动麦克风：" + err.message;
      const errMsg = err.message?.toLowerCase() || '';
      if (err.name === 'NotAllowedError' || errMsg.includes('permission denied')) {
        friendlyError = "无法启动录音：麦克风权限被拒绝。请在系统偏好设置中允许应用访问麦克风。";
      } else if (err.name === 'NotFoundError' || errMsg.includes('not found')) {
        friendlyError = "无法启动录音：未检测到可用麦克风设备，请检查连接。";
      } else if (err.name === 'NotReadableError' || errMsg.includes('in use') || errMsg.includes('not readable')) {
        friendlyError = "无法启动录音：麦克风正被其他程序独占或发生硬件异常。";
      }
      setErrorMessage(friendlyError);
      setStatus("error");
    }
  };

  // 取消当前录音
  const cancelRecording = async () => {
    if (recorderRef.current && isRecordingRef.current) {
      recorderRef.current.stop();
      isRecordingRef.current = false;
      
      if (recordingTimeoutRef.current !== null) {
        window.clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      invoke("restore_system_audio").catch((e) => console.error("Failed to restore audio", e));
      
      // 取消时，清除之前打出的占位符
      if (lastTypedLengthRef.current > 0) {
        if (settings.typeMode !== "clipboard" && !focusLostRef.current) {
          await invoke("replace_with_ai_text", {
            originalLen: lastTypedLengthRef.current,
            newText: ""
          });
          lastTypedLengthRef.current = 0;
        } else {
          await writeText("");
          lastTypedLengthRef.current = 0;
        }
      }
      
      setStatus("idle");
    }
  };

  // 强制立即提交识别
  const commitRecording = async () => {
    await stopAndProcess();
  };

  // 停止录音并进行 ASR 识别和 AI 润色
  const stopAndProcess = async () => {
    console.log("进入 stopAndProcess...");
    if (!recorderRef.current || !isRecordingRef.current) {
      console.log("失败: 状态不正确", { hasRecorder: !!recorderRef.current, isRecording: isRecordingRef.current });
      return;
    }
    isRecordingRef.current = false;
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    invoke("restore_system_audio").catch((e) => console.error("Failed to restore audio", e));
    setStatus("transcribing");

    // 辅助函数：清除目标窗口中残留的占位符文本
    const clearPlaceholder = async () => {
      if (lastTypedLengthRef.current > 0) {
        try {
          await invoke("replace_with_ai_text", {
            originalLen: lastTypedLengthRef.current,
            newText: ""
          });
        } catch (e) {
          console.error("清除占位符失败:", e);
        }
        lastTypedLengthRef.current = 0;
      }
    };

    // 如果不是 API 流式引擎，原本替换为正在转写的占位符的功能已删除

    try {
      // 1. 获取录音音频 data
      const audioData = recorderRef.current.stop();
      console.log("麦克风已停止，获取到音频长度:", audioData.length);
      
      // VAD 静音与噪音拦截 (滑动窗口 RMS 算法)
      const VAD_THRESHOLD_MAX = 0.01;
      const VAD_THRESHOLD_RMS = 0.002;
      const VAD_WINDOW_SIZE = 800; // 50ms at 16000Hz
      const VAD_REQUIRED_WINDOWS = 3; // 至少连续 150ms 达标判定为人声

      let globalMax = 0;
      let hasVoice = false;
      let consecutiveVoiceFrames = 0;

      for (let i = 0; i < audioData.length; i += VAD_WINDOW_SIZE) {
        let sumSquares = 0;
        let frameMax = 0;
        let count = 0;
        
        for (let j = 0; j < VAD_WINDOW_SIZE && i + j < audioData.length; j++) {
          const val = audioData[i + j];
          const abs = Math.abs(val);
          if (abs > frameMax) frameMax = abs;
          if (abs > globalMax) globalMax = abs;
          sumSquares += val * val;
          count++;
        }
        
        const rms = Math.sqrt(sumSquares / count);
        if (rms >= VAD_THRESHOLD_RMS && frameMax >= VAD_THRESHOLD_MAX) {
          consecutiveVoiceFrames++;
          if (consecutiveVoiceFrames >= VAD_REQUIRED_WINDOWS) {
            hasVoice = true;
            break; // 已经确认包含有效人声，无需继续遍历
          }
        } else {
          consecutiveVoiceFrames = 0; // 连续性中断
        }
      }

      if (audioData.length === 0 || globalMax < 0.005) {
        console.warn("VAD 拦截：全静音或音量极低", { globalMax });
        await clearPlaceholder();
        setErrorMessage("麦克风收音音量过低，请靠近麦克风或大声点。");
        setStatus("error");
        return; 
      }

      if (!hasVoice) {
        console.warn("VAD 拦截：瞬时噪音（如键盘敲击），静默拦截");
        await clearPlaceholder();
        setStatus("idle");
        return; 
      }

      console.log("正在转写音频，大小: ", audioData.length);
      
      let text = "";
      if (settings.asrEngine === 'api') {
        text = await transcribeAudioApi(audioData, {
          apiUrl: settings.asrApiUrl,
          apiKey: settings.asrApiKey,
          model: settings.asrApiModel
        });
      } else if (settings.whisperModel === 'sensevoice-small') {
        // 使用 SenseVoice Small 原生推理
        const wavBytes = float32ToWav(audioData, 16000);
        const dataDirPath = await appDataDir();
        const wavPath = await join(dataDirPath, "temp_sensevoice.wav");
        
        try {
          await writeFile(wavPath, wavBytes);
          const rawResult: string = await invoke("transcribe_sensevoice", { audioPath: wavPath });
          console.log("SenseVoice Result:", rawResult);
          // Rust 端已完成输出解析和 SenseVoice token 清洗，直接使用
          text = rawResult.trim();
        } catch (e: any) {
          console.error("SenseVoice error:", e);
          await clearPlaceholder();
          setErrorMessage("SenseVoice 推理出错：" + (e.message || e));
          setStatus("error");
          return;
        }
      } else {
        text = await transcribeAudio(audioData, { 
          language: settings.asrLanguage === 'auto' ? undefined : settings.asrLanguage,
          model: settings.whisperModel,
          device: settings.inferenceDevice,
          prompt: settings.hotWords ? `${settings.hotWords}。${lastContext}` : lastContext
        });
      }
      
      const cleanText = text.trim();
      
      if (!cleanText) {
        await clearPlaceholder();
        setErrorMessage("没有检测到有效说话声，请重试。");
        setStatus("idle");
        return;
      }

      // 2. 如果未配置 AI 密钥，则开启离线兜底标点补偿 (简单判断句尾是否有标点)
      let finalText = cleanText;
      if (!settings.apiKey.trim()) {
        const lastChar = finalText.slice(-1);
        const punctuationRegex = /[。！？.!?]/;
        if (!punctuationRegex.test(lastChar)) {
          // 基础中英文末尾补全
          if (/^[a-zA-Z0-9\s]+$/.test(finalText.slice(-3))) {
            finalText += ".";
          } else {
            finalText += "。";
          }
        }
      }

      setRawText(finalText);

      // 3. 将最终的原文打出
      const shouldSimulateTyping = settings.typeMode !== "clipboard" && !focusLostRef.current;

      if (shouldSimulateTyping) {
        if (lastTypedLengthRef.current > 0) {
          // 如果在流式阶段已经上屏过临时文本，则替换成完整的最终识别文本
          await invoke("replace_with_ai_text", {
            originalLen: lastTypedLengthRef.current,
            newText: finalText
          });
        } else {
          // 如果没有（例如使用了本地模型），则直接打出
          await invoke("simulate_typing", { text: finalText });
        }
        lastTypedLengthRef.current = finalText.length;
      } else {
        await writeText(finalText);
        if (focusLostRef.current) {
          setErrorMessage("检测到焦点转移，防止乱打字已中断上屏。文本已保存至剪贴板，请手动粘贴。");
          setStatus("error");
          setTimeout(() => {
            setStatus("idle");
            setErrorMessage("");
          }, 4000);
          return;
        }
      }

      // 如果未配置 AI 密钥，则跳过 AI 润色，作为纯听写工具直接成功录入
      if (!settings.apiKey.trim()) {
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: finalText, style: settings.promptStyle, success: false });
        setLastContext((prev) => (prev + " " + finalText).slice(-100));
        setStatus("success");
        setTimeout(() => {
          setStatus("idle");
        }, 1500);
        return;
      }

      // 4. 开始 AI 润色
      setStatus("rewriting");

      const llmConfig: LLMConfig = { 
        apiKey: settings.apiKey, 
        baseUrl: settings.baseUrl, 
        model: settings.modelName, 
        promptStyle: settings.promptStyle, 
        appName: activeAppRef.current,
        hotWords: settings.hotWords 
      };
      
      try {
        const refined = await refineText(finalText, llmConfig);
        setRefinedText(refined);
        
        // 5. 用粘贴瞬时替换为 AI 优化文本
        if (shouldSimulateTyping) {
          await invoke("replace_with_ai_text", {
            originalLen: lastTypedLengthRef.current,
            newText: refined
          });
          lastTypedLengthRef.current = refined.length;
        } else {
          await writeText(refined);
          if (focusLostRef.current) {
            setErrorMessage("检测到焦点转移，防止乱打字已中断上屏。文本已保存至剪贴板，请手动粘贴。");
            setStatus("error");
            setTimeout(() => {
              setStatus("idle");
              setErrorMessage("");
            }, 4000);
            return;
          }
        }

        // 成功，记入历史
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: refined, style: settings.promptStyle, success: true });
        setLastContext((prev) => (prev + " " + refined).slice(-100));
        setStatus("success");
        
        setTimeout(() => {
          setStatus("idle");
        }, 1500);

      } catch (err: any) {
        console.error(err);
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: finalText, style: settings.promptStyle, success: false });
        setLastContext((prev) => (prev + " " + finalText).slice(-100));
        setErrorMessage("网络异常，AI 润色未成功，已为您保留识别原文。");
        setStatus("error");
      }

    } catch (err: any) {
      console.error(err);
      await clearPlaceholder();
      setErrorMessage("识别出错：" + (err.message || err));
      setStatus("idle");
    }
  };

  const retryRefine = async (id: string, text: string, style: string) => {
    if (!settings.apiKey) return;
    const llmConfig: LLMConfig = { apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.modelName, promptStyle: style, appName: activeAppRef.current };
    
    const refined = await refineText(text, llmConfig);
    updateHistoryItem(id, { refinedText: refined, success: true });
    
    // 自动复制到剪贴板
    try {
      await navigator.clipboard.writeText(refined);
    } catch(e) {
      console.error("Auto copy failed", e);
    }
  };

  const promptStyleLabels: Record<string, string> = {
    natural: "口语",
    formal: "正式",
    concise: "简明",
    academic: "学术"
  };
  const promptStyleKeys = Object.keys(promptStyleLabels);
  
  const cyclePromptStyle = () => {
    const currentIndex = promptStyleKeys.indexOf(settings.promptStyle);
    const nextIndex = (currentIndex + 1) % promptStyleKeys.length;
    updateSetting("promptStyle", promptStyleKeys[nextIndex]);
  };

  // 如果是小药丸窗口，渲染特殊 UI
  if (windowLabel === "indicator") {
    return (
      <div className="indicator-container">
        {status === "recording" && (
          <div className="recording-indicator pulse-animation">
            <Mic size={14} className="text-red" />
            <span className="text-sm font-medium">听写中...</span>
          </div>
        )}
        {status === "transcribing" && (
          <div className="processing-indicator">
            <RefreshCw size={14} className="text-blue spin-icon" />
            <span className="text-sm font-medium">识别中...</span>
          </div>
        )}
        {status === "rewriting" && (
          <div className="processing-indicator">
            <Sparkles size={14} className="text-blue animate-bounce" />
            <span className="text-sm font-medium">AI 润色中...</span>
          </div>
        )}
        {status === "success" && (
          <div className="success-indicator animate-fade-in">
            <Check size={14} className="text-green" />
            <span className="text-sm font-medium text-green-400">完成</span>
          </div>
        )}
        {status === "error" && (
          <div className="error-indicator animate-fade-in">
            <AlertTriangle size={14} className="text-orange" />
            <span className="text-sm font-medium text-orange-400">错误</span>
          </div>
        )}
        
        {/* 小药丸的极简提示词风格切换器 */}
        <div 
          className="indicator-style-toggle"
          onClick={cyclePromptStyle}
          title="点击切换润色风格"
          style={{
            marginLeft: '8px',
            padding: '2px 6px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.8)',
            userSelect: 'none'
          }}
        >
          {promptStyleLabels[settings.promptStyle] || "口语"}
        </div>
      </div>
    );
  }

  // 主窗口渲染
  return (
    <div className="app-container">
      <AutoUpdater />
      {/* 头部拖拽区与导航 */}
      <header data-tauri-drag-region className="app-header">
        <div className="window-actions-left">
          <button className="win-btn close" onClick={() => getCurrentWindow().hide()} title="隐藏窗口"></button>
          <button className="win-btn minimize" onClick={() => getCurrentWindow().minimize()} title="最小化"></button>
        </div>
        <nav className="app-nav">
          <button 
            className={`nav-item ${activeTab === "main" ? "active" : ""}`}
            onClick={() => setActiveTab("main")}
            title="听写面板"
          >
            {status === "initializing" && <RefreshCw size={16} className="spin-icon text-gray" />}
            {status === "idle" && <Mic size={16} />}
            {status === "recording" && <Mic size={16} className="text-red pulse-red-icon" />}
            {status === "transcribing" && <RefreshCw size={16} className="spin-icon text-blue" />}
            {status === "rewriting" && <Sparkles size={16} className="animate-bounce text-blue" />}
            {status === "success" && <Check size={16} className="text-green" />}
            {status === "error" && <AlertTriangle size={16} className="text-orange" />}
          </button>
          <button 
            className={`nav-item ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
            title="听写历史"
          >
            <History size={16} />
          </button>
          <button 
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
            title="偏好设置"
          >
            <Settings size={16} />
          </button>
        </nav>
      </header>

      {/* 主内容区域 */}
      <main className="app-main">
        <div className="tab-wrapper" style={{ transform: `translateX(-${activeTab === "main" ? 0 : activeTab === "history" ? 33.3333 : 66.6666}%)` }}>
          
          {/* Panel 1: 语音听写主面板 */}
          <div className={`tab-pane ${activeTab === 'main' ? 'active' : ''}`}>
            <MainPanel
              status={status}
              modelProgress={modelProgress}
              downloadStep={downloadStep}
              whisperModel={settings.whisperModel}
              listenKey={settings.listenKey}
              errorMessage={errorMessage}
              asrEngine={settings.asrEngine}
              setStatus={setStatus}
              setErrorMessage={setErrorMessage}
              rawText={rawText}
              refinedText={refinedText}
              promptStyle={settings.promptStyle}
              updateSetting={updateSetting}
              retry={() => setRetryKey(k => k + 1)}
            />
          </div>

          {/* Panel 2: 听写历史记录 */}
          <div className={`tab-pane ${activeTab === 'history' ? 'active' : ''}`}>
            <HistoryPanel
              history={history}
              deleteHistoryItem={deleteHistoryItem}
              clearHistory={clearHistory}
              copyToClipboard={copyToClipboard}
              retryRefine={retryRefine}
              copiedId={copiedId}
              hasApiKey={!!settings.apiKey.trim()}
            />
          </div>

          {/* Panel 3: 偏好设置 */}
          <div className={`tab-pane ${activeTab === 'settings' ? 'active' : ''}`}>
            <SettingsPanel
              settings={settings}
              updateSetting={updateSetting}
              saveSettings={saveSettings}
              saveStatus={saveStatus}
              logs={logs}
              setLogs={setLogs}
              autostartEnabled={autostartEnabled}
              toggleAutostart={toggleAutostart}
            />
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;
