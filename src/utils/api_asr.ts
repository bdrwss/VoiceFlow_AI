export interface AsrApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

// Convert Float32Array to WAV Blob
function encodeWAV(samples: Float32Array, sampleRate: number = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

export async function transcribeAudioApi(audioData: Float32Array, config: AsrApiConfig): Promise<string> {
  if (!config.apiKey || !config.apiUrl) {
    throw new Error("请先在设置中配置语音识别 API Key 和 URL。");
  }

  const wavBlob = encodeWAV(audioData, 16000);
  const formData = new FormData();
  formData.append('file', wavBlob, 'audio.wav');
  formData.append('model', config.model || 'whisper-1');

  // ensure trailing slash is removed and append /v1/audio/transcriptions if not present
  let url = config.apiUrl.trim().replace(/\/$/, "");
  if (!url.endsWith('/v1/audio/transcriptions') && !url.endsWith('/audio/transcriptions')) {
    url += '/v1/audio/transcriptions';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ASR API 请求失败 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.text || "";
}
