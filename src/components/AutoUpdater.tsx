import React, { useEffect, useRef, useState } from 'react';
import { useModal } from './ModalContext';

export function AutoUpdater() {
  const { showAlert, showConfirm } = useModal();
  const checkedRef = useRef(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [progressText, setProgressText] = useState("准备下载...");

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    async function checkAuto() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update) {
          const shouldUpdate = await showConfirm(`发现新版本: ${update.version}\n\n更新日志:\n${update.body}\n\n是否立即尝试自动更新？（若自动更新失败将提供备用下载链接）`);
          if (shouldUpdate) {
            setIsUpdating(true);
            let downloaded = 0;
            let contentLength = 0;
            try {
              await update.downloadAndInstall((event) => {
                switch (event.event) {
                  case 'Started':
                    contentLength = event.data.contentLength || 0;
                    setProgressText(`下载中... (0%)`);
                    break;
                  case 'Progress':
                    downloaded += event.data.chunkLength;
                    if (contentLength > 0) {
                      const percent = Math.round((downloaded / contentLength) * 100);
                      setProgressText(`下载中... (${percent}%)`);
                    } else {
                      setProgressText(`下载中... (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
                    }
                    break;
                  case 'Finished':
                    setProgressText("下载完成，准备重启...");
                    break;
                }
              });
              const { relaunch } = await import('@tauri-apps/plugin-process');
              await relaunch();
            } catch (err) {
              setIsUpdating(false);
              const { openUrl } = await import('@tauri-apps/plugin-opener');
              const fallbackUi = (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                  <p>自动更新失败，可能是由于网络原因导致无法连接 GitHub 下载更新包。</p>
                  <p style={{ fontSize: '0.85em', color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '6px', borderRadius: '4px', wordBreak: 'break-all' }}>错误信息: {String(err)}</p>
                  <div style={{ marginTop: '10px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px' }}>
                    <p style={{ marginBottom: '10px', fontWeight: 'bold', color: '#f3f4f6' }}>📦 半自动备用更新通道</p>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <button 
                        onClick={() => openUrl('https://pan.baidu.com/s/1_F4xAr_5XHxnRxtHKdNO1w?pwd=hzdp')}
                        style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        百度网盘 (提取码: hzdp)
                      </button>
                      <button 
                        onClick={() => openUrl('https://github.com/bdrwss/VoiceFlow_AI/releases')}
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#d1d5db', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        GitHub 发布页
                      </button>
                    </div>
                  </div>
                </div>
              );
              await showAlert({ title: "自动更新失败", message: fallbackUi });
            }
          }
        }
      } catch (err) {
        console.error("Auto update background check failed:", err);
      }
    }

    // Delay the check slightly so it doesn't block initial rendering
    setTimeout(() => {
      checkAuto();
    }, 2000);
  }, [showAlert, showConfirm]);

  if (!isUpdating) return null;

  const match = progressText.match(/\((\d+)%\)/);
  const percentStr = match ? match[1] + '%' : '100%';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 99999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: 'white', backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: 'rgba(30, 30, 35, 0.9)', padding: '30px 40px', borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', minWidth: '300px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
      }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '1.2rem' }}>软件更新中</h3>
        <p style={{ margin: '0 0 20px 0', color: '#9ca3af' }}>{progressText}</p>
        <div style={{
          width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden'
        }}>
          <div style={{
            height: '100%', background: '#3b82f6', transition: 'width 0.2s ease-out',
            width: percentStr
          }} />
        </div>
      </div>
    </div>
  );
}
