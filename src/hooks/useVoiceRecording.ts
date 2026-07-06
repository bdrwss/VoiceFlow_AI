import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AudioRecorder } from '../utils/audio';

interface VoiceRecordingOptions {
  onChunk?: (chunk: Float32Array) => void;
  onTimeout?: () => void;
  chunkIntervalMs?: number;
}

export function useVoiceRecording(options: VoiceRecordingOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  // Instantiate lazily or hold in ref
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    if (!recorderRef.current) {
      recorderRef.current = new AudioRecorder();
    }
    
    setIsRecording(true);
    
    // Duck system audio
    invoke("duck_system_audio").catch((e) => console.error("Failed to duck audio", e));

    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
    }
    
    // 5分钟超时保护
    recordingTimeoutRef.current = window.setTimeout(() => {
      if (options.onTimeout) {
        options.onTimeout();
      }
    }, 5 * 60 * 1000);

    try {
      await recorderRef.current.start(options.onChunk, options.chunkIntervalMs || 0);
    } catch (err) {
      setIsRecording(false);
      if (recordingTimeoutRef.current !== null) {
        window.clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      throw err;
    }
  }, [options]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    invoke("restore_system_audio").catch((e) => console.error("Failed to restore audio", e));
    
    if (recorderRef.current) {
      const audioData = recorderRef.current.stop();
      return { audioData, isValid: validateVoice(audioData) };
    }
    return { audioData: new Float32Array(0), isValid: false };
  }, []);

  const getAnalyser = useCallback(() => {
    if (recorderRef.current) {
      return recorderRef.current.getAnalyser();
    }
    return null;
  }, []);

  // VAD 静音与噪音拦截 (滑动窗口 RMS 算法)
  const validateVoice = (audioData: Float32Array): boolean => {
    const VAD_THRESHOLD_MAX = 0.01;
    const VAD_THRESHOLD_RMS = 0.002;
    const VAD_WINDOW_SIZE = 800; // 50ms at 16000Hz
    const VAD_REQUIRED_WINDOWS = 3; // 至少连续 150ms 达标判定为人声

    let globalMax = 0;
    let hasVoice = false;
    let consecutiveVoiceFrames = 0;

    for (let i = 0; i < audioData.length; i += VAD_WINDOW_SIZE) {
      let sumSquares = 0;
      let frameMax = 0;
      let count = 0;
      
      for (let j = 0; j < VAD_WINDOW_SIZE && i + j < audioData.length; j++) {
        const val = audioData[i + j];
        const abs = Math.abs(val);
        if (abs > frameMax) frameMax = abs;
        if (abs > globalMax) globalMax = abs;
        sumSquares += val * val;
        count++;
      }
      
      const rms = Math.sqrt(sumSquares / count);
      if (rms >= VAD_THRESHOLD_RMS && frameMax >= VAD_THRESHOLD_MAX) {
        consecutiveVoiceFrames++;
        if (consecutiveVoiceFrames >= VAD_REQUIRED_WINDOWS) {
          hasVoice = true;
          break;
        }
      } else {
        consecutiveVoiceFrames = 0;
      }
    }

    if (audioData.length === 0 || globalMax < 0.005) {
      return false; // 音量过低
    }
    if (!hasVoice) {
      return false; // 瞬时噪音拦截
    }
    return true;
  };

  return {
    isRecording,
    startRecording,
    stopRecording,
    getAnalyser
  };
}
