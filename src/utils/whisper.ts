import { pipeline, env } from '@huggingface/transformers';

// 配置远程源
env.allowLocalModels = false;
if (import.meta.env.DEV) {
  // 开发环境使用本地代理规避跨域
  env.remoteHost = window.location.origin + '/hf';
  env.remotePathTemplate = '{model}/resolve/{revision}/';
} else {
  // 生产环境直接请求 hf-mirror.com 镜像站以确保国内可用性
  env.remoteHost = 'https://hf-mirror.com';
  env.remotePathTemplate = '{model}/resolve/{revision}/';
}

let pipe: any = null;
let currentModelName: string = "";
let initPromise: Promise<any> | null = null;
let forceWasmFallback = false; // 记录 WebGPU 是否在 auto 模式下失败
let disposeTimer: any = null;

const DISPOSE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

function resetDisposeTimer() {
  if (disposeTimer) clearTimeout(disposeTimer);
  disposeTimer = setTimeout(async () => {
    if (pipe) {
      console.log("Memory sleep strategy triggered: Disposing Whisper engine after 10 minutes of inactivity.");
      try { await pipe.dispose(); } catch (e) {}
      pipe = null;
      currentModelName = "";
    }
  }, DISPOSE_TIMEOUT_MS);
}

export async function initWhisper(
  modelName: string = 'Xenova/whisper-tiny',
  deviceSetting: string = 'auto',
  onProgress?: (progress: number) => void
): Promise<any> {
  // 若已加载且模型名一致，直接返回
  if (pipe && currentModelName === modelName) {
    resetDisposeTimer();
    return pipe;
  }
  
  if (initPromise && currentModelName === modelName) {
    return await initPromise;
  }
  
  currentModelName = modelName;

  initPromise = (async () => {
    const shouldUseWasm = deviceSetting === 'wasm' || (deviceSetting === 'auto' && forceWasmFallback);

  const progressTracker = new Map<string, {loaded: number, total: number}>();
  const handleProgress = (data: any) => {
    if (data.status === 'progress' && onProgress && data.name) {
      progressTracker.set(data.name, { loaded: data.loaded || 0, total: data.total || 0 });
      let totalLoaded = 0;
      let totalSize = 0;
      for (const p of progressTracker.values()) {
        totalLoaded += p.loaded;
        totalSize += p.total || p.loaded; // fallback if total is undefined
      }
      if (totalSize > 0) {
        onProgress((totalLoaded / totalSize) * 100);
      }
    }
  };

  if (!shouldUseWasm) {
    try {
      console.log(`Initializing ${modelName} with WebGPU...`);
      pipe = await pipeline('automatic-speech-recognition', modelName, {
        device: 'webgpu',
        dtype: {
          encoder_model: 'fp32', // 改用 fp32 规避部分显卡/WebView2 驱动对 fp16 Cast 算子的兼容性问题
          decoder_model_merged: 'q4',
        },
        progress_callback: handleProgress
      });
      console.log(`${modelName} loaded successfully with WebGPU.`);
      initPromise = null;
      resetDisposeTimer();
      return pipe;
    } catch (error) {
      console.warn(`Failed to load ${modelName} with WebGPU, falling back to WASM...`, error);
      if (deviceSetting === 'auto') forceWasmFallback = true;
    }
  }

  // 强制 WASM 或 WebGPU fallback
  try {
    console.log(`Initializing ${modelName} with WASM...`);
    pipe = await pipeline('automatic-speech-recognition', modelName, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: handleProgress
    });
    console.log(`${modelName} loaded successfully with WASM.`);
    initPromise = null;
    resetDisposeTimer();
    return pipe;
  } catch (err) {
    initPromise = null;
    console.error(`Critical: Failed to load ${modelName} pipeline in WASM mode too.`, err);
    throw err;
  }
  })();
  
  return initPromise;
}

export interface TranscribeOptions {
  language?: string; // e.g. "chinese", "english", or undefined for auto-detect
  model?: string;    // e.g. "Xenova/whisper-tiny"
  device?: string;   // "auto" | "webgpu" | "wasm"
  prompt?: string;   // Context prompt
}

export async function transcribeAudio(
  audioData: Float32Array, 
  options: TranscribeOptions = {},
  onProgress?: (progress: number) => void
): Promise<string> {
  const modelName = options.model || "Xenova/whisper-tiny";
  const deviceSetting = options.device || "auto";

  let whisperPipe = await initWhisper(modelName, deviceSetting, onProgress);
  if (!whisperPipe) {
    throw new Error("Whisper engine is not ready.");
  }

  const runOptions: any = {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: options.language || null, // 传 null 会让 Whisper 自动检测首要语言
    task: 'transcribe',
  };

  // 如果有 prompt，尝试注入
  if (options.prompt) {
    // 尽管 transformers.js 暂未完美支持前置 prompt_ids，通过传参有几率在某些模型版本生效
    runOptions.prompt = options.prompt;
  }

  try {
    // 运行 Whisper 推理
    const response = await whisperPipe(audioData, runOptions);
    resetDisposeTimer();
    return response.text || "";
  } catch (err: any) {
    console.error("Inference error:", err);
    // 捕获 WebGPU 在执行阶段的崩溃
    if (!forceWasmFallback && deviceSetting === 'auto' && (err.message?.includes('WebGPU') || err.message?.includes('ExecuteKernel'))) {
      console.warn("WebGPU inference crashed. Disposing WebGPU context and falling back to WASM...");
      forceWasmFallback = true;
      try { if (pipe && pipe.dispose) await pipe.dispose(); } catch (e) {}
      pipe = null;
      currentModelName = "";
      
      // 重新使用 WASM 初始化并重试推理
      whisperPipe = await initWhisper(modelName, deviceSetting, onProgress);
      if (!whisperPipe) throw new Error("WASM Fallback engine is not ready.");
      
      console.log("Retrying inference with WASM...");
      const response = await whisperPipe(audioData, runOptions);
      resetDisposeTimer();
      return response.text || "";
    }
    throw err;
  }
}
