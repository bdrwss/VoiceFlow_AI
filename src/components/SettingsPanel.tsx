import React, { useState, useEffect, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Settings } from '../hooks/useSettings';
import "./SettingsPanel.css";
import { Search, ChevronUp, ChevronDown, Download, Trash2, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useModal } from './ModalContext';
import { LLM_PROVIDERS } from '../utils/llm-providers';
import { testConnection, checkOllamaHealth, getOllamaModels } from '../utils/llm';

const formatShortcut = (e: React.KeyboardEvent | KeyboardEvent): string => {
  const keys = [];
  if (e.ctrlKey) keys.push("Ctrl");
  if (e.altKey) keys.push("Alt");
  if (e.shiftKey) keys.push("Shift");
  if (e.metaKey) keys.push("Meta");
  
  const isModifierOnly = ["Control", "Alt", "Shift", "Meta", "Escape", "CapsLock"].includes(e.key);
  if (!isModifierOnly) {
    if (e.code === "Space") {
      keys.push("Space");
    } else {
      let key = e.key.toUpperCase();
      keys.push(key);
    }
  } else if (e.code === "CapsLock") {
    keys.push("CapsLock");
  } else if (e.key === "Control") {
    if (e.code === "ControlRight") keys.push("RControl");
    else keys.push("LControl");
  } else if (e.key === "Alt") {
    if (e.code === "AltRight") keys.push("RAlt");
    else keys.push("LAlt");
  }

  return keys.join("+");
};

