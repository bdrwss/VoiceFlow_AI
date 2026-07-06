import { useState, useEffect, useCallback } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { getStoreInitialSettings, saveSettingsToStore } from '../utils/store';

export interface PromptPreset {
  id: string;
  name: string;
  prompt: string;
}

export interface SmartContextBinding {
  appKeyword: string;
  promptId: string;
}

export interface Settings {
  llmProvider: string;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  promptStyle: string;
  customPrompts: PromptPreset[];
  listenKey: string;
  asrLanguage: string;
  asrEngine: "local" | "api";
  asrApiUrl: string;
  asrApiKey: string;
  asrApiModel: string;
  blacklistStr: string;
  hotWords: string;
  typeMode: "simulate" | "clipboard";
  autoStart: boolean;
  enableOptimization: boolean;
  uiLanguage: string;
  enableScreenCapture: boolean;
  screenCaptureMode: "window" | "fullscreen";
  enableSmartContext: boolean;
  smartContextBindings: SmartContextBinding[];
}

const defaultSettings: Settings = {
  llmProvider: "deepseek",
  apiKey: "",
  baseUrl: "https://api.deepseek.com/v1",
  modelName: "deepseek-chat",
  temperature: 0.3,
  maxTokens: 1000,
  promptStyle: "natural",
  customPrompts: [
    { id: "natural", name: "自然听写润色（去口语化、加标点）", prompt: "作为我的听写助手，请将以下通过语音识别出的口语文本进行润色。你的任务是修正错别字、去除口语化的冗余词（如“啊”、“嗯”、“那个”等），并添加合适的标点符号，使其读起来通顺自然。请保持原意不变，直接返回修改后的文本即可，不要添加任何额外的解释或客套话。" },
    { id: "formal", name: "商务正式书面（邮件、汇报公文）", prompt: "作为我的商务文案助手，请将以下口头表达的文本转化为正式的商务书面语。你的任务是重构句子使其符合商业公文或正式邮件的标准，使用专业得体的词汇，确保条理清晰、逻辑严密。请直接返回修改后的文本，不要带有任何多余的问候语或解释说明。" },
    { id: "concise", name: "精练精简要点（提炼摘要）", prompt: "作为我的信息整理助手，请将以下文本提炼为精简的要点摘要。你的任务是去除所有无关紧要的修饰语和重复内容，只保留最核心的信息，并以短小精悍的句子（或列表形式）呈现。力求字数最少、信息量最大。直接返回精简后的结果即可。" },
    { id: "academic", name: "学术与技术文档强化", prompt: "作为我的学术与技术写作助手，请将以下文字润色为严谨的学术或技术文档风格。你的任务是确保专业术语的准确性，优化句子结构使其更具逻辑性和客观性，消除任何模糊或主观的表达。请直接输出润色后的文本，不加其他废话。" }
  ],
  listenKey: "RControl",
  asrLanguage: "chinese",
  asrEngine: "local",
  asrApiUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
  asrApiKey: "",
  asrApiModel: "whisper-large-v3",
  blacklistStr: "LOL.exe, csgo.exe, r5apex.exe, GenshinImpact.exe, dota2.exe",
  hotWords: "",
  typeMode: "simulate",
  autoStart: true,
  enableOptimization: true,
  uiLanguage: "zh-CN",
  enableScreenCapture: false,
  screenCaptureMode: "window",
  enableSmartContext: false,
  smartContextBindings: []
};

