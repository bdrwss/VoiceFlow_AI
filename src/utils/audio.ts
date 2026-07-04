export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioChunks: Float32Array[] = [];
  private onChunkCallback?: (chunk: Float32Array) => void;
  private chunkIntervalMs: number = 0;
  private lastChunkEmitTime: number = 0;

  async start(onChunk?: (chunk: Float32Array) => void, chunkIntervalMs: number = 2000) {
    this.audioChunks = [];
    this.onChunkCallback = onChunk;
    this.chunkIntervalMs = chunkIntervalMs;
    this.lastChunkEmitTime = Date.now();
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      }
    });

    // 创建指定 16000Hz 采样的 AudioContext，浏览器会自动完成重采样
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    
    // 兼容部分浏览器策略，若 AudioContext 处于 suspended 状态，强制唤醒
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    
    // 实例化分析器节点，供频域声波可视化使用
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    // 注册并加载 AudioWorklet 模块
    try {
      await this.audioContext.audioWorklet.addModule('/recorder-worklet.js');
    } catch (err) {
      console.error('Failed to load recorder-worklet.js. Please ensure it is in the public directory.', err);
      throw err;
    }

    // 实例化 AudioWorkletNode
    this.processor = new AudioWorkletNode(this.audioContext, 'recorder-worklet');

    // 监听子线程传回的音频数据块
    this.processor.port.onmessage = (e) => {
      const inputData = e.data; // Float32Array
      this.audioChunks.push(inputData);

      // 触发分片回调 (伪流式)
      if (this.onChunkCallback && this.chunkIntervalMs > 0) {
        const now = Date.now();
        if (now - this.lastChunkEmitTime >= this.chunkIntervalMs) {
          this.lastChunkEmitTime = now;
          // 合并当前所有的 chunks 发送出去
          const currentAudio = this.getAccumulatedAudio();
          if (currentAudio.length > 0) {
            this.onChunkCallback(currentAudio);
          }
        }
      }
    };

    // 音频图：source -> analyser -> processor -> gain(0) -> destination
    // 必须经过一个 gain 值为 0 的节点再连接 destination，否则麦克风声音会从扬声器直接播放出来产生回声死循环
    const muteGain = this.audioContext.createGain();
    muteGain.gain.value = 0;
    this.source.connect(this.analyser);
    this.analyser.connect(this.processor);
    this.processor.connect(muteGain);
    muteGain.connect(this.audioContext.destination);
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private getChunkRMS(chunk: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
      sum += chunk[i] * chunk[i];
    }
    return Math.sqrt(sum / chunk.length);
  }

  // 获取当前已经积累的有效音频 (去除开头静音)
  private getAccumulatedAudio(): Float32Array {
    if (this.audioChunks.length === 0) return new Float32Array(0);
    const SILENCE_THRESHOLD = 0.005;
    let startIndex = 0;
    for (let i = 0; i < this.audioChunks.length; i++) {
      if (this.getChunkRMS(this.audioChunks[i]) > SILENCE_THRESHOLD) {
        startIndex = Math.max(0, i - 2);
        break;
      }
    }
    const validChunks = this.audioChunks.slice(startIndex);
    const totalLength = validChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of validChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  stop(): Float32Array {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.port.onmessage = null;
      this.processor = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // VAD (静音切除)：计算每个 chunk 的 RMS，移除首尾的长静音数据
    const SILENCE_THRESHOLD = 0.005; // RMS 阈值
    let startIndex = 0;
    let endIndex = this.audioChunks.length - 1;
    let isSilent = true;

    // 寻找起始非静音块
    for (let i = 0; i < this.audioChunks.length; i++) {
      if (this.getChunkRMS(this.audioChunks[i]) > SILENCE_THRESHOLD) {
        startIndex = Math.max(0, i - 2); // 保留约 0.5 秒前置余量 (4096采样=256ms)
        isSilent = false;
        break;
      }
    }

    if (isSilent) {
      // 绝对全静音，直接丢弃
      this.audioChunks = [];
      return new Float32Array(0);
    }

    // 寻找结束非静音块
    for (let i = this.audioChunks.length - 1; i >= 0; i--) {
      if (this.getChunkRMS(this.audioChunks[i]) > SILENCE_THRESHOLD) {
        endIndex = Math.min(this.audioChunks.length - 1, i + 2); // 保留约 0.5 秒后置余量
        break;
      }
    }

    const validChunks = this.audioChunks.slice(startIndex, endIndex + 1);

    // 合并 chunks 成为单个 Float32Array，供 Whisper 模型推理
    const totalLength = validChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of validChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    this.audioChunks = [];
    return result;
  }
}

// 辅助函数：将 Float32Array 转换为 16-bit PCM WAV 格式的字节数组
export function float32ToWav(audioData: Float32Array, sampleRate: number = 16000): Uint8Array {
  const numChannels = 1;
  const numFrames = audioData.length;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const wavBuffer = new ArrayBuffer(44 + numFrames * 2);
  const view = new DataView(wavBuffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numFrames * 2, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, numFrames * 2, true);

  // write PCM samples
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    let s = Math.max(-1, Math.min(1, audioData[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, s, true);
    offset += 2;
  }

  return new Uint8Array(wavBuffer);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
