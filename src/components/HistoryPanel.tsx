import React, { useState } from 'react';
import { History, ShieldCheck, Trash2, Copy, RefreshCw, Sparkles, Check } from "lucide-react";
import { useTranslation } from 'react-i18next';
import "./HistoryPanel.css";
import { HistoryItem } from '../hooks/useHistory';
import { useModal } from './ModalContext';

interface HistoryPanelProps {
  history: HistoryItem[];
  deleteHistoryItem: (id: string) => void;
  clearHistory: () => void;
  copyToClipboard: (id: string, text: string) => void;
  retryRefine?: (item: HistoryItem) => Promise<void>;
  copiedId: string | null;
  hasApiKey: boolean;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  history,
  deleteHistoryItem,
  clearHistory,
  copyToClipboard,
  retryRefine,
  copiedId,
  hasApiKey
}) => {
  const { t } = useTranslation();
  const { showConfirm } = useModal();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const totalChars = history.reduce((acc, item) => acc + (item.refinedText || item.rawText).length, 0);
  const timeSaved = Math.round(totalChars / 40);

  const handleRetry = async (item: HistoryItem) => {
    if (!retryRefine) return;
    setRetryingId(item.id);
    try {
      await retryRefine(item);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="history-pane">
      {history.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="stat-card">
              <div className="stat-label">{t('history.total_chars') || "累计生成字数"}</div>
              <div className="stat-value text-green">
                {totalChars} <span className="stat-unit">{t('history.chars') || "字"}</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('history.saved_time') || "预估节省时间"}</div>
              <div className="stat-value text-blue">
                {timeSaved} <span className="stat-unit">{t('history.minutes') || "分钟"}</span>
              </div>
            </div>
          </div>
          <button 
            className="clear-btn" 
            onClick={async () => {
              const confirmed = await showConfirm(t('history.confirm_clear') || "确定要清空所有听写与优化记录吗？此操作无法恢复。");
              if (confirmed) clearHistory();
            }}
          >
            <Trash2 size={14} /> {t('history.clear_all') || "清空全部"}
          </button>
        </div>
      )}

      {history.length === 0 ? (
        <div className="empty-state">
          <History size={48} className="muted-icon" />
          <p>{t('history.empty') || "暂无历史记录，开始在桌面按快捷键说话吧"}</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <div key={item.id} className="history-card">
              <div className="card-meta">
                <span className="card-time">{new Date(item.timestamp).toLocaleString()}</span>
                <span className="card-tag">
                  {item.success ? (t('history.refined') || "已润色") : (t('history.raw') || "未润色")}
                </span>
              </div>

              <div className="card-content">
                <div className="card-raw">
                  <div className="label">ASR</div>
                  <p>{item.rawText}</p>
                </div>
                {item.refinedText && item.refinedText !== item.rawText && (
                  <div className="card-refined">
                    <div className="label" style={{ color: '#60a5fa' }}>{t('history.ai_optimized') || "AI优化"}</div>
                    <p style={{ color: '#fff' }}>{item.refinedText}</p>
                  </div>
                )}
                {!item.refinedText && (
                  <div className="card-refined" style={{ opacity: 0.7, background: 'rgba(255,255,255,0.02)' }}>
                    <div className="label" style={{ color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldCheck size={12} />
                      <span>{t('history.offline_mode') || "本地纯离线保护模式"}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="card-actions">
                {hasApiKey && retryRefine && (
                  <button 
                    className="action-btn icon-only" 
                    onClick={() => handleRetry(item)}
                    disabled={retryingId === item.id}
                    title={t('history.re_refine') || "重新润色"}
                  >
                    {retryingId === item.id ? (
                      <RefreshCw size={14} className="spin-icon text-blue" />
                    ) : (
                      <Sparkles size={14} className="text-blue" />
                    )}
                  </button>
                )}
                <button 
                  className="action-btn icon-only" 
                  onClick={() => copyToClipboard(item.id, item.refinedText || item.rawText)}
                  title={copiedId === item.id ? (t('history.copied') || "已复制") : (t('history.copy') || "复制结果")}
                >
                  {copiedId === item.id ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                </button>
                <button 
                  className="action-btn icon-only text-red-hover" 
                  onClick={() => deleteHistoryItem(item.id)}
                  title={t('history.delete') || "删除"}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