export function useSettings() {
  const getInitialSettings = () => {
    try {
      // 优先从内存中的 Tauri Store 获取
      const storeSettings = getStoreInitialSettings();
      if (storeSettings) {
        return { ...defaultSettings, ...storeSettings, customPrompts: storeSettings.customPrompts?.length ? storeSettings.customPrompts : defaultSettings.customPrompts };
      }

      // 如果 Store 为空，回退到 localStorage 并尝试迁移
      const saved = localStorage.getItem("vf_settings");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const merged = { ...defaultSettings, ...parsed };
          if (!merged.customPrompts || merged.customPrompts.length === 0) {
            merged.customPrompts = defaultSettings.customPrompts;
          }
          saveSettingsToStore(merged); // 自动迁移到 Store
          return merged;
        } catch (e) {
          console.error("Failed to parse saved settings", e);
        }
      }
      
      // Fallback to legacy single keys if unified json doesn't exist
      const legacyApiKey = localStorage.getItem("vf_api_key");
      if (legacyApiKey !== null) {
        const legacy = {
          llmProvider: localStorage.getItem("vf_llm_provider") || defaultSettings.llmProvider,
          apiKey: legacyApiKey,
          baseUrl: localStorage.getItem("vf_base_url") || defaultSettings.baseUrl,
          modelName: localStorage.getItem("vf_model_name") || defaultSettings.modelName,
          temperature: parseFloat(localStorage.getItem("vf_temperature") || defaultSettings.temperature.toString()),
          maxTokens: parseInt(localStorage.getItem("vf_max_tokens") || defaultSettings.maxTokens.toString(), 10),
          promptStyle: localStorage.getItem("vf_prompt_style") || defaultSettings.promptStyle,
          listenKey: localStorage.getItem("vf_listen_key") || defaultSettings.listenKey,
          asrLanguage: localStorage.getItem("vf_asr_language") || defaultSettings.asrLanguage,
          asrEngine: (localStorage.getItem("vf_asr_engine") as "local" | "api") || defaultSettings.asrEngine,
          asrApiUrl: localStorage.getItem("vf_asr_api_url") || defaultSettings.asrApiUrl,
          asrApiKey: localStorage.getItem("vf_asr_api_key") || defaultSettings.asrApiKey,
          asrApiModel: localStorage.getItem("vf_asr_api_model") || defaultSettings.asrApiModel,
          blacklistStr: localStorage.getItem("vf_blacklist") || defaultSettings.blacklistStr,
          hotWords: localStorage.getItem("vf_hot_words") || defaultSettings.hotWords,
          typeMode: (localStorage.getItem("vf_type_mode") as "simulate" | "clipboard") || defaultSettings.typeMode,
          autoStart: localStorage.getItem("vf_auto_start") === "true" || defaultSettings.autoStart,
          enableOptimization: localStorage.getItem("vf_enable_optimization") !== "false",
          uiLanguage: localStorage.getItem("vf_ui_language") || defaultSettings.uiLanguage,
          enableSmartContext: defaultSettings.enableSmartContext,
          smartContextBindings: defaultSettings.smartContextBindings,
          enableScreenCapture: defaultSettings.enableScreenCapture,
          screenCaptureMode: defaultSettings.screenCaptureMode,
        };
        saveSettingsToStore(legacy);
        return legacy;
      }
    } catch (e) {
      console.error("Failed to load settings", e);
    }
    return defaultSettings;
  };

  const [settings, setSettingsState] = useState<Settings>(() => {
    const loaded = getInitialSettings();
    // 注入 i18n 语言
    import('i18next').then(i18next => {
      if (loaded.uiLanguage) {
        i18next.default.changeLanguage(loaded.uiLanguage);
      }
    });
    return loaded;
  });
  const [savedSettings, setSavedSettings] = useState<Settings>(getInitialSettings);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettingsState(prev => {
      const newSettings = { ...prev, [key]: value };
      
      // 当语言改变时自动应用
      if (key === 'uiLanguage') {
        import('i18next').then(i18next => i18next.default.changeLanguage(value as string));
      }
      return newSettings;
    });
  }, []);

  const saveSettings = () => {
    // 写入 localStorage 作为双保险/向后兼容
    localStorage.setItem("vf_settings", JSON.stringify(settings));
    localStorage.setItem("vf_listen_key", settings.listenKey);
    localStorage.setItem("vf_ui_language", settings.uiLanguage);
    
    // 写入 Tauri Store（异步防抖）
    saveSettingsToStore(settings);
    
    setSavedSettings(settings);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  // Sync listen key to backend whenever it changes
  useEffect(() => {
    invoke("set_listen_key", { key: settings.listenKey }).catch(console.error);
  }, [settings.listenKey]);

  // Sync autostart setting with OS
  useEffect(() => {
    const syncAutostart = async () => {
      try {
        const { enable, disable } = await import('@tauri-apps/plugin-autostart');
        if (settings.autoStart) {
          await enable();
        } else {
          await disable();
        }
      } catch (err) {
        console.warn("Failed to sync autostart (this is normal during dev/uncompiled environment):", err);
      }
    };
    syncAutostart();
  }, [settings.autoStart]);

  return {
    settings,
    updateSetting,
    saveSettings,
    saveStatus,
    isDirty
  };
}
