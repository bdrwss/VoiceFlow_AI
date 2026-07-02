import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, currentMonitor, PhysicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import { appDataDir, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import "./App.css";

import { useSettings } from "./hooks/useSettings";
import { useHistory } from "./hooks/useHistory";
import { MainPanel } from "./components/MainPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { SettingsPanel } from "./components/SettingsPanel";

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

  const [rawText, setRawText] = useState("");
  const [refinedText, setRefinedText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "history" | "settings">("main");
  
  const { settings, updateSetting, saveSettings, saveStatus } = useSettings();
  const { history, addHistoryItem, deleteHistoryItem, clearHistory, copyToClipboard, copiedId } = useHistory();

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
            await invoke("download_sensevoice");
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

  // 初始启动时，等待加载完毕后自动隐藏主窗口
  const isInitialBootRef = useRef(true);
  useEffect(() => {
    if (status === "idle" && isInitialBootRef.current) {
      isInitialBootRef.current = false;
      if (windowLabel === "main") {
        // 给用户1.5秒钟时间看清“后台就绪”的提示，然后收起到托盘
        setTimeout(() => {
          getCurrentWindow().hide().catch(console.error);
        }, 1500);
      }
    }
  }, [status, windowLabel]);

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

      // 如果不是 API 流式引擎（即使用本地模型如 SenseVoice/Whisper），在目标窗口打出占位符给用户反馈
      if (settings.asrEngine !== 'api') {
        const placeholder = "[正在录音...]";
        await invoke("simulate_typing", { text: placeholder });
        lastTypedLengthRef.current = placeholder.length;
        setRawText(placeholder);
      }

      const onChunk = settings.asrEngine === 'api' ? async (chunk: Float32Array) => {
        if (isChunkProcessingRef.current || !isRecordingRef.current) return;
        isChunkProcessingRef.current = true;
        try {
          const tempText = await transcribeAudioApi(chunk, {
            apiUrl: settings.asrApiUrl,
            apiKey: settings.asrApiKey,
            model: settings.asrApiModel
          });
          const cleanTemp = tempText.trim();
          if (cleanTemp && cleanTemp.length > 0 && isRecordingRef.current) {
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
      setErrorMessage("无法启动麦克风：" + err.message);
      setStatus("error");
    }
  };

  // 取消当前录音
  const cancelRecording = async () => {
    if (recorderRef.current && isRecordingRef.current) {
      recorderRef.current.stop();
      isRecordingRef.current = false;
      
      // 取消时，清除之前打出的占位符
      if (lastTypedLengthRef.current > 0) {
        await invoke("replace_with_ai_text", {
          originalLen: lastTypedLengthRef.current,
          newText: ""
        });
        lastTypedLengthRef.current = 0;
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
    setStatus("transcribing");

    if (settings.asrEngine !== 'api' && lastTypedLengthRef.current > 0) {
      // 替换为正在转写的占位符
      const transcribingPlaceholder = "[正在加载模型并转写...]";
      await invoke("replace_with_ai_text", {
        originalLen: lastTypedLengthRef.current,
        newText: transcribingPlaceholder
      });
      lastTypedLengthRef.current = transcribingPlaceholder.length;
      setRawText(transcribingPlaceholder);
    }

    try {
      // 1. 获取录音音频 data
      const audioData = recorderRef.current.stop();
      console.log("麦克风已停止，获取到音频长度:", audioData.length);
      
      let maxVal = 0;
      for (let i = 0; i < audioData.length; i++) {
        const abs = Math.abs(audioData[i]);
        if (abs > maxVal) maxVal = abs;
      }

      if (audioData.length === 0) {
        console.warn("VAD 拦截：全静音");
        setErrorMessage("麦克风收音音量过低 (未检测到人声)，请靠近麦克风或大声点。");
        setStatus("error");
        return; 
      }

      if (maxVal < 0.01) {
        console.warn("麦克风收音音量过低，最大振幅:", maxVal);
        setErrorMessage("麦克风收音音量过低 (没有声音)，请靠近麦克风或大声点。");
        setStatus("error");
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
        
        await writeFile(wavPath, wavBytes);
        
        try {
          const rawStdout: string = await invoke("transcribe_sensevoice", { audioPath: wavPath });
          console.log("SenseVoice Output:", rawStdout);
          
          // sherpa-onnx output often contains lines of logs, but the recognized text is usually at the end.
          // Or it outputs JSON. Let's just strip known bad prefixes if any, or find the json.
          // If it's pure text, we just use the last non-empty line or try to regex match it.
          const match = rawStdout.match(/\{.*"text"\s*:\s*"([^"]+)".*\}/);
          if (match && match[1]) {
             text = match[1];
          } else {
             // Fallback to taking the last line if not JSON
             const lines = rawStdout.trim().split('\n');
             text = lines[lines.length - 1] || "";
          }
        } catch (e) {
          console.error("SenseVoice error:", e);
          setErrorMessage("SenseVoice 推理出错，可能需要重新下载模型。");
          setStatus("error");
          return;
        }
      } else {
        text = await transcribeAudio(audioData, { 
          language: settings.asrLanguage === 'auto' ? undefined : settings.asrLanguage,
          model: settings.whisperModel,
          device: settings.inferenceDevice,
          prompt: lastContext
        });
      }
      
      const cleanText = text.trim();
      
      if (!cleanText) {
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

      const llmConfig: LLMConfig = { apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.modelName, promptStyle: settings.promptStyle, appName: activeAppRef.current };
      
      try {
        const refined = await refineText(finalText, llmConfig);
        setRefinedText(refined);
        
        // 5. 用粘贴瞬时替换为 AI 优化文本
        await invoke("replace_with_ai_text", {
          originalLen: lastTypedLengthRef.current,
          newText: refined
        });

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
      setErrorMessage("识别出错：" + (err.message || err));
      setStatus("idle");
    }
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
      </div>
    );
  }

  // 主窗口渲染
  return (
    <div className="app-container">
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
              copiedId={copiedId}
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