const ShortcutRecorder = ({ value, onChange }: { value: string, onChange: (v: string) => void }) => {
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (recording) {
      inputRef.current?.focus();
    }
  }, [recording]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.key === "Escape") {
      setRecording(false);
      return;
    }
    
    const shortcut = formatShortcut(e);
    if (shortcut && (shortcut.includes("+") || ["CapsLock", "RControl", "LControl", "LAlt", "RAlt"].includes(shortcut))) {
      onChange(shortcut);
      setRecording(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div 
      className={`shortcut-recorder ${recording ? 'recording' : ''}`}
      onClick={() => setRecording(true)}
      style={{
        padding: '8px 12px',
        background: recording ? 'rgba(52, 211, 153, 0.15)' : 'rgba(0,0,0,0.35)',
        border: `1px solid ${recording ? '#34d399' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: '8px',
        color: recording ? '#34d399' : 'var(--text-main)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        transition: 'all 0.2s',
        minWidth: '200px'
      }}
    >
      <span>{recording ? '请按下组合键 (按 Esc 取消)' : (value || '点击录制快捷键')}</span>
      {recording && (
        <input 
          ref={inputRef}
          onKeyDown={handleKeyDown}
          onBlur={() => setRecording(false)}
          style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
        />
      )}
    </div>
  );
};

interface SettingsPanelProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  logs: string[];
  setLogs: React.Dispatch<React.SetStateAction<string[]>>;
  toggleAutostart: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  updateSetting,
  logs,
  setLogs,
  toggleAutostart
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const { showAlert, showConfirm } = useModal();
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState("v1.0.5");
  const [testStatus, setTestStatus] = useState<{status: 'idle'|'testing'|'success'|'error', msg: string}>({status: 'idle', msg: ''});
  const [showAdvancedLlm, setShowAdvancedLlm] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<{status: 'idle'|'checking'|'connected'|'disconnected', modelCount: number}>({status: 'idle', modelCount: 0});
  const [ollamaModels, setOllamaModels] = useState<{name: string, size: string}[]>([]);

  useEffect(() => {
    import('@tauri-apps/api/app').then(({ getVersion }) => {
      getVersion().then(v => setAppVersion('v' + v)).catch(console.error);
    });
  }, []);

  const refreshOllama = async () => {
    setOllamaStatus(prev => ({ ...prev, status: 'checking' }));
    const health = await checkOllamaHealth(settings.baseUrl || "http://localhost:11434/v1");
    if (health.online) {
      setOllamaStatus({ status: 'connected', modelCount: health.modelCount });
      const models = await getOllamaModels(settings.baseUrl || "http://localhost:11434/v1");
      setOllamaModels(models);
      // Auto-select first model if current model is empty or not in the list
      if (models.length > 0 && !models.find(m => m.name === settings.modelName)) {
        updateSetting("modelName", models[0].name);
      }
    } else {
      setOllamaStatus({ status: 'disconnected', modelCount: 0 });
      setOllamaModels([]);
    }
  };

  useEffect(() => {
    if (settings.llmProvider === "ollama") {
      refreshOllama();
    }
  }, [settings.llmProvider, settings.baseUrl]);

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
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', position: 'sticky', top: 0, zIndex: 11, background: 'var(--bg-main)' }}>
        <div className="settings-search-bar" style={{ flex: 1, marginBottom: 0 }}>
          <Search size={16} className="search-icon" />
          <input 
            type="text" 
            placeholder={t('settings.search_ph') || "搜索设置项..."}
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
            <span className="search-count no-match">{t('settings.no_match') || "无匹配项"}</span>
          )}
        </div>
        <select 
          value={settings.uiLanguage}
          onChange={(e) => updateSetting("uiLanguage", e.target.value)}
          style={{
            width: '120px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text-main)',
            borderRadius: '8px',
            padding: '0 10px',
            outline: 'none',
            cursor: 'pointer'
          }}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English</option>
        </select>
      </div>


      <div className="settings-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ marginBottom: 0 }}>{t('settings.llm_config') || "大语言模型接口 (LLM Config)"}</h3>
          <div 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            title={t('settings.llm_toggle_tip') || "关闭后，本软件将作为纯语音听写工具，直接输出识别的原文，不再调用大模型进行润色。"}
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
          <label>{t('settings.provider') || "服务商 (Provider)"}</label>
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
              <option key={p.id} value={p.id}>{t(`settings.providers.${p.id}.name`) || p.name}</option>
            ))}
          </select>
          {LLM_PROVIDERS.find(p => p.id === settings.llmProvider)?.description && (
            <p className="input-tip">{t(`settings.providers.${settings.llmProvider}.desc`) || LLM_PROVIDERS.find(p => p.id === settings.llmProvider)?.description}</p>
          )}

          {settings.llmProvider === "ollama" && (
            <div style={{ marginTop: '12px', padding: '10px', borderRadius: '6px', backgroundColor: ollamaStatus.status === 'connected' ? 'rgba(16, 185, 129, 0.1)' : ollamaStatus.status === 'disconnected' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(156, 163, 175, 0.1)', display: 'flex', alignItems: 'center', gap: '8px', border: `1px solid ${ollamaStatus.status === 'connected' ? 'rgba(16, 185, 129, 0.2)' : ollamaStatus.status === 'disconnected' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(156, 163, 175, 0.2)'}` }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: ollamaStatus.status === 'connected' ? '#10b981' : ollamaStatus.status === 'disconnected' ? '#ef4444' : '#9ca3af', animation: ollamaStatus.status === 'checking' ? 'pulse 1.5s infinite' : 'none' }}></div>
              <span style={{ fontSize: '13px', color: ollamaStatus.status === 'connected' ? '#10b981' : ollamaStatus.status === 'disconnected' ? '#ef4444' : '#9ca3af' }}>
                {ollamaStatus.status === 'checking' ? (t('settings.ollama_checking') || "检测中...") : 
                 ollamaStatus.status === 'connected' ? (t('settings.ollama_connected', { count: ollamaStatus.modelCount })?.replace('{{count}}', ollamaStatus.modelCount.toString()) || `Ollama 已连接 · ${ollamaStatus.modelCount} 个模型可用`) : 
                 (t('settings.ollama_disconnected') || "Ollama 未检测到，请确认已启动")}
              </span>
            </div>
          )}
        </div>

        {settings.llmProvider !== "ollama" && (
          <div className="input-item">
            <label>{t('settings.api_key') || "API Key"}</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="password" 
                value={settings.apiKey} 
                onChange={(e) => updateSetting("apiKey", e.target.value)} 
                placeholder="填写您的 API 密钥"
                style={{ flex: 1 }}
              />
              <button 
                className="settings-action-btn" 
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
                {testStatus.status === 'testing' ? (t('settings.testing') || "测试中...") : (t('settings.test_connection') || "测试连接")}
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
            if (settings.llmProvider === "ollama") {
              return (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '200px' }}>
                    <select 
                      value={ollamaModels.find(m => m.name === settings.modelName) ? settings.modelName : "custom_input"} 
                      onChange={(e) => {
                        if (e.target.value === "custom_input") {
                          updateSetting("modelName", "");
                        } else {
                          updateSetting("modelName", e.target.value);
                        }
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                      disabled={ollamaModels.length === 0}
                    >
                    {ollamaModels.map(m => (
                      <option key={m.name} value={m.name}>{m.name} ({m.size})</option>
                    ))}
                    <option value="custom_input">{t('settings.custom_input') || "自定义输入..."}</option>
                  </select>
                  <button className="settings-icon-btn" onClick={refreshOllama} title={t('settings.ollama_refresh') || "刷新模型列表"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
                  </button>
                  </div>
                  {(!ollamaModels.find(m => m.name === settings.modelName)) && (
                    <input 
                      type="text" 
                      value={settings.modelName} 
                      onChange={(e) => updateSetting("modelName", e.target.value)} 
                      placeholder={t('settings.custom_input') || "自定义输入..."}
                      style={{ flex: 1, minWidth: '200px' }}
                    />
                  )}
                  <button 
                    className="settings-action-btn" 
                    onClick={async () => {
                      setTestStatus({ status: 'testing', msg: '测试中...' });
                      const res = await testConnection({ apiKey: "", baseUrl: settings.baseUrl, model: settings.modelName, isLocal: true });
                      if (res.ok) {
                        setTestStatus({ status: 'success', msg: res.message });
                      } else {
                        setTestStatus({ status: 'error', msg: res.message });
                      }
                    }}
                    disabled={testStatus.status === 'testing' || !settings.modelName}
                    style={{ marginLeft: 'auto' }}
                  >
                    {testStatus.status === 'testing' ? (t('settings.testing') || "测试中...") : (t('settings.ollama_test_infer') || "测试推理")}
                  </button>
                  {testStatus.status !== 'idle' && (
                    <div style={{ width: '100%' }}>
                      <p className={`input-tip ${testStatus.status === 'error' ? 'error-text' : 'success-text'}`} style={{ color: testStatus.status === 'error' ? '#ef4444' : '#10b981', margin: '4px 0 0 0' }}>
                        {testStatus.msg}
                      </p>
                    </div>
                  )}
                </div>
              );
            }

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
                  {LLM_PROVIDERS.find(p => p.id === settings.llmProvider)?.models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="custom_input">{t('settings.custom_input') || "自定义输入..."}</option>
                </select>
                  {(!currentProvider.models.includes(settings.modelName)) && (
                    <input 
                      type="text" 
                      value={settings.modelName} 
                      onChange={(e) => updateSetting("modelName", e.target.value)} 
                      placeholder={t('settings.custom_input') || "自定义输入..."}
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

        <div className="advanced-toggle" onClick={() => setShowAdvancedLlm(!showAdvancedLlm)}>
          <span>{t('settings.advanced') || "高级选项"}</span>
          {showAdvancedLlm ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        {showAdvancedLlm && (
          <div className="advanced-panel">
            <div className="input-item">
              <label>{t('settings.base_url') || "接口代理地址 (Base URL)"}</label>
              <input 
                type="text" 
                value={settings.baseUrl} 
                onChange={(e) => updateSetting("baseUrl", e.target.value)} 
                placeholder="默认会根据服务商自动填充"
              />
            </div>
            
            <div className="input-item">
              <label>{t('settings.temperature') || "Temperature (生成随机性, 默认 0.3)"}</label>
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
              <label>{t('settings.max_tokens') || "Max Tokens (最大生成长度, 默认 1000)"}</label>
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
        <h3>{t('settings.typing_mode') || "打字与上屏模式 (Typing & Input)"}</h3>
        
        <div className="input-item">
          <label>{t('settings.mode_label') || "上屏模式"}</label>
          <select value={settings.typeMode} onChange={(e) => updateSetting("typeMode", e.target.value as "simulate" | "clipboard")}>
            <option value="simulate">{t('settings.mode_simulate') || "自动上屏 (依赖模拟按键，推荐日常使用)"}</option>
            <option value="clipboard">{t('settings.mode_clipboard') || "纯剪贴板模式 (仅复制不按键，完美绕过高权限/游戏反作弊拦截)"}</option>
          </select>
          <p className="input-tip">{t('settings.mode_tip') || "如果遇到在某些高权限软件或游戏中文字无法打出，请切换至纯剪贴板模式。"}</p>
        </div>
      </div>

      <div className="settings-group">
        <h3>{t('settings.pref_title') || "听写与优化偏好"}</h3>

        <div className="input-item">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={settings.enableScreenCapture}
              onChange={(e) => updateSetting("enableScreenCapture", e.target.checked)}
              style={{ width: '16px', height: '16px', margin: 0 }}
            />
            {t('settings.screen_capture') || "屏幕感知 (Screen-Aware)"}
          </label>
          <p className="input-tip">{t('settings.screen_capture_tip') || "开启后，说话时会同步截取屏幕发送给大模型（仅支持具备图像理解能力的多模态模型，如 GPT-4o、Qwen-VL）。失败会自动降级为纯文本润色。"}</p>
          
          {settings.enableScreenCapture && (
            <div style={{ marginTop: '12px', paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: '#6b7280' }}>{t('settings.screen_capture_mode') || "捕获范围"}</label>
              <select 
                value={settings.screenCaptureMode} 
                onChange={(e) => updateSetting("screenCaptureMode", e.target.value as "window" | "fullscreen")}
                style={{ width: 'fit-content' }}
              >
                <option value="window">{t('settings.screen_capture_window') || "当前活跃窗口"}</option>
                <option value="fullscreen">{t('settings.screen_capture_fullscreen') || "整个屏幕"}</option>
              </select>
            </div>
          )}
        </div>
        
        <div className="input-item">
          <label>{t('settings.hotwords') || "专有词汇 / 热词 (Hot Words)"}</label>
          <input 
            type="text" 
            value={settings.hotWords} 
            onChange={(e) => updateSetting("hotWords", e.target.value)} 
            placeholder={t('settings.hotwords_placeholder') || "例如：Tauri, Enigo, Vue, 降噪"}
          />
          <p className="input-tip">{t('settings.hotwords_tip') || "使用逗号分隔，语音识别和大模型优化时会强制偏向这些专有词汇，大幅提升专业场景准确率。"}</p>
        </div>
        
        <div className="input-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ margin: 0 }}>{t('settings.ai_style') || "AI 优化风格预设 (Prompt Presets)"}</label>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <select style={{ flex: 1, minWidth: 0 }} value={settings.promptStyle} onChange={(e) => updateSetting("promptStyle", e.target.value)}>
              {settings.customPrompts?.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button 
              className="settings-icon-btn" 
              onClick={() => {
                const name = prompt("请输入新预设名称:");
                if (!name) return;
                const id = `custom_${Date.now()}`;
                const newPrompts = [...(settings.customPrompts || []), { id, name, prompt: "请帮我润色以下文本：" }];
                updateSetting("customPrompts", newPrompts);
                updateSetting("promptStyle", id);
              }}
              title="添加新预设"
            >
              <Plus size={16} />
            </button>
            {settings.customPrompts?.length > 1 && (
              <button 
                className="settings-icon-btn danger"
                onClick={() => {
                  if (confirm(`确定要删除预设 "${settings.customPrompts.find(p => p.id === settings.promptStyle)?.name}" 吗？`)) {
                    const newPrompts = settings.customPrompts.filter(p => p.id !== settings.promptStyle);
                    updateSetting("customPrompts", newPrompts);
                    updateSetting("promptStyle", newPrompts[0].id);
                  }
                }}
                title="删除当前预设"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {(() => {
            const currentPrompt = settings.customPrompts?.find(p => p.id === settings.promptStyle);
            if (!currentPrompt) return null;
            return (
              <textarea 
                value={currentPrompt.prompt}
                onChange={(e) => {
                  const newPrompts = settings.customPrompts.map(p => 
                    p.id === settings.promptStyle ? { ...p, prompt: e.target.value } : p
                  );
                  updateSetting("customPrompts", newPrompts);
                }}
                placeholder="在此编辑提示词 (Prompt)..."
                style={{ width: '100%', height: '80px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', padding: '10px 14px', fontSize: '0.9rem', resize: 'vertical' }}
              />
            );
          })()}
          <p className="input-tip">直接修改文本框中的 Prompt，会自动保存。新增的预设可以被选用并参与大模型润色。</p>
        </div>

        <div className="input-item">
          <label>{t('settings.asr_lang') || "语音识别语言"}</label>
          <select value={settings.asrLanguage} onChange={(e) => updateSetting("asrLanguage", e.target.value)}>
            <option value="chinese">{t('settings.lang_zh') || "中文 (Chinese)"}</option>
            <option value="english">{t('settings.lang_en') || "英文 (English)"}</option>
            <option value="japanese">{t('settings.lang_ja') || "日文 (Japanese)"}</option>
            <option value="korean">{t('settings.lang_ko') || "韩文 (Korean)"}</option>
            <option value="french">{t('settings.lang_fr') || "法文 (French)"}</option>
            <option value="german">{t('settings.lang_de') || "德文 (German)"}</option>
            <option value="spanish">{t('settings.lang_es') || "西班牙文 (Spanish)"}</option>
            <option value="auto">{t('settings.lang_auto') || "自动检测 (Auto-detect)"}</option>
          </select>
          <p className="input-tip">{t('settings.asr_lang_tip') || "指定 Whisper 识别的目标语言，推荐手动选择以提高准确率。"}</p>
        </div>

        <div className="input-item">
          <label>{t('settings.asr_engine') || "语音识别引擎 (ASR Engine)"}</label>
          <select value={settings.asrEngine} onChange={(e) => updateSetting("asrEngine", e.target.value as "local" | "api")}>
            <option value="local">{t('settings.engine_local') || "本地离线模型 (免费/保护隐私)"}</option>
            <option value="api">{t('settings.engine_api') || "云端 API 模型 (极速/支持流式上屏)"}</option>
          </select>
        </div>

        {settings.asrEngine === 'api' && (
          <div className="input-item" style={{ background: 'rgba(52, 211, 153, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
            <label style={{ color: '#34d399' }}>{t('settings.asr_api_title') || "API 语音模型配置 (兼容 OpenAI 格式)"}</label>
            <input 
              type="text" 
              value={settings.asrApiUrl} 
              onChange={(e) => updateSetting("asrApiUrl", e.target.value)} 
              placeholder={t('settings.asr_api_url_ph') || "API URL (例如: https://api.groq.com/openai/v1/audio/transcriptions)"}
              style={{ marginBottom: '8px' }}
            />
            <input 
              type="password" 
              value={settings.asrApiKey} 
              onChange={(e) => updateSetting("asrApiKey", e.target.value)} 
              placeholder={t('settings.asr_api_key_ph') || "API Key"}
              style={{ marginBottom: '8px' }}
            />
            <input 
              type="text" 
              value={settings.asrApiModel} 
              onChange={(e) => updateSetting("asrApiModel", e.target.value)} 
              placeholder={t('settings.asr_api_model_ph') || "模型名称 (例如: whisper-large-v3)"}
            />
            <p className="input-tip">{t('settings.asr_api_tip') || "使用快速的云端 API（如 Groq）可实现边说话边出字的流式体验。"}</p>
          </div>
        )}

        {settings.asrEngine === 'local' && (
          <>
            <div className="input-item">
              <label>{t('settings.local_model_title') || "本地识别模型 (Offline ASR Model)"}</label>
              <div className="input-tip" style={{ marginTop: '8px', lineHeight: '1.5', fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
                <span style={{ fontWeight: 'bold', color: '#34d399' }}>{t('settings.local_engine_desc1') || "当前独占引擎：SenseVoice Small (~250MB)"}</span>
                <p style={{ margin: '6px 0 0 0', color: 'rgba(255,255,255,0.35)' }}>{t('settings.local_engine_desc2') || "极速多语言模型，基于底层引擎原生推理。任意配置均可秒级响应。"}</p>
                <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'rgba(255,255,255,0.8)' }}>{t('settings.local_engine_status') || "SenseVoice 模型状态"}</span>
                    <button 
                      onClick={() => forceRedownloadSenseVoice()}
                      disabled={isDownloadingModel}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)', color: '#34d399',
                        padding: '4px 10px', borderRadius: '4px', cursor: isDownloadingModel ? 'not-allowed' : 'pointer', fontSize: '11px'
                      }}
                    >
                      <Download size={12} />
                      {isDownloadingModel ? (t('settings.downloading') || "正在下载...") : (t('settings.force_redownload') || "强制重新下载")}
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
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#34d399' }}>{t('settings.model_ready') || "✅ 模型已成功更新"}</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="input-item">
          <label>{t('settings.listen_key_label') || "触发快捷键"}</label>
          <ShortcutRecorder 
            value={settings.listenKey} 
            onChange={(val) => updateSetting("listenKey", val)} 
          />
        </div>
      </div>

      <div className="settings-group">
        <h3>{t('settings.blacklist') || "全局防误触黑名单 (Blacklist)"}</h3>
        <p className="input-tip">{t('settings.blacklist_tip') || "当您的焦点在这些程序（如游戏）上时，快捷键将被彻底禁用，保护隐私并防止游戏卡顿。"}</p>
        <div className="input-item">
          <textarea 
            value={settings.blacklistStr} 
            onChange={(e) => updateSetting("blacklistStr", e.target.value)} 
            placeholder={t('settings.blacklist_ph') || "例如: csgo.exe, LOL.exe (用逗号或换行分隔)"}
            style={{ width: '100%', height: '60px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', padding: '10px 14px', fontSize: '0.95rem', resize: 'vertical' }}
          />
        </div>
      </div>

      <div className="settings-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ marginBottom: 0 }}>{t('settings.smart_context') || "智能场景感知 (Smart Context Prompts)"}</h3>
            <p className="input-tip" style={{ marginTop: '6px', marginBottom: 0 }}>{t('settings.smart_context_tip') || "根据当前所在的软件自动切换到对应的提示词风格"}</p>
          </div>
          <div 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            onClick={() => updateSetting("enableSmartContext", !settings.enableSmartContext)}
          >
            <div className={`toggle-switch ${settings.enableSmartContext ? 'active' : ''}`} style={{ margin: 0 }}>
              <div className="toggle-thumb"></div>
            </div>
          </div>
        </div>

        {settings.enableSmartContext && (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {settings.smartContextBindings?.map((binding, index) => (
              <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="text" 
                  value={binding.appKeyword} 
                  onChange={(e) => {
                    const newBindings = [...(settings.smartContextBindings || [])];
                    newBindings[index].appKeyword = e.target.value;
                    updateSetting("smartContextBindings", newBindings);
                  }}
                  placeholder={t('settings.smart_context_app_ph') || "进程关键词 (如 WeChat)"}
                  style={{ flex: 1, padding: '8px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-main)', fontSize: '0.85rem' }}
                />
                <select 
                  value={binding.promptId} 
                  onChange={(e) => {
                    const newBindings = [...(settings.smartContextBindings || [])];
                    newBindings[index].promptId = e.target.value;
                    updateSetting("smartContextBindings", newBindings);
                  }}
                  style={{ flex: 1, padding: '8px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--text-main)', fontSize: '0.85rem' }}
                >
                  <option value="" disabled>选择提示词</option>
                  {settings.customPrompts?.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button 
                  onClick={() => {
                    const newBindings = settings.smartContextBindings.filter((_, i) => i !== index);
                    updateSetting("smartContextBindings", newBindings);
                  }}
                  style={{ padding: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            
            <button 
              onClick={() => {
                const newBindings = [...(settings.smartContextBindings || []), { appKeyword: "", promptId: settings.customPrompts?.[0]?.id || "" }];
                updateSetting("smartContextBindings", newBindings);
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '8px', background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', border: '1px dashed rgba(52, 211, 153, 0.3)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem'
              }}
            >
              <Plus size={14} /> {t('settings.add_binding') || "添加场景绑定"}
            </button>
          </div>
        )}
      </div>

      <div className="settings-group">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ marginBottom: 0 }}>{t('settings.autostart') || "开机自启"}</h3>
            <p className="input-tip" style={{ marginTop: '6px', marginBottom: 0 }}>{t('settings.autostart_tip') || "在系统登录时自动在后台静默运行"}</p>
          </div>
          <div 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            onClick={toggleAutostart}
          >
            <div 
              className={`toggle-switch ${settings.autoStart ? 'active' : ''}`}
              style={{ margin: 0 }}
            >
              <div className="toggle-thumb"></div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="settings-group">
        <h3>{t('settings.logs') || "开发调试日志"}</h3>
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
          placeholder={t('settings.no_logs') || "暂无调试日志"}
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
        >{t('settings.clear_logs') || "清空日志"}</button>
      </div>



      <div className="settings-group" style={{ marginTop: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>{t('settings.about') || "关于与更新 (About & Updates)"}</h3>
          <button 
            onClick={async (e) => {
              const btn = e.currentTarget;
              const originalText = btn.innerText;
              btn.innerText = t('settings.checking_update') || "正在检查...";
              btn.disabled = true;
              try {
                const { check } = await import('@tauri-apps/plugin-updater');
                const update = await check();
                
                if (update) {
                  const updateFoundMsg = t('settings.update_found', { version: update.version, notes: update.body }) || `发现新版本: ${update.version}\n\n更新日志:\n${update.body}\n\n是否立即尝试自动更新？（若自动更新失败将提供备用下载链接）`;
                  const shouldUpdate = await showConfirm(updateFoundMsg);
                  if (shouldUpdate) {
                    btn.innerText = t('settings.downloading_installing') || "正在下载并安装...";
                    let downloaded = 0;
                    let contentLength = 0;
                    await update.downloadAndInstall((event) => {
                      switch (event.event) {
                        case 'Started':
                          contentLength = event.data.contentLength || 0;
                          btn.innerText = (t('settings.downloading_percent') || `下载中...`) + " (0%)";
                          break;
                        case 'Progress':
                          downloaded += event.data.chunkLength;
                          if (contentLength > 0) {
                            const percent = Math.round((downloaded / contentLength) * 100);
                            btn.innerText = (t('settings.downloading_percent') || `下载中...`) + ` (${percent}%)`;
                          } else {
                            btn.innerText = (t('settings.downloading_percent') || `下载中...`) + ` (${(downloaded / 1024 / 1024).toFixed(1)}MB)`;
                          }
                          break;
                        case 'Finished':
                          btn.innerText = t('settings.download_finished') || "下载完成，准备重启";
                          break;
                      }
                    });
                    const { relaunch } = await import('@tauri-apps/plugin-process');
                    await relaunch();
                  }
                } else {
                  await showAlert(t('settings.already_latest') || "当前已经是最新版本！");
                }
              } catch (err) {
                try {
                  const fallbackUi = (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
                      <p>{t('settings.update_fail_desc') || "自动更新失败，可能是由于网络原因导致无法连接 GitHub 下载更新包。"}</p>
                      <p style={{ fontSize: '0.85em', color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '6px', borderRadius: '4px', wordBreak: 'break-all' }}>{t('settings.error_msg') || "错误信息"}: {String(err)}</p>
                    </div>
                  );
                  await showAlert({ title: t('settings.update_failed_title') || "自动更新失败", message: fallbackUi });
                } catch (fallbackErr) {
                  await showAlert((t('settings.check_update_fail') || "检查更新失败，网络异常。\n") + err);
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
            {t('settings.check_update') || "检查更新"}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ textAlign: 'left' }}>
              <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '1.1rem', fontWeight: 'bold', margin: 0, marginBottom: '4px' }}>VoiceFlow AI</p>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', margin: 0 }}><Trans i18nKey="settings.current_version" values={{ version: appVersion }}>当前版本: {appVersion}</Trans></p>
            </div>
            <div style={{ padding: '4px 10px', background: 'rgba(255, 255, 255, 0.05)', color: 'rgba(255, 255, 255, 0.6)', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.1)' }}>
              {t('settings.stable') || "稳定版"}
            </div>
          </div>
          
          <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
            <p style={{ fontSize: '0.9rem', color: '#f3f4f6', marginBottom: '8px', fontWeight: 'bold' }}>{t('settings.backup_download') || "📦 备用下载通道 (手动更新)"}</p>
            <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '12px' }}>{t('settings.backup_tip') || "如果您由于网络限制无法通过“检查更新”按钮完成自动更新，您可以随时点击下方链接获取最新安装包："}</p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button 
                onClick={async () => { const { openUrl } = await import('@tauri-apps/plugin-opener'); openUrl('https://pan.baidu.com/s/1_F4xAr_5XHxnRxtHKdNO1w?pwd=hzdp'); }}
                style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {t('settings.baidu_pan') || "百度网盘 (提取码: hzdp)"}
              </button>
              <button 
                onClick={async () => { const { openUrl } = await import('@tauri-apps/plugin-opener'); openUrl('https://github.com/bdrwss/VoiceFlow_AI/releases'); }}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#d1d5db', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {t('settings.github_release') || "GitHub 发布页"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
