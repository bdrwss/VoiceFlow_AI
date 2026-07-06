import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cpu, Cloud, Download, Check, AlertTriangle, ArrowLeft } from "lucide-react";
import "./SetupWizard.css";

interface SetupWizardProps {
  onComplete: (engine: "local" | "api", apiConfig?: { url: string; key: string; model: string }) => void;
}

type WizardStep = "choose" | "local-download" | "api-config";

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>("choose");

  // --- Local model download state ---
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStep, setDownloadStep] = useState("");
  const [downloadDone, setDownloadDone] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  // --- API config state ---
  const [apiUrl, setApiUrl] = useState("https://api.groq.com/openai/v1/audio/transcriptions");
  const [apiKey, setApiKey] = useState("");
  const [apiModel, setApiModel] = useState("whisper-large-v3");

  // Start local model download
  useEffect(() => {
    if (step !== "local-download") return;

    let cancelled = false;

    async function download() {
      try {
        // Dummy IPC to warm up Tauri protocol
        try { await invoke("check_sensevoice_ready"); } catch { /* ignore */ }

        const isReady: boolean = await invoke("check_sensevoice_ready");
        if (isReady) {
          if (!cancelled) { setDownloadDone(true); setDownloadProgress(100); setDownloadStep("模型已就绪"); }
          return;
        }

        const unlisten = await listen("download-progress", (event: any) => {
          if (cancelled) return;
          const { step: s, progress } = event.payload;
          setDownloadProgress(Math.round(progress * 100));
          setDownloadStep(s);
        });

        await new Promise<void>(async (resolve, reject) => {
          const unlistenOk = await listen("download-success", () => { unlistenOk(); unlistenErr(); resolve(); });
          const unlistenErr = await listen("download-error", (e: any) => { unlistenOk(); unlistenErr(); reject(new Error(e.payload)); });
          invoke("download_sensevoice").catch((err) => { unlistenOk(); unlistenErr(); reject(err); });
        });

        unlisten();
        if (!cancelled) { setDownloadDone(true); setDownloadProgress(100); setDownloadStep("下载完成，模型已就绪！"); }
      } catch (err: any) {
        if (!cancelled) setDownloadError(err.message || String(err));
      }
    }

    download();
    return () => { cancelled = true; };
  }, [step]);

  // --- Choose screen ---
  if (step === "choose") {
    return (
      <div className="setup-wizard">
        <div className="setup-content">
          <div className="setup-logo">
            <div className="setup-logo-ring" />
            <span className="setup-logo-text">语音随写</span>
          </div>
          <h1 className="setup-title">欢迎使用 VoiceFlow AI</h1>
          <p className="setup-subtitle">请选择语音识别引擎，稍后可在设置中随时切换</p>

          <div className="setup-cards">
            <button className="setup-card" onClick={() => setStep("local-download")}>
              <div className="setup-card-icon local">
                <Cpu size={28} />
              </div>
              <h3>本地离线模型</h3>
              <p className="setup-card-desc">SenseVoice Small (~250MB)</p>
              <ul className="setup-card-features">
                <li>✅ 完全免费，无需 API Key</li>
                <li>✅ 数据不出本机，隐私安全</li>
                <li>✅ 无网络也能使用</li>
                <li>⚠️ 首次需下载模型文件</li>
              </ul>
              <span className="setup-card-badge">推荐新手</span>
            </button>

            <button className="setup-card" onClick={() => setStep("api-config")}>
              <div className="setup-card-icon cloud">
                <Cloud size={28} />
              </div>
              <h3>云端 API 模型</h3>
              <p className="setup-card-desc">兼容 OpenAI Whisper 格式</p>
              <ul className="setup-card-features">
                <li>✅ 识别速度极快</li>
                <li>✅ 支持流式上屏</li>
                <li>✅ 无需下载，即配即用</li>
                <li>⚠️ 需要 API Key 和网络</li>
              </ul>
              <span className="setup-card-badge alt">高级用户</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Local download screen ---
  if (step === "local-download") {
    return (
      <div className="setup-wizard">
        <div className="setup-content narrow">
          <button className="setup-back" onClick={() => { if (!downloadDone) setStep("choose"); }} disabled={downloadDone}>
            <ArrowLeft size={16} />
            返回
          </button>

          <div className="setup-download-icon">
            {downloadDone ? <Check size={40} /> : downloadError ? <AlertTriangle size={40} /> : <Download size={40} className="pulse-icon" />}
          </div>

          <h2 className="setup-title">
            {downloadDone ? "模型已就绪 🎉" : downloadError ? "下载失败" : "正在下载 SenseVoice 模型"}
          </h2>

          {!downloadDone && !downloadError && (
            <>
              <p className="setup-subtitle">{downloadStep || "正在准备..."}</p>
              <div className="setup-progress-bar">
                <div className="setup-progress-fill" style={{ width: `${downloadProgress}%` }} />
              </div>
              <span className="setup-progress-text">{downloadProgress}%</span>
            </>
          )}

          {downloadError && (
            <div className="setup-error">
              <p>{downloadError}</p>
              <button className="setup-btn secondary" onClick={() => { setDownloadError(""); setDownloadProgress(0); setDownloadStep(""); setStep("choose"); }}>
                返回重新选择
              </button>
            </div>
          )}

          {downloadDone && (
            <div className="setup-done-actions">
              <p className="setup-subtitle">本地离线识别引擎已准备就绪，可以开始使用了。</p>
              <button className="setup-btn primary" onClick={() => onComplete("local")}>
                开始使用
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- API config screen ---
  if (step === "api-config") {
    const canSave = apiUrl.trim() && apiKey.trim() && apiModel.trim();
    return (
      <div className="setup-wizard">
        <div className="setup-content narrow">
          <button className="setup-back" onClick={() => setStep("choose")}>
            <ArrowLeft size={16} />
            返回
          </button>

          <div className="setup-download-icon cloud-icon">
            <Cloud size={40} />
          </div>

          <h2 className="setup-title">配置云端语音识别 API</h2>
          <p className="setup-subtitle">填写兼容 OpenAI Whisper 格式的 API 信息</p>

          <div className="setup-form">
            <div className="setup-field">
              <label>API 地址 (URL)</label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://api.groq.com/openai/v1/audio/transcriptions"
              />
            </div>
            <div className="setup-field">
              <label>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="填写您的 API 密钥"
              />
            </div>
            <div className="setup-field">
              <label>模型名称 (Model)</label>
              <input
                type="text"
                value={apiModel}
                onChange={(e) => setApiModel(e.target.value)}
                placeholder="whisper-large-v3"
              />
            </div>
          </div>

          <button
            className="setup-btn primary"
            disabled={!canSave}
            onClick={() => onComplete("api", { url: apiUrl, key: apiKey, model: apiModel })}
          >
            保存配置
          </button>
        </div>
      </div>
    );
  }

  return null;
}
