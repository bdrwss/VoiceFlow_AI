import { useState, useEffect } from 'react';
import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  promptStyle: string;
  listenKey: string;
  asrLanguage: string;
  whisperModel: string;
  inferenceDevice: string;
  asrEngine: "local" | "api";
  asrApiUrl: string;
  asrApiKey: string;
  asrApiModel: string;
  blacklistStr: string;
  hotWords: string;
  typeMode: "simulate" | "clipboard";
  autoStart: boolean;
}

const defaultSettings: Settings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com/v1",
  modelName: "deepseek-chat",
  promptStyle: "natural",
  listenKey: "RControl",
  asrLanguage: "chinese",
  whisperModel: "sensevoice-small",
  inferenceDevice: "auto",
  asrEngine: "local",
  asrApiUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
  asrApiKey: "",
  asrApiModel: "whisper-large-v3",
  blacklistStr: "LOL.exe, csgo.exe, r5apex.exe, GenshinImpact.exe, dota2.exe",
  hotWords: "",
  typeMode: "simulate",
  autoStart: false
};

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(() => {
    try {
      const saved = localStorage.getItem("vf_settings");
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
      }
      
      // Fallback to legacy single keys if unified json doesn't exist
      const legacyApiKey = localStorage.getItem("vf_api_key");
      if (legacyApiKey !== null) {
        return {
          apiKey: legacyApiKey,
          baseUrl: localStorage.getItem("vf_base_url") || defaultSettings.baseUrl,
          modelName: localStorage.getItem("vf_model_name") || defaultSettings.modelName,
          promptStyle: localStorage.getItem("vf_prompt_style") || defaultSettings.promptStyle,
          listenKey: localStorage.getItem("vf_listen_key") || defaultSettings.listenKey,
          asrLanguage: localStorage.getItem("vf_asr_language") || defaultSettings.asrLanguage,
          whisperModel: localStorage.getItem("vf_whisper_model") || defaultSettings.whisperModel,
          inferenceDevice: localStorage.getItem("vf_inference_device") || defaultSettings.inferenceDevice,
          asrEngine: (localStorage.getItem("vf_asr_engine") as "local" | "api") || defaultSettings.asrEngine,
          asrApiUrl: localStorage.getItem("vf_asr_api_url") || defaultSettings.asrApiUrl,
          asrApiKey: localStorage.getItem("vf_asr_api_key") || defaultSettings.asrApiKey,
          asrApiModel: localStorage.getItem("vf_asr_api_model") || defaultSettings.asrApiModel,
          blacklistStr: localStorage.getItem("vf_blacklist") || defaultSettings.blacklistStr,
          hotWords: localStorage.getItem("vf_hot_words") || defaultSettings.hotWords,
          typeMode: (localStorage.getItem("vf_type_mode") as "simulate" | "clipboard") || defaultSettings.typeMode,
          autoStart: localStorage.getItem("vf_auto_start") === "true" || defaultSettings.autoStart,
        };
      }
    } catch (e) {
      console.error("Failed to load settings", e);
    }
    return defaultSettings;
  });

  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettingsState(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = () => {
    localStorage.setItem("vf_settings", JSON.stringify(settings));
    
    // Also save listen_key for rust backend legacy sync if needed, though we sync it below
    localStorage.setItem("vf_listen_key", settings.listenKey);
    
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
        console.error("Failed to sync autostart", err);
      }
    };
    syncAutostart();
  }, [settings.autoStart]);

  return {
    settings,
    updateSetting,
    saveSettings,
    saveStatus
  };
}
