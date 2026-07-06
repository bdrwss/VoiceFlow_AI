const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '../src/App.tsx');
let content = fs.readFileSync(appPath, 'utf8');

// 1. Add imports
content = content.replace(
  'import { useSettings } from "./hooks/useSettings";',
  'import { useSettings } from "./hooks/useSettings";\nimport { useVoiceRecording } from "./hooks/useVoiceRecording";\nimport { useASR } from "./hooks/useASR";\nimport { useLLMRefine } from "./hooks/useLLMRefine";\nimport { useWindowManager } from "./hooks/useWindowManager";'
);

// 2. Remove window manager logic
content = content.replace(/\/\/ 同步状态至独立浮空胶囊窗口[\s\S]*?manageIndicatorWindow\(\);\n  \}, \[status, errorMessage, windowLabel, rawText, refinedText\]\);/g, '');
content = content.replace(/\/\/ 监听听写界面内容高度，自动调整窗口高度[\s\S]*?observer\.disconnect\(\);\n      \};\n    \}\n  \}, \[activeTab, rawText, refinedText, status, windowLabel\]\);/g, '');
content = content.replace(/\/\/ 监听实时音量并广播给独立小药丸窗口[\s\S]*?clearInterval\(intervalId\);\n      \}\n    \};\n  \}, \[status, windowLabel\]\);/g, '');
content = content.replace(/\/\/ 监听独立浮空小药丸发过来的取消\/强制提交事件[\s\S]*?unlisten\.then\(\(fn\) => fn\(\)\);\n      \};\n    \}\n  \}, \[windowLabel\]\);/g, '');

// 3. Insert hook instantiations and Orchestrator
const hookInjection = `
  const { startTranscribe, compensatePunctuation } = useASR();
  const { clearPlaceholder, typeText, resetTypedLength, performRefine } = useLLMRefine();
  
  const { isRecording, startRecording: startMic, stopRecording: stopMic, getAnalyser } = useVoiceRecording({
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
      if (stopAndProcessRef.current) stopAndProcessRef.current();
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
`;

content = content.replace('const { history, addHistoryItem, updateHistoryItem, deleteHistoryItem, clearHistory, copyToClipboard, copiedId } = useHistory();', 'const { history, addHistoryItem, updateHistoryItem, deleteHistoryItem, clearHistory, copyToClipboard, copiedId } = useHistory();\n' + hookInjection);

// 4. Update startRecording
const newStartRecording = `
  const startRecording = async () => {
    console.log("进入 startRecording...");
    try {
      isRecordingRef.current = true;
      setStatus("recording");
      setRawText("");
      setRefinedText("");
      setErrorMessage("");
      resetTypedLength();
      isChunkProcessingRef.current = false;
      focusLostRef.current = false;
      initialWindowRef.current = null;
      try {
        const winInfo: any = await invoke("get_active_window_info_cmd");
        initialWindowRef.current = { app_name: winInfo.app_name, window_title: winInfo.window_title };
      } catch (e) {
        console.error("无法获取初始焦点窗口信息", e);
      }
      
      await startMic();
      console.log("麦克风启动成功");
    } catch (err: any) {
      console.error("麦克风启动抛出异常:", err);
      isRecordingRef.current = false;
      let friendlyError = "无法启动麦克风：" + err.message;
      setErrorMessage(friendlyError);
      setStatus("error");
    }
  };
`;
content = content.replace(/const startRecording = async \(\) => \{[\s\S]*?\/\/ 取消当前录音/g, newStartRecording.trim() + '\n\n  // 取消当前录音');

// 5. Update cancelRecording
const newCancelRecording = `
  const cancelRecording = async () => {
    if (isRecordingRef.current) {
      stopMic();
      isRecordingRef.current = false;
      await clearPlaceholder(settings.typeMode !== "clipboard" && !focusLostRef.current);
      setStatus("idle");
    }
  };
`;
content = content.replace(/const cancelRecording = async \(\) => \{[\s\S]*?\/\/ 强制立即提交识别/g, newCancelRecording.trim() + '\n\n  // 强制立即提交识别');

// 6. Update stopAndProcess
const newStopAndProcess = `
  const stopAndProcess = async () => {
    console.log("进入 stopAndProcess...");
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
      
      const finalText = compensatePunctuation(text, !!settings.apiKey.trim());
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

      if (!settings.apiKey.trim() || !settings.enableOptimization) {
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: finalText, style: settings.promptStyle, success: false });
        setStatus("success");
        setTimeout(() => setStatus("idle"), 1500);
        return;
      }

      setStatus("rewriting");
      try {
        const refined = await performRefine(finalText, {
          apiKey: settings.apiKey, 
          baseUrl: settings.baseUrl, 
          model: settings.modelName, 
          promptStyle: settings.promptStyle, 
          appName: activeAppRef.current,
          hotWords: settings.hotWords,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens
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
        
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: refined, style: settings.promptStyle, success: true });
        setStatus("success");
        setTimeout(() => setStatus("idle"), 1500);
      } catch (err) {
        console.error(err);
        addHistoryItem({ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), rawText: finalText, refinedText: finalText, style: settings.promptStyle, success: false });
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
`;
content = content.replace(/const stopAndProcess = async \(\) => \{[\s\S]*?const retryRefine = async/g, newStopAndProcess.trim() + '\n\n  const retryRefine = async');

fs.writeFileSync(appPath, content, 'utf8');
console.log('App.tsx refactored successfully.');
