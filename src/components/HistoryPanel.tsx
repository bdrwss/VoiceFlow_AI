import React, { useState } from 'react';
import { History, ShieldCheck, Trash2, Copy, RefreshCw, Sparkles, Check, Search, Download } from "lucide-react";
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
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
  const { showConfirm, showAlert } = useModal();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredHistory = history.filter(item => 
    item.rawText.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (item.refinedText && item.refinedText.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.appName && item.appName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const exportHistory = async () => {
    if (filteredHistory.length === 0) return;
    const content = filteredHistory.map(item => {
      return `### ${new Date(item.timestamp).toLocaleString()}\n` +
             `${item.appName ? `**场景**: \`${item.appName}\`\n` : ''}` +
             `**原始听写**:\n${item.rawText}\n\n` +
             `${item.refinedText && item.refinedText !== item.rawText ? `**AI 润色**:\n${item.refinedText}\n\n` : ''}` +
             `---\n`;
    }).join("\n");
    
    try {
      const filePath = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: `VoiceFlow_History_${new Date().toISOString().slice(0, 10)}.md`,
      });
      
      if (filePath) {
        await writeTextFile(filePath, content);
        await showAlert({ title: '导出成功', message: `历史记录已导出至:\n${filePath}` });
      }
    } catch (e) {
      console.error("Failed to save history:", e);
      await showAlert({ title: '导出失败', message: `无法导出历史记录:\n${e}` });
    }
  };

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
    <div className="history-panel">
      {history.length > 0 && (
        <div style={{ 
          position: 'sticky', 
          top: '-20px', 
          margin: '-20px -20px 20px -20px',
          zIndex: 10, 
          background: 'rgba(20, 20, 25, 0.85)', 
          backdropFilter: 'blur(10px)',
          padding: '20px 20px 15px 20px', 
          borderBottom: '1px solid rgba(255,255,255,0.05)' 
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
              <input 
                type="text" 
                placeholder={t('history.search_ph') || "搜索历史记录 (关键字/应用名称)..."}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '10px 12px 10px 36px', 
                  background: 'rgba(0,0,0,0.3)', 
                  border: '1px solid rgba(255,255,255,0.1)', 
                  borderRadius: '8px',
                  color: 'var(--text-main)',
                  fontSize: '0.9rem'
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button 
                className="clear-btn" 
                onClick={exportHistory}
                style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)', height: '34px', padding: '0 12px' }}
              >
                <Download size={14} /> 导出为 Markdown
              </button>
              <button 
                className="clear-btn" 
                onClick={async () => {
                  const confirmed = await showConfirm(t('history.confirm_clear') || "确定要清空所有听写与优化记录吗？此操作无法恢复。");
                  if (confirmed) clearHistory();
                }}
                style={{ height: '34px', padding: '0 12px' }}
              >
                <Trash2 size={14} /> {t('history.clear_all') || "清空全部"}
              </button>
            </div>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="empty-state">
          <History size={48} className="muted-icon" />
          <p>{t('history.empty') || "暂无历史记录，开始在桌面按快捷键说话吧"}</p>
        </div>
      ) : (
        <div className="history-list">
          {filteredHistory.length === 0 && searchTerm ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>未找到匹配的搜索结果。</div>
          ) : (
            filteredHistory.map((item) => (
              <div key={item.id} className="history-card">
              <div className="card-meta">
                <span className="card-time">{new Date(item.timestamp).toLocaleString()}</span>
                  {item.appName && (
                    <span className="card-tag" style={{ background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
                      来源: {item.appName}
                    </span>
                  )}
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
          )))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ 
          position: 'sticky', 
          bottom: '-20px', 
          margin: '0 -20px -20px -20px',
          zIndex: 10, 
          background: 'rgba(20, 20, 25, 0.85)', 
          backdropFilter: 'blur(10px)',
          padding: '12px 20px', 
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottomLeftRadius: '14px',
          borderBottomRightRadius: '14px'
        }}>
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
              {t('history.total_chars') || "累计生成字数"}: <span style={{ color: '#34d399', fontWeight: 600 }}>{totalChars}</span> {t('history.chars') || "字"}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
              {t('history.saved_time') || "预估节省时间"}: <span style={{ color: '#60a5fa', fontWeight: 600 }}>{timeSaved}</span> {t('history.minutes') || "分钟"}
            </div>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
            共 <span style={{ color: '#fff', fontWeight: 600 }}>{filteredHistory.length}</span> 条记录
          </div>
        </div>
      )}
    </div>
  );
};
