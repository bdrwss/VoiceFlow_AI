import { useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { refineText, LLMConfig } from '../utils/llm';

export function useLLMRefine() {
  const lastTypedLengthRef = useRef<number>(0);

  const clearPlaceholder = useCallback(async (shouldSimulateTyping: boolean) => {
    if (lastTypedLengthRef.current > 0) {
      if (shouldSimulateTyping) {
        try {
          await invoke("replace_with_ai_text", {
            originalLen: lastTypedLengthRef.current,
            newText: ""
          });
        } catch (e) {
          console.error("清除占位符失败:", e);
        }
      } else {
        try {
          await writeText("");
        } catch (e) {
          console.error("清除剪贴板失败:", e);
        }
      }
      lastTypedLengthRef.current = 0;
    }
  }, []);

  const typeText = useCallback(async (text: string, shouldSimulateTyping: boolean, isFocusLost: boolean) => {
    if (shouldSimulateTyping) {
      if (lastTypedLengthRef.current > 0) {
        await invoke("replace_with_ai_text", {
          originalLen: lastTypedLengthRef.current,
          newText: text
        });
      } else {
        await invoke("simulate_typing", { text });
      }
      lastTypedLengthRef.current = text.length;
    } else {
      await writeText(text);
      lastTypedLengthRef.current = 0;
      if (isFocusLost) {
        throw new Error("FOCUS_LOST");
      }
    }
  }, []);

  const resetTypedLength = useCallback(() => {
    lastTypedLengthRef.current = 0;
  }, []);

  const performRefine = useCallback(async (text: string, config: LLMConfig): Promise<string> => {
    return await refineText(text, config);
  }, []);

  return {
    clearPlaceholder,
    typeText,
    resetTypedLength,
    performRefine
  };
}
