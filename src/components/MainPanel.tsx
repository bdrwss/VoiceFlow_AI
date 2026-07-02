import React from 'react';
import { RefreshCw, Sparkles, Mic, Check, AlertTriangle } from 'lucide-react';

interface MainPanelProps {
  status: string;
  modelProgress: number;
  downloadStep?: string;
  whisperModel: string;
  listenKey: string;
  errorMessage: string;
  asrEngine: string;
  setStatus: (status: any) => void;
  setErrorMessage: (msg: string) => void;
  rawText: string;
  refinedText: string;
  retry?: () => void;
}

export const MainPanel: React.FC<MainPanelProps> = ({
  status,
  modelProgress,
  downloadStep,
  whisperModel,
  listenKey,
  errorMessage,
  asrEngine,
  setStatus,
  setErrorMessage,
  rawText,
  refinedText,
  retry
}) => {
  return (
    <div className="main-pane">
      {status === "initializing" && (
        <div className="loading-container">
          <RefreshCw className="spin-icon" size={48} />
          <h3>正在加载本地识别模型...</h3>
          <p>首次运行会自动下载当前模型。后续启动将从本地加载至内存，需耗费数秒时间（约 {whisperModel.includes('medium') ? '1.5GB' : whisperModel.includes('small') ? '460MB' : whisperModel.includes('base') ? '140MB' : '75MB'}）</p>
          {downloadStep && (
            <p style={{ fontSize: '0.85em', color: '#888', marginTop: '10px' }}>
              {downloadStep}
            </p>
          )}
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${modelProgress}%` }}></div>
          </div>
          <span className="progress-text">{modelProgress}%</span>
        </div>
      )}

      {status !== "initializing" && (
        <div className="workspace">
          
          {/* 中心状态球 */}
          <div className={`status-orb-container ${status}`}>
            <div className="orb-glow"></div>
            <div className="orb-inner">
              {status === 'idle' && <Mic size={36} color="#9ca3af" />}
              {status === 'recording' && <Mic size={42} className="pulse-red-icon" />}
              {status === 'transcribing' && <RefreshCw size={36} className="text-blue spin-icon" />}
              {status === 'rewriting' && <Sparkles size={36} className="text-green animate-bounce" />}
              {status === 'success' && <Check size={42} className="text-green" />}
              {status === 'error' && <Mic size={36} className="text-orange" />}
            </div>
          </div>

          {/* 大窗口下的极简就绪提示 banner */}
          {status === "idle" && (
            <div className="status-text-banner">
              <h2>智能听写助手已在后台就绪</h2>
              <p>请在任意地方，按住键盘右侧 <kbd>{listenKey}</kbd> 键说话即可</p>
            </div>
          )}

          {/* 错误提示 banner */}
          {status === "error" && (
            <div className="error-banner">
              <h2><AlertTriangle size={18} /> 出现了一点问题</h2>
              <p>{errorMessage}</p>
              <div className="error-actions">
                {errorMessage.includes("识别引擎初始化失败") && asrEngine === "api" && (
                  <button 
                    className="btn-error-action" 
                    onClick={() => { setStatus("idle"); setErrorMessage(""); }}
                  >
                    忽略并使用 API
                  </button>
                )}
                {retry && (
                  <button 
                    className="btn-error-action" 
                    onClick={() => { setErrorMessage(""); retry(); }}
                  >
                    <RefreshCw size={14} /> 重试下载
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 实时文本展示区 */}
          {(rawText || refinedText) && (
            <div className="text-preview-card">
              {rawText && (
                <div className="preview-section">
                  <div className="section-header">ASR 识别原文</div>
                  <div className="section-body">{rawText}</div>
                </div>
              )}
              {refinedText && (
                <div className="preview-section refined">
                  <div className="section-header">
                    <Sparkles size={14} className="text-blue" />
                    <span>AI 优化文本</span>
                  </div>
                  <div className="section-body">{refinedText}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
