import React, { useState } from 'react';
import { History, ShieldCheck, Trash2, Copy, Trash, AlertTriangle } from "lucide-react";
import "./HistoryPanel.css";
import { HistoryItem } from '../hooks/useHistory';

interface HistoryPanelProps {
  history: HistoryItem[];
  deleteHistoryItem: (id: string) => void;
  clearHistory: () => void;
  copyToClipboard: (text: string, id: string) => void;
  copiedId: string | null;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  history,
  deleteHistoryItem,
  clearHistory,
  copyToClipboard,
  copiedId
}) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <div className="history-pane">
      <div className="history-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3>听写与优化记录</h3>
        {history.length > 0 && (
          <button 
            className="action-btn text-red-hover" 
            onClick={() => setShowClearConfirm(true)}
            style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)' }}
          >
            <Trash size={14} />
            <span>清空全部</span>
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
          <div className="dash-card" style={{ flex: 1, background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>累计生成字数</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#34d399' }}>{history.reduce((acc, item) => acc + (item.refinedText || item.rawText).length, 0)} <span style={{fontSize: '12px', fontWeight: 'normal', color: 'rgba(255,255,255,0.5)'}}>字</span></div>
          </div>
          <div className="dash-card" style={{ flex: 1, background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>预估节省时间</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#60a5fa' }}>{Math.round(history.reduce((acc, item) => acc + (item.refinedText || item.rawText).length, 0) / 80)} <span style={{fontSize: '12px', fontWeight: 'normal', color: 'rgba(255,255,255,0.5)'}}>分钟</span></div>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="empty-state">
          <History size={48} className="muted-icon" />
          <p>暂无历史记录，开始在桌面按快捷键说话吧</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <div key={item.id} className="history-card">
              <div className="card-meta">
                <span className="card-time">{new Date(item.timestamp).toLocaleString()}</span>
                <span className="card-tag">
                  {item.success ? "已润色" : "未润色"}
                </span>
              </div>

              <div className="card-content">
                <div className="card-raw">
                  <div className="label">ASR</div>
                  <p>{item.rawText}</p>
                </div>
                {item.refinedText && item.refinedText !== item.rawText && (
                  <div className="card-refined">
                    <div className="label" style={{ color: '#60a5fa' }}>AI优化</div>
                    <p style={{ color: '#fff' }}>{item.refinedText}</p>
                  </div>
                )}
                {!item.refinedText && (
                  <div className="card-refined" style={{ opacity: 0.7, background: 'rgba(255,255,255,0.02)' }}>
                    <div className="label" style={{ color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldCheck size={12} />
                      <span>本地纯离线保护模式</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="card-actions">
                <button className="action-btn" onClick={() => copyToClipboard(item.refinedText || item.rawText, item.id)}>
                  <Copy size={14} />
                  <span>{copiedId === item.id ? "已复制" : "复制结果"}</span>
                </button>
                <button className="action-btn text-red-hover" onClick={() => deleteHistoryItem(item.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom Confirm Modal for Clearing History */}
      {showClearConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <AlertTriangle color="#f59e0b" size={24} />
              <h4>清空历史记录</h4>
            </div>
            <p>确定要清空所有听写与优化记录吗？此操作无法恢复。</p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowClearConfirm(false)}>取消</button>
              <button className="btn-danger" onClick={() => { clearHistory(); setShowClearConfirm(false); }}>确定清空</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
