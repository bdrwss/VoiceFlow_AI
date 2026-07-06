import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { writeFile } from '@tauri-apps/plugin-fs';
import { transcribeAudioApi } from '../utils/api_asr';
import { float32ToWav } from '../utils/audio';

interface ASRConfig {
  asrEngine: "local" | "api";
  asrApiUrl: string;
  asrApiKey: string;
  asrApiModel: string;
}

export function useASR() {
  const startTranscribe = useCallback(async (audioData: Float32Array, config: ASRConfig): Promise<string> => {
    let text = "";
    if (config.asrEngine === 'api') {
      text = await transcribeAudioApi(audioData, {
        apiUrl: config.asrApiUrl,
        apiKey: config.asrApiKey,
        model: config.asrApiModel
      });
    } else {
      // 使用 SenseVoice Small 原生推理
      const wavBytes = float32ToWav(audioData, 16000);
      const dataDirPath = await appDataDir();
      const wavPath = await join(dataDirPath, "temp_sensevoice.wav");
      
      await writeFile(wavPath, wavBytes);
      const rawResult: string = await invoke("transcribe_sensevoice", { audioPath: wavPath });
      text = rawResult.trim();
    }

    return text.trim();
  }, []);

  const compensatePunctuation = useCallback((text: string, hasLlmApiKey: boolean): string => {
    let finalText = text;
    if (!hasLlmApiKey) {
      const lastChar = finalText.slice(-1);
      const punctuationRegex = /[。！？.!?]/;
      if (!punctuationRegex.test(lastChar)) {
        // 基础中英文末尾补全
        if (/^[a-zA-Z0-9\s]+$/.test(finalText.slice(-3))) {
          finalText += ".";
        } else {
          finalText += "。";
        }
      }
    }
    return finalText;
  }, []);

  return {
    startTranscribe,
    compensatePunctuation
  };
}
