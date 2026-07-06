import React, { useState, useEffect, useRef } from 'react';
import { Settings } from '../hooks/useSettings';
import "./SettingsPanel.css";
import { Search, ChevronUp, ChevronDown, Download } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useModal } from './ModalContext';
import { LLM_PROVIDERS } from '../utils/llm-providers';
import { testConnection } from '../utils/llm';
interface SettingsPanelProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  logs: string[];
  setLogs: React.Dispatch<React.SetStateAction<string[]>>;
  autostartEnabled: boolean;
  toggleAutostart: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  updateSetting,
  logs,
  setLogs,
  autostartEnabled,
  toggleAutostart
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const { showAlert, showConfirm } = useModal();
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState("v1.0.5");
  const [testStatus, setTestStatus] = useState<{status: 'idle'|'testing'|'success'|'error', msg: string}>({status: 'idle', msg: ''});
  const [showAdvancedLlm, setShowAdvancedLlm] = useState(false);

  useEffect(() => {
    import('@tauri-apps/api/app').then(({ getVersion }) => {
      getVersion().then(v => setAppVersion('v' + v)).catch(console.error);
    });
  }, []);

  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [downloadStep, setDownloadStep] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);

  const forceRedownloadSenseVoice = async () => {
    if (isDownloadingModel) return;
    setIsDownloadingModel(true);
    setDownloadStep("准备重新下载 SenseVoice 模型...");
    setDownloadProgress(0);
    
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen("download-progress", (event: any) => {
        const { step, progress } = event.payload;
        setDownloadStep(step);
        setDownloadProgress(Math.round(progress * 100));
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
        invoke("force_redownload_sensevoice").catch((err) => {
          unlistenSuccess();
          unlistenError();
          reject(err);
        });
      });
      setDownloadStep("下载完成，已准备就绪！");
      setDownloadProgress(100);
      setTimeout(() => {
        setIsDownloadingModel(false);
      }, 3000);
    } catch (e: any) {
      console.error(e);
      setDownloadStep(`下载失败: ${e.message || e}`);
      setIsDownloadingModel(false);
    } finally {
      if (unlisten) {
        unlisten();
      }
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Clean up previous highlights
    const prevMatches = containerRef.current.querySelectorAll('.search-highlight, .active-highlight');
    prevMatches.forEach(el => {
      el.classList.remove('search-highlight', 'active-highlight');
    });

    if (!searchTerm.trim()) {
      setMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const allItems = Array.from(containerRef.current.querySelectorAll('.input-item, .settings-group h3')) as HTMLElement[];
    const termLower = searchTerm.toLowerCase();
    
    const newMatches = allItems.filter(item => {
      const inputs = Array.from(item.querySelectorAll('input, textarea')) as (HTMLInputElement | HTMLTextAreaElement)[];
      const inputValues = inputs.map(inp => inp.value + ' ' + inp.placeholder).join(' ');

      const visibleText = (item.textContent + ' ' + inputValues).toLowerCase();
      return visibleText.includes(termLower);
    });

    newMatches.forEach(el => el.classList.add('search-highlight'));

    setMatches(newMatches);
    if (newMatches.length > 0) {
      setCurrentMatchIndex(0);
      newMatches[0].classList.add('active-highlight');
      newMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [searchTerm]);

  useEffect(() => {
    if (matches.length === 0 || currentMatchIndex === -1) return;
    matches.forEach((el, index) => {
      if (index === currentMatchIndex) {
        el.classList.add('active-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        el.classList.remove('active-highlight');
      }
    });
  }, [currentMatchIndex, matches]);

  const handlePrev = () => {
    if (matches.length === 0) return;
    setCurrentMatchIndex(prev => (prev > 0 ? prev - 1 : matches.length - 1));
  };

  const handleNext = () => {
    if (matches.length === 0) return;
    setCurrentMatchIndex(prev => (prev < matches.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className="settings-pane" ref={containerRef}>
      <div className="settings-search-bar">
        <Search size={16} className="search-icon" />
        <input 
          type="text" 
          placeholder="搜索设置项..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="search-nav">
            <span className="search-count">{currentMatchIndex + 1} / {matches.length}</span>
            <button onClick={handlePrev} className="search-nav-btn"><ChevronUp size={16}/></button>
            <button onClick={handleNext} className="search-nav-btn"><ChevronDown size={16}/></button>
          </div>
        )}
        {searchTerm && matches.length === 0 && (
          <span className="search-count no-match">无匹配项</span>
        )}
      </div>


      <div className="settings-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ marginBottom: 0 }}>大语言模型接口 (LLM Config)</h3>
          <div 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            title="关闭后，本软件将作为纯语音听写工具，直接输出识别的原文，不再调用大模型进行润色。"
            onClick={() => updateSetting("enableOptimization", !settings.enableOptimization)}
          >
            <div 
              className={`toggle-switch ${settings.enableOptimization ? 'active' : ''}`}
              style={{ margin: 0 }}
            >
              <div className="toggle-thumb"></div>
            </div>
          </div>
        </div>

        {settings.enableOptimization && (
          <>
            <div className="input-item">
          <label>服务商 (Provider)</label>
          <select 
            value={settings.llmProvider} 
            onChange={(e) => {
              const providerId = e.target.value;
              updateSetting("llmProvider", providerId);
              const provider = LLM_PROVIDERS.find(p => p.id === providerId);
              if (provider && provider.id !== "custom") {
                updateSetting("baseUrl", provider.baseUrl);
                if (provider.models.length > 0) {
                  updateSetting("modelName", provider.models[0]);
                }
              }
            }}
          >
            {LLM_PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {LLM_PROVIDERS.find(p => p.id === settings.llmProvider)?.description && (
            <p className="input-tip">{LLM_PROVIDERS.find(p => p.id === settings.llmProvider)?.description}</p>
          )}
        </div>

        {settings.llmProvider !== "ollama" && (
          <div className="input-item">
            <label>API Key</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="password" 
                value={settings.apiKey} 
                onChange={(e) => updateSetting("apiKey", e.target.value)} 
                placeholder="填写您的 API 密钥"
                style={{ flex: 1 }}
              />
              <button 
                className="btn secondary" 
                onClick={async () => {
                  setTestStatus({ status: 'testing', msg: '测试中...' });
                  const res = await testConnection({ apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.modelName });
                  if (res.ok) {
                    setTestStatus({ status: 'success', msg: res.message });
                  } else {
                    setTestStatus({ status: 'error', msg: res.message });
                  }
                }}
                disabled={testStatus.status === 'testing' || !settings.apiKey}
              >
                {testStatus.status === 'testing' ? '测试中...' : '测试连接'}
              </button>
            </div>
            {testStatus.status !== 'idle' && (
              <p className={`input-tip ${testStatus.status === 'error' ? 'error-text' : 'success-text'}`} style={{ color: testStatus.status === 'error' ? '#ef4444' : '#10b981' }}>
                {testStatus.msg}
              </p>
            )}
          </div>
        )}

        <div className="input-item">
          <label>模型名称 (Model Name)</label>
          {(() => {
            const currentProvider = LLM_PROVIDERS.find(p => p.id === settings.llmProvider);
            if (currentProvider && currentProvider.models.length > 0) {
              return (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select 
                    value={currentProvider.models.includes(settings.modelName) ? settings.modelName : "custom_input"} 
                    onChange={(e) => {
                      if (e.target.value === "custom_input") {
                        updateSetting("modelName", "");
                      } else {
                        updateSetting("modelName", e.target.value);
                      }
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    {currentProvider.models.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="custom_input">自定义输入...</option>
                  </select>
                  {(!currentProvider.models.includes(settings.modelName)) && (
                    <input 
                      type="text" 
                      value={settings.modelName} 
                      onChange={(e) => updateSetting("modelName", e.target.value)} 
                      placeholder="手动输入模型名"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  )}
                </div>
              );
            }
            return (
              <input 
                type="text" 
                value={settings.modelName} 
                onChange={(e) => updateSetting("modelName", e.target.value)} 
                placeholder="例如: deepseek-chat"
              />
            );
          })()}
        </div>

        <div className="input-item">
          <button 
            className="btn ghost" 
            onClick={() => setShowAdvancedLlm(!showAdvancedLlm)}
            style={{ padding: '4px 0', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            {showAdvancedLlm ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
            高级选项 (Advanced)
          </button>
        </div>

        {showAdvancedLlm && (
          <div style={{ paddingLeft: '12px', borderLeft: '2px solid var(--border-color)', marginTop: '8px', marginLeft: '4px' }}>
            <div className="input-item">
              <label>接口代理地址 (Base URL)</label>
              <input 
                type="text" 
                value={settings.baseUrl} 
                onChange={(e) => updateSetting("baseUrl", e.target.value)} 
                placeholder="默认会根据服务商自动填充"
              />
            </div>
            
            <div className="input-item">
              <label>Temperature (生成随机性, 默认 0.3)</label>
              <input 
                type="number" 
                step="0.1"
                min="0"
                max="2"
                value={settings.temperature} 
                onChange={(e) => updateSetting("temperature", parseFloat(e.target.value))} 
              />
            </div>

            <div className="input-item">
              <label>Max Tokens (最大生成长度, 默认 1000)</label>
              <input 
                type="number" 
                step="100"
                value={settings.maxTokens} 
                onChange={(e) => updateSetting("maxTokens", parseInt(e.target.value, 10))} 
              />
            </div>
          </div>
        )}
          </>
        )}
      </div>

      <div className="settings-group">
        <h3>打字与上屏模式 (Typing & Input)</h3>
        
        <div className="input-item">
          <label>上屏模式</label>
          <select value={settings.typeMode} onChange={(e) => updateSetting("typeMode", e.target.value as "simulate" | "clipboard")}>
            <option value="simulate">自动上屏 (依赖模拟按键，推荐日常使用)</option>
            <option value="clipboard">纯剪贴板模式 (仅复制不按键，完美绕过高权限/游戏反作弊拦截)</option>
          </select>
          <p className="input-tip">如果遇到在某些高权限软件或游戏中文字无法打出，请切换至纯剪贴板模式。</p>
        </div>
      </div>

      <div className="settings-group">
        <h3>听写与优化偏好</h3>
        
        <div className="input-item">
          <label>专有词汇 / 热词 (Hot Words)</label>
          <input 
            type="text" 
            value={settings.hotWords} 
            onChange={(e) => updateSetting("hotWords", e.target.value)} 
            placeholder="例如：Tauri, Enigo, Vue, 降噪"
          />
          <p className="input-tip">使用逗号分隔，语音识别和大模型优化时会强制偏向这些专有词汇，大幅提升专业场景准确率。</p>
        </div>
        
        <div className="input-item">
          <label>AI 优化风格</label>
          <select value={settings.promptStyle} onChange={(e) => updateSetting("promptStyle", e.target.value)}>
            <option value="natural">自然听写润色（去口语化、加标点）</option>
            <option value="formal">商务正式书面（邮件、汇报公文）</option>
            <option value="concise">精练精简要点（提炼摘要）</option>
            <option value="academic">学术与技术文档强化</option>
          </select>
        </div>

        <div className="input-item">
          <label>语音识别语言</label>
          <select value={settings.asrLanguage} onChange={(e) => updateSetting("asrLanguage", e.target.value)}>
            <option value="chinese">中文 (Chinese)</option>
            <option value="english">英文 (English)</option>
            <option value="japanese">日文 (Japanese)</option>
            <option value="korean">韩文 (Korean)</option>
            <option value="french">法文 (French)</option>
            <option value="german">德文 (German)</option>
            <option value="spanish">西班牙文 (Spanish)</option>
            <option value="auto">自动检测 (Auto-detect)</option>
          </select>
          <p className="input-tip">指定 Whisper 识别的目标语言，推荐手动选择以提高准确率。</p>
        </div>

        <div className="input-item">
          <label>语音识别引擎 (ASR Engine)</label>
          <select value={settings.asrEngine} onChange={(e) => updateSetting("asrEngine", e.target.value as "local" | "api")}>
            <option value="local">本地离线模型 (免费/保护隐私)</option>
            <option value="api">云端 API 模型 (极速/支持流式上屏)</option>
          </select>
        </div>

        {settings.asrEngine === 'api' && (
          <div className="input-item" style={{ background: 'rgba(52, 211, 153, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
            <label style={{ color: '#34d399' }}>API 语音模型配置 (兼容 OpenAI 格式)</label>
            <input 
              type="text" 
              value={settings.asrApiUrl} 
              onChange={(e) => updateSetting("asrApiUrl", e.target.value)} 
              placeholder="API URL (例如: https://api.groq.com/openai/v1/audio/transcriptions)"
              style={{ marginBottom: '8px' }}
            />
            <input 
              type="password" 
              value={settings.asrApiKey} 
              onChange={(e) => updateSetting("asrApiKey", e.target.value)} 
              placeholder="API Key"
              style={{ marginBottom: '8px' }}
            />
            <input 
              type="text" 
              value={settings.asrApiModel} 
              onChange={(e) => updateSetting("asrApiModel", e.target.value)} 
              placeholder="模型名称 (例如: whisper-large-v3)"
            />
            <p className="input-tip">使用快速的云端 API（如 Groq）可实现边说话边出字的流式体验。</p>
          </div>
        )}

        {settings.asrEngine === 'local' && (
          <>
            <div className="input-item">
              <label>本地识别模型 (Offline ASR Model)</label>
              <div className="input-tip" style={{ marginTop: '8px', lineHeight: '1.5', fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
                <span style={{ fontWeight: 'bold', color: '#34d399' }}>当前独占引擎：SenseVoice Small (~250MB)</span>
                <p style={{ margin: '6px 0 0 0', color: 'rgba(255,255,255,0.35)' }}>极速多语言模型，基于底层引擎原生推理。任意配置均可秒级响应。</p>
                <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'rgba(255,255,255,0.8)' }}>SenseVoice 模型状态</span>
                    <button 
                      onClick={forceRedownloadSenseVoice} 
                      disabled={isDownloadingModel}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)', color: '#34d399',
                        padding: '4px 10px', borderRadius: '4px', cursor: isDownloadingModel ? 'not-allowed' : 'pointer', fontSize: '11px'
                      }}
                    >
                      <Download size={12} />
                      {isDownloadingModel ? '正在下载...' : '强制重新下载'}
                    </button>
                  </div>
                  {isDownloadingModel && (
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#9ca3af', marginBottom: '4px' }}>
                        <span>{downloadStep}</span>
                        <span>{downloadProgress}%</span>
                      </div>
                      <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${downloadProgress}%`, background: '#34d399', transition: 'width 0.3s' }}></div>
                      </div>
                    </div>
                  )}
                  {!isDownloadingModel && downloadStep === "下载完成，已准备就绪！" && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#34d399' }}>✅ 模型已成功更新</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="input-item">
          <label>触发快捷键</label>
          <select value={settings.listenKey} onChange={(e) => updateSetting("listenKey", e.target.value)}>
            <option value="RControl">右 Ctrl 键 (Right Control)</option>
            <option value="LControl">左 Ctrl 键 (Left Control)</option>
            <option value="LAlt">左 Alt 键 (Left Alt / Option)</option>
            <option value="RAlt">右 Alt 键 (Right Alt)</option>
            <option value="CapsLock">大写锁定键 (CapsLock)</option>
          </select>
          <p className="input-tip">全局监听按键按下即开始录音，松开即停止识别并自动打字。</p>
        </div>

        <div className="input-item">
          <label>全局防误触黑名单 (Blacklist)</label>
          <textarea 
            value={settings.blacklistStr} 
            onChange={(e) => updateSetting("blacklistStr", e.target.value)} 
            placeholder="例如: csgo.exe, LOL.exe (用逗号或换行分隔)"
            style={{ width: '100%', height: '60px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', padding: '10px 14px', fontSize: '0.95rem', resize: 'vertical' }}
          />
          <p className="input-tip">当您的焦点在这些程序（如游戏）上时，快捷键将被彻底禁用，保护隐私并防止游戏卡顿。</p>
        </div>

        <div className="input-item" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
          <div>
            <label style={{ marginBottom: 0 }}>开机自启</label>
            <p className="input-tip" style={{ margin: '4px 0 0 0' }}>在系统登录时自动在后台静默运行</p>
          </div>
          <div 
            onClick={toggleAutostart}
            className={`toggle-switch ${autostartEnabled ? 'active' : ''}`}
            role="switch"
            aria-checked={autostartEnabled}
            tabIndex={0}
          >
            <div className="toggle-thumb" />
          </div>
        </div>
      </div>
      
      <div className="settings-group">
        <h3>开发调试日志</h3>
        <textarea 
          readOnly 
          value={logs.join('\n')} 
          style={{ 
            width: '100%', 
            height: '120px', 
            background: 'rgba(0,0,0,0.25)', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '8px', 
            color: '#34d399', 
            fontFamily: 'monospace', 
            fontSize: '11px',
            padding: '8px',
            resize: 'vertical'
          }}
          placeholder="暂无调试日志"
        />
        <button 
          onClick={() => setLogs([])}
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#9ca3af',
            padding: '4px 10px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.8rem',
            alignSelf: 'flex-start',
            marginTop: '6px'
          }}
        >清空日志</button>
      </div>



      <div className="settings-group" style={{ marginTop: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>关于与更新 (About & Updates)</h3>
          <button 
            onClick={async (e) => {
              const btn = e.currentTarget;
              const originalText = btn.innerText;
              btn.innerText = "正在检查...";
              btn.disabled = true;
              try {
                const { check } = await import('@tauri-apps/plugin-updater');
                const update = await check();
                
                if (update) {
                  const shouldUpdate = await showConfirm(`发现新版本: ${update.version}\n\n更新日志:\n${update.body}\n\n是否立即尝试自动更新？（若自动更新失败将提供备用下载链接）`);
                  if (shouldUpdate) {
                    btn.innerText = "正在下载并安装...";
                    let downloaded = 0;
                    let contentLength = 0;
                    await update.downloadAndInstall((event) => {
                      switch (event.event) {
                        case 'Started':
                          contentLength = event.data.contentLength || 0;
                          btn.innerText = `下载中... (0%)`;
                          break;
                        case 'Progress':
                          downloaded += event.data.chunkLength;
                          if (contentLength > 0) {
                            const percent = Math.round((downloaded / contentLength) * 100);
                            btn.innerText = `下载中... (${percent}%)`;
                          } else {
                            btn.innerText = `下载中... (${(downloaded / 1024 / 1024).toFixed(1)}MB)`;
                          }
                          break;
                        case 'Finished':
                          btn.innerText = "下载完成，准备重启";
                          break;
                      }
                    });
                    const { relaunch } = await import('@tauri-apps/plugin-process');
                    await relaunch();
                  }
                } else {
                  await showAlert("当前已经是最新版本！");
                }
              } catch (err) {
                try {
                  const fallbackUi = (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                      <p>自动更新失败，可能是由于网络原因导致无法连接 GitHub 下载更新包。</p>
                      <p style={{ fontSize: '0.85em', color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '6px', borderRadius: '4px', wordBreak: 'break-all' }}>错误信息: {String(err)}</p>
                    </div>
                  );
                  await showAlert({ title: "自动更新失败", message: fallbackUi });
                } catch (fallbackErr) {
                  await showAlert("检查更新失败，网络异常。\n" + err);
                }
              } finally {
                btn.innerText = originalText;
                btn.disabled = false;
              }
            }}
            style={{
              background: 'rgba(52, 211, 153, 0.1)',
              border: '1px solid rgba(52, 211, 153, 0.3)',
              color: '#34d399',
              padding: '6px 14px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              transition: 'all 0.2s',
              fontWeight: 'bold',
              whiteSpace: 'nowrap'
            }}
          >
            检查更新
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ textAlign: 'left' }}>
              <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '1.1rem', fontWeight: 'bold', margin: 0, marginBottom: '4px' }}>VoiceFlow AI</p>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', margin: 0 }}>当前版本: {appVersion}</p>
            </div>
            <div style={{ padding: '4px 10px', background: 'rgba(255, 255, 255, 0.05)', color: 'rgba(255, 255, 255, 0.6)', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.1)' }}>
              稳定版
            </div>
          </div>
          
          <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
            <p style={{ fontSize: '0.9rem', color: '#f3f4f6', marginBottom: '8px', fontWeight: 'bold' }}>📦 备用下载通道 (手动更新)</p>
            <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '12px' }}>如果您由于网络限制无法通过“检查更新”按钮完成自动更新，您可以随时点击下方链接获取最新安装包：</p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button 
                onClick={async () => { const { openUrl } = await import('@tauri-apps/plugin-opener'); openUrl('https://pan.baidu.com/s/1_F4xAr_5XHxnRxtHKdNO1w?pwd=hzdp'); }}
                style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                百度网盘 (提取码: hzdp)
              </button>
              <button 
                onClick={async () => { const { openUrl } = await import('@tauri-apps/plugin-opener'); openUrl('https://github.com/bdrwss/VoiceFlow_AI/releases'); }}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#d1d5db', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                GitHub 发布页
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
