import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { appDataDir, join } from "@tauri-apps/api/path";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";

import { 
  Mic, 
  Settings, 
  History, 
  Sparkles, 
  RefreshCw, 
  Check, 
  AlertTriangle,
} from "lucide-react";
import { float32ToWav } from "./utils/audio";
import { refineText, LLMConfig } from "./utils/llm";
import { writeFile } from "@tauri-apps/plugin-fs";
import "./App.css";

import { useSettings } from "./hooks/useSettings";
import { useVoiceRecording } from "./hooks/useVoiceRecording";
import { useASR } from "./hooks/useASR";
import { useLLMRefine } from "./hooks/useLLMRefine";
import { useWindowManager } from "./hooks/useWindowManager";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";
import { useHistory } from "./hooks/useHistory";
import { MainPanel } from "./components/MainPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { AutoUpdater } from "./components/AutoUpdater";
import { SetupWizard } from "./components/SetupWizard";

function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const { t } = useTranslation();

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
  const [windowLabel] = useState<string>(() => {
    try {
      return getCurrentWindow().label;
    } catch (e) {
      return "main";
    }
  });
  
  const isRecordingRef = useRef(false);
  const activeAppRef = useRef<string>("");
  const focusLostRef = useRef<boolean>(false);
  const initialWindowRef = useRef<{app_name: string | null, window_title: string | null} | null>(null);

  const [rawText, setRawText] = useState("");
  const [refinedText, setRefinedText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "history" | "settings">("main");
  
  const { settings, updateSetting, saveSettings, saveStatus, isDirty } = useSettings();
  const { history, addHistoryItem, updateHistoryItem, deleteHistoryItem, clearHistory, copyToClipboard, copiedId } = useHistory();

  // 首次启动引导
  const [showSetupWizard, setShowSetupWizard] = useState(() => {
    return !localStorage.getItem("vf_setup_complete");
  });

  // 首次启动引导时，需要显示主窗口
  useEffect(() => {
    if (showSetupWizard && windowLabel === "main") {
      getCurrentWindow().show().catch(console.error);
    }
  }, [showSetupWizard, windowLabel]);

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
        await disable().catch(e => console.warn("disable autostart failed (normal in dev):", e));
        setAutostartEnabled(false);
        updateSetting('autoStart', false);
      } else {
        await enable().catch(e => console.warn("enable autostart failed (normal in dev):", e));
        setAutostartEnabled(true);
        updateSetting('autoStart', true);
      }
    } catch (e) {
      console.error("Failed to toggle autostart:", e);
    }
  };

  // 监听来自系统托盘的菜单点击事件
  useEffect(() => {
    let unlistens: Array<() => void> = [];

    const setupListeners = async () => {
      try {
        const show = await listen('show', () => setActiveTab('main'));
        const history = await listen('history', () => setActiveTab('history'));
        const settings = await listen('settings', () => setActiveTab('settings'));
        unlistens = [show, history, settings];
      } catch (e) {
        console.warn("Tauri events not available (browser mode):", e);
      }
    };

    setupListeners();

    return () => {
      unlistens.forEach(fn => fn());
    };
  }, []);



  const [retryKey, setRetryKey] = useState(0);

  // 初始化加载 SenseVoice
  useEffect(() => {
    async function setupWhisper() {
      // 首次引导中，不自动初始化引擎（由 SetupWizard 接管）
      if (showSetupWizard) return;

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

        setStatus("idle");
      } catch (err: any) {
        console.error(err);
        setErrorMessage("识别引擎初始化失败，可能需要检查网络或重新运行：" + (err.message || err));
        setStatus("error");
      }
    }
    setupWhisper();
  }, [settings.asrEngine, retryKey, showSetupWizard]);

  // 首次引导完成回调
  const handleSetupComplete = (engine: "local" | "api", apiConfig?: { url: string; key: string; model: string }) => {
    updateSetting("asrEngine", engine);
    if (engine === "api" && apiConfig) {
      updateSetting("asrApiUrl", apiConfig.url);
      updateSetting("asrApiKey", apiConfig.key);
      updateSetting("asrApiModel", apiConfig.model);
    }
    // 立即持久化
    localStorage.setItem("vf_setup_complete", "1");
    // 同步保存 settings 到 localStorage
    const currentSettings = JSON.parse(localStorage.getItem("vf_settings") || "{}");
    currentSettings.asrEngine = engine;
    if (engine === "api" && apiConfig) {
      currentSettings.asrApiUrl = apiConfig.url;
      currentSettings.asrApiKey = apiConfig.key;
      currentSettings.asrApiModel = apiConfig.model;
    }
    localStorage.setItem("vf_settings", JSON.stringify(currentSettings));
    setShowSetupWizard(false);
    // 如果是 local 模式，引擎已在 wizard 里下载完成，直接 idle
    if (engine === "local") {
      setStatus("idle");
    }
  };


  // 同步 blacklist 到 Rust
  useEffect(() => {
    if (!settings.blacklistStr) return;
    const list = settings.blacklistStr.split(/[,\n]/).map(s => s.trim()).filter(s => s);
    invoke("set_blacklist", { blacklist: list }).catch(console.error);
  }, [settings.blacklistStr]);


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





  // 静默预热机制 (Cache Pre-warming)
  // 当配置为本地 SenseVoice 时，延迟 4 秒在后台静默执行一次极短推理，将 250MB 模型加载进操作系统 Page Cache
  useEffect(() => {
    let timeout: number | null = null;
    if (settings.asrEngine === 'local') {
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
  }, [settings.asrEngine]);


  // ========== 核心能力 Hooks ==========
  const isChunkProcessingRef = useRef<boolean>(false);
  const { startTranscribe, compensatePunctuation } = useASR();
  const { clearPlaceholder, typeText, resetTypedLength, performRefine } = useLLMRefine();
  
  const { startRecording: startMic, stopRecording: stopMic, getAnalyser } = useVoiceRecording({
    onChunk: async (chunk) => {
      if (isChunkProcessingRef.current || !isRecordingRef.current) return;
      if (focusLostRef.current) return;
      isChunkProcessingRef.current = true;
      try {
        if (initialWindowRef.current) {
          const currentWin: any = await invoke("get_active_window_info_cmd").catch(() => null);
          if (currentWin && currentWin.app_name !== initialWindowRef.current.app_name) {
            console.warn("焦点窗口已偏移！中止后续流式上屏以防错乱。");
            focusLostRef.current = true;
            return;
          }
        }
        const tempText = await startTranscribe(chunk, {
          asrEngine: settings.asrEngine,
          asrApiUrl: settings.asrApiUrl,
          asrApiKey: settings.asrApiKey,
          asrApiModel: settings.asrApiModel
        });
        const cleanTemp = tempText.trim();
        if (cleanTemp && cleanTemp.length > 0 && isRecordingRef.current && !focusLostRef.current) {
          await typeText(cleanTemp, settings.typeMode !== "clipboard", focusLostRef.current);
          setRawText(cleanTemp);
        }
      } catch (e) {
        console.error("Chunk transcription failed:", e);
      } finally {
        isChunkProcessingRef.current = false;
      }
    },
    onTimeout: () => {
      console.warn("录音达到 5 分钟上限，自动停止");
      setErrorMessage("录音已达 5 分钟上限，正在为您自动转写");
      commitRecording();
    },
    chunkIntervalMs: (settings.asrEngine === 'api' && settings.typeMode !== 'clipboard') ? 2000 : 0
  });

  useWindowManager({
    windowLabel,
    status,
    errorMessage,
    rawText,
    refinedText,
    activeTab,
    onCancel: () => cancelRecording(),
    onCommit: () => commitRecording(),
    getAnalyser
  });

  // ========== UI 业务逻辑 ==========

  const startRecording = async (appName?: string, windowTitle?: string) => {
    try {
      isRecordingRef.current = true;
      setStatus("recording");
      setRawText("");
      setRefinedText("");
      setErrorMessage("");
      resetTypedLength();
      isChunkProcessingRef.current = false;
      focusLostRef.current = false;
      activeAppRef.current = appName || "";
      initialWindowRef.current = appName ? { app_name: appName, window_title: windowTitle || "" } : null;
      
      await startMic();
    } catch (err: any) {
      console.error("麦克风启动抛出异常:", err);
      isRecordingRef.current = false;
      setErrorMessage("无法启动麦克风：" + err.message);
      setStatus("error");
    }
  };

  const cancelRecording = async () => {
    if (isRecordingRef.current) {
      stopMic();
      isRecordingRef.current = false;
      await clearPlaceholder(settings.typeMode !== "clipboard" && !focusLostRef.current);
      setStatus("idle");
    }
  };

  const commitRecording = async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setStatus("transcribing");
    
    const { audioData, isValid } = stopMic();
    const shouldSimulateTyping = settings.typeMode !== "clipboard" && !focusLostRef.current;

    if (!isValid) {
      await clearPlaceholder(shouldSimulateTyping);
      setErrorMessage("收音无效（音量过低或仅有瞬时噪音）。");
      setStatus("error");
      return; 
    }

    try {
      const text = await startTranscribe(audioData, {
        asrEngine: settings.asrEngine,
        asrApiUrl: settings.asrApiUrl,
        asrApiKey: settings.asrApiKey,
        asrApiModel: settings.asrApiModel
      });
      
      if (!text) {
        await clearPlaceholder(shouldSimulateTyping);
        setErrorMessage("没有检测到有效说话声，请重试。");
        setStatus("idle");
        return;
      }
      
      const finalText = compensatePunctuation(text, !!settings.apiKey.trim() || settings.llmProvider === "ollama");
      setRawText(finalText);

      try {
        await typeText(finalText, shouldSimulateTyping, focusLostRef.current);
      } catch (e: any) {
        if (e.message === "FOCUS_LOST") {
          setErrorMessage("检测到焦点转移，防止乱打字已中断上屏。文本已保存至剪贴板，请手动粘贴。");
          setStatus("error");
          setTimeout(() => { setStatus("idle"); setErrorMessage(""); }, 4000);
          return;
        }
      }

      let targetPromptStyle = settings.promptStyle;
      if (settings.enableSmartContext && activeAppRef.current) {
        const appNameLower = activeAppRef.current.toLowerCase();
        const matchedBinding = settings.smartContextBindings?.find(b => 
          b.appKeyword && appNameLower.includes(b.appKeyword.toLowerCase())
        );
        if (matchedBinding && matchedBinding.promptId) {
          targetPromptStyle = matchedBinding.promptId;
          console.log(`Smart Context Match: ${activeAppRef.current} -> ${targetPromptStyle}`);
        }
      }

      if ((!settings.apiKey.trim() && settings.llmProvider !== "ollama") || !settings.enableOptimization) {
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: finalText, style: targetPromptStyle, success: false, appName: activeAppRef.current });
        setStatus("success");
        setTimeout(() => setStatus("idle"), 1500);
        return;
      }

      let screenshotBase64: string | undefined = undefined;
      if (settings.enableScreenCapture) {
        try {
          screenshotBase64 = await invoke<string>("capture_screen", { mode: settings.screenCaptureMode });
        } catch (err) {
          console.warn("屏幕感知截图失败，降级为纯文本润色:", err);
        }
      }

      setStatus("rewriting");
      try {
        const currentPromptPreset = settings.customPrompts?.find(p => p.id === targetPromptStyle);
        const refined = await performRefine(finalText, {
          apiKey: settings.apiKey, 
          baseUrl: settings.baseUrl, 
          model: settings.modelName, 
          promptStyle: targetPromptStyle, 
          customPromptText: currentPromptPreset?.prompt,
          appName: activeAppRef.current,
          hotWords: settings.hotWords,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          isLocal: settings.llmProvider === "ollama",
          screenshotBase64
        });
        setRefinedText(refined);
        
        try {
          await typeText(refined, shouldSimulateTyping, focusLostRef.current);
        } catch (e: any) {
          if (e.message === "FOCUS_LOST") {
            setErrorMessage("检测到焦点转移，文本已保存至剪贴板，请手动粘贴。");
            setStatus("error");
            setTimeout(() => { setStatus("idle"); setErrorMessage(""); }, 4000);
            return;
          }
        }
        
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: refined, style: targetPromptStyle, success: true, appName: activeAppRef.current });
        setStatus("success");
        setTimeout(() => setStatus("idle"), 1500);
      } catch (err) {
        console.error(err);
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: finalText, style: settings.promptStyle, success: false, appName: activeAppRef.current });
        setErrorMessage("网络异常，AI 润色未成功，已为您保留识别原文。");
        setStatus("error");
      }
    } catch (err: any) {
      console.error(err);
      await clearPlaceholder(shouldSimulateTyping);
      setErrorMessage("识别出错：" + (err.message || err));
      setStatus("idle");
    }
  };

  useGlobalHotkeys({
    status,
    isRecording: isRecordingRef.current,
    onPress: startRecording,
    onRelease: commitRecording
  });

  const retryRefine = async (item: { id: string; rawText: string; style: string }) => {
    if (!settings.apiKey && settings.llmProvider !== "ollama") return;
    
    // Look up the prompt text using the item's saved style id
    const currentPromptPreset = settings.customPrompts?.find(p => p.id === item.style);
    
    const llmConfig: LLMConfig = { 
      apiKey: settings.apiKey, 
      baseUrl: settings.baseUrl, 
      model: settings.modelName, 
      promptStyle: item.style, 
      customPromptText: currentPromptPreset?.prompt,
      appName: activeAppRef.current,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      isLocal: settings.llmProvider === "ollama"
    };
    
    const refined = await refineText(item.rawText, llmConfig);
    updateHistoryItem(item.id, { refinedText: refined, success: true });
    
    // 自动复制到剪贴板
    try {
      await navigator.clipboard.writeText(refined);
    } catch(e) {
      console.error("Auto copy failed", e);
    }
  };

  const cyclePromptStyle = () => {
    if (!settings.customPrompts || settings.customPrompts.length === 0) return;
    const currentIndex = settings.customPrompts.findIndex(p => p.id === settings.promptStyle);
    const nextIndex = (currentIndex + 1) % settings.customPrompts.length;
    updateSetting("promptStyle", settings.customPrompts[nextIndex].id);
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
          {settings.customPrompts?.find(p => p.id === settings.promptStyle)?.name?.slice(0, 4) || "默认"}
        </div>
      </div>
    );
  }

  // 首次启动引导
  if (showSetupWizard && windowLabel === "main") {
    return <SetupWizard onComplete={handleSetupComplete} />;
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
              listenKey={settings.listenKey}
              errorMessage={errorMessage}
              asrEngine={settings.asrEngine}
              setStatus={setStatus}
              setErrorMessage={setErrorMessage}
              rawText={rawText}
              refinedText={refinedText}
              promptStyle={settings.promptStyle}
              customPrompts={settings.customPrompts}
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
              logs={logs}
              setLogs={setLogs}
              toggleAutostart={toggleAutostart}
            />
          </div>

        </div>
      </main>

      <button 
        className={`save-btn ${saveStatus === "saved" ? "saved-active" : ""}`} 
        onClick={saveSettings} 
        style={{ 
          position: 'fixed',
          bottom: '30px',
          right: '30px',
          zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          opacity: (activeTab === 'settings' && (isDirty || saveStatus === "saved")) ? 1 : 0,
          pointerEvents: (activeTab === 'settings' && (isDirty || saveStatus === "saved")) ? 'auto' : 'none',
          transform: (activeTab === 'settings' && (isDirty || saveStatus === "saved")) ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          backgroundColor: saveStatus === "saved" ? 'rgba(52, 211, 153, 0.2)' : undefined,
          borderColor: saveStatus === "saved" ? 'rgba(52, 211, 153, 0.4)' : undefined,
          color: saveStatus === "saved" ? '#34d399' : undefined
        }}
      >
        {saveStatus === "saved" ? (t('settings.config_saved') || "✅ 设置已保存") : (t('settings.save_config') || "保存配置")}
      </button>

    </div>
  );
}

export default App;
