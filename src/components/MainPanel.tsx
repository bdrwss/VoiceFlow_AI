import React from 'react';
import { RefreshCw, Sparkles, Mic, Check, AlertTriangle } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';

interface MainPanelProps {
  status: string;
  modelProgress: number;
  downloadStep?: string;
  listenKey: string;
  errorMessage: string;
  asrEngine: string;
  setStatus: (status: any) => void;
  setErrorMessage: (msg: string) => void;
  rawText: string;
  refinedText: string;
  promptStyle?: string;
  customPrompts?: Array<{ id: string, name: string, prompt: string }>;
  updateSetting?: any;
  retry?: () => void;
}

export const MainPanel: React.FC<MainPanelProps> = ({
  status,
  modelProgress,
  downloadStep,
  listenKey,
  errorMessage,
  asrEngine,
  setStatus,
  setErrorMessage,
  rawText,
  refinedText,
  promptStyle,
  customPrompts,
  updateSetting,
  retry
}) => {
  const { t } = useTranslation();
  return (
    <div className="main-pane">
      {status === "initializing" && (
        <div className="loading-container">
          <RefreshCw className="spin-icon" size={48} />
          <h3>{t('main.loading_model') || "正在加载本地识别模型..."}</h3>
          <p>{t('main.loading_desc') || "首次运行会自动下载当前模型。后续启动将从本地加载至内存，需耗费数秒时间（约 250MB）"}</p>
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
          {/* 大窗口下的极简就绪提示 banner */}
          <div className="status-text-banner" style={{ opacity: status === 'idle' || status === 'success' || status === 'error' ? 1 : 0.5, transition: 'opacity 0.3s' }}>
            <h2>{t('main.ready_title') || "智能听写助手已在后台就绪"}</h2>
            <p><Trans i18nKey="main.ready_desc" values={{ key: listenKey }} components={{ 1: <kbd /> }}>请在任意地方，按住键盘右侧 <kbd>{listenKey}</kbd> 键说话即可</Trans></p>
            
            {/* 提示词风格快捷切换 */}
            {updateSetting && promptStyle && customPrompts && customPrompts.length > 0 && (
              <div style={{ marginTop: '24px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                {customPrompts.slice(0, 4).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => updateSetting("promptStyle", p.id)}
                    style={{
                      padding: '6px 16px',
                      borderRadius: '20px',
                      border: `1px solid ${promptStyle === p.id ? '#60a5fa' : 'rgba(255,255,255,0.1)'}`,
                      background: promptStyle === p.id ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.05)',
                      color: promptStyle === p.id ? '#60a5fa' : 'rgba(255,255,255,0.7)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {p.name.slice(0, 4)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 错误提示 banner */}
          {status === "error" && (
            <div className="error-banner">
              <h2><AlertTriangle size={18} /> {t('main.error_title') || "出现了一点问题"}</h2>
              <p>{errorMessage}</p>
              <div className="error-actions">
                {errorMessage.includes("识别引擎初始化失败") && asrEngine === "api" && (
                  <button 
                    className="btn-error-action" 
                    onClick={() => { setStatus("idle"); setErrorMessage(""); }}
                  >
                    {t('main.ignore_api') || "忽略并使用 API"}
                  </button>
                )}
                {retry && (
                  <button 
                    className="btn-error-action" 
                    onClick={() => { setErrorMessage(""); retry(); }}
                  >
                    <RefreshCw size={14} /> {t('main.retry_download') || "重试下载"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 实时文本展示区 */}
          {/* 实时文本展示区 */}
          {(rawText || refinedText || status === 'recording' || status === 'transcribing' || status === 'rewriting') && (
            <div className="text-preview-card">
              <div className="preview-section">
                <div className="section-header">{t('main.asr_raw') || "ASR 识别原文"}</div>
                <div className="section-body">
                  {rawText || (
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {status === 'recording' ? (t('main.listening') || '正在聆听...') : (status === 'transcribing' ? (t('main.status.transcribing') || '正在识别...') : (t('main.waiting') || '等待文本...'))}
                    </span>
                  )}
                </div>
              </div>
              
              <div className="preview-section refined">
                <div className="section-header">
                  <Sparkles size={14} className="text-blue" />
                  <span>{t('main.ai_refined') || "AI 优化文本"}</span>
                </div>
                <div className="section-body">
                  {refinedText || (
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {status === 'rewriting' ? (t('main.status.rewriting') || 'AI 润色中...') : (t('main.waiting_optimize') || '等待优化...')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
