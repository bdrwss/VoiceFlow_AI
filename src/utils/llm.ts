export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  promptStyle: string; // "formal" | "concise" | "academic" | "natural"
  customPromptText?: string;
  appName?: string;
  hotWords?: string;
  temperature?: number;
  maxTokens?: number;
  isLocal?: boolean;
  screenshotBase64?: string;
}

const STYLE_PROMPTS: Record<string, string> = {
  natural: "你是一个智能听写助手的文本精炼系统。请将以下口述生成的识别文本进行去口语化、理顺句子结构、修正多余的重复词和错别字，并补全合适的标点。要求表达流畅、自然。请直接输出最终的精炼文本，不要带任何前言、解释、分析或括号说明，也不要加上任何多余的内容。",
  formal: "你是一个专业的公文和商务写作助理。请将以下识别文本转换为得体、严谨、结构清晰的正式书面语（如职场汇报、工作邮件风格）。修正所有口头表达。请直接输出改写后的书面语文本，不要带任何多余的解释、寒暄或格式说明。",
  concise: "你是一个文本精简专家。请提炼以下识别文本的核心信息，去掉无意义的修饰和废话，用最少、最直接的文字进行表达。请直接输出精简后的结果，不带任何附加分析。",
  academic: "你是一个学术与技术文档润色专家。请将以下识别文本改写为专业、严谨、学术化的表达方式，纠正术语，提升用词的精确度。请直接输出最终结果，不要作任何额外说明。"
};

export async function refineText(text: string, config: LLMConfig): Promise<string> {
  if (!config.isLocal && !config.apiKey) {
    throw new Error("请先在设置中配置 LLM API Key。");
  }

  let systemPrompt = config.customPromptText || STYLE_PROMPTS[config.promptStyle] || STYLE_PROMPTS.natural;

  if (config.appName) {
    const app = config.appName.toLowerCase();
    if (app.includes("wechat") || app.includes("qq") || app.includes("dingtalk") || app.includes("feishu")) {
      systemPrompt += " [系统注入: 检测到用户正在聊天软件中输入，请让语言风格自然、口语化，适合聊天场景。]";
    } else if (app.includes("winword") || app.includes("wps") || app.includes("powerpnt") || app.includes("excel")) {
      systemPrompt += " [系统注入: 检测到用户正在办公软件中写作，请确保用词书面、严密且专业。]";
    } else if (app.includes("code") || app.includes("cursor") || app.includes("idea") || app.includes("devenv") || app.includes("pycharm")) {
      systemPrompt += " [系统注入: 检测到用户正在编程IDE中，如果用户涉及代码逻辑描述，请使用准确的技术术语并保留英文；如果是伪代码请直接输出。]";
    }
  }

  if (config.hotWords && config.hotWords.trim()) {
    systemPrompt += ` [系统强制指令: 用户设置了以下专有词库/热词：【${config.hotWords}】。如果识别文本中存在同音、近音词或可能是上述热词的拼写错误，请务必将其纠正为上述热词，优先使用这些专业术语。]`;
  }

  if (config.screenshotBase64) {
    systemPrompt += "\n[系统注入: 用户开启了屏幕感知模式。当前会附带一张屏幕截图作为上下文。请结合截图中的信息来理解用户的语音指令，然后生成适当的回复文本。如果语音指令是要求你\"回复\"、\"总结\"、\"翻译\"等动作，请直接输出目标文本。如果语音指令是常规听写润色且截图不相关，请忽略截图，按正常润色流程处理。]";
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const MAX_RETRIES = 2;
  const TIMEOUT_MS = config.screenshotBase64 ? 30000 : 15000;

  // 如果遇到模型不支持图片(通常返回400)，且我们发送了截图，自动降级为纯文本重试
  let currentScreenshot = config.screenshotBase64;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (!config.isLocal) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      let userContent: any = `原始识别文本为：\n"""\n${text}\n"""`;
      if (currentScreenshot) {
        userContent = [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${currentScreenshot}` } },
          { type: "text", text: `[屏幕上下文] 上面的图片是我当前屏幕内容。\n[语音指令] ${text}\n\n请结合屏幕内容理解我的意图，直接输出回复文本，不要解释或描述图片。` }
        ];
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ],
          temperature: config.temperature ?? 0.3,
          max_tokens: config.maxTokens ?? 1000
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 400 && currentScreenshot) {
          console.warn("模型可能不支持多模态，自动降级为纯文本重试...");
          currentScreenshot = undefined;
          continue; // 降级并立即进入下一次尝试
        }
        throw new Error(`LLM 接口请求失败 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const refined = data.choices?.[0]?.message?.content;
      if (!refined) {
        throw new Error("LLM 接口返回了空数据或格式不正确。");
      }

      return refined.trim();
    } catch (e: any) {
      clearTimeout(timeoutId);
      const isTimeout = e.name === 'AbortError' || e.message?.includes('timeout');
      console.error(`AI 润色第 ${attempt + 1} 次尝试失败:`, e.message || e);
      
      if (attempt === MAX_RETRIES) {
        throw new Error(`AI 润色失败 (已重试 ${MAX_RETRIES} 次): ${isTimeout ? '请求超时' : e.message}`);
      }
      // 等待 1 秒后重试
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  
  throw new Error("AI 润色失败");
}

export async function testConnection(config: Pick<LLMConfig, 'apiKey' | 'baseUrl' | 'model' | 'isLocal'>): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const start = Date.now();
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (!config.isLocal) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(10000)
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, message: `${res.status}: ${err.slice(0, 200)}`, latencyMs };
    }
    return { ok: true, message: `连接成功 (${latencyMs}ms)`, latencyMs };
  } catch (e: any) {
    return { ok: false, message: e.message || "连接失败", latencyMs: Date.now() - start };
  }
}

export async function getOllamaModels(baseUrl: string): Promise<{name: string, size: string}[]> {
  try {
    const url = `${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.models?.map((m: any) => {
      const sizeGB = (m.size / (1024 * 1024 * 1024)).toFixed(1);
      return { name: m.name, size: `${sizeGB} GB` };
    }) || [];
  } catch (e: any) {
    console.warn("Failed to fetch Ollama models:", e);
    return [];
  }
}

export async function checkOllamaHealth(baseUrl: string): Promise<{ online: boolean; modelCount: number }> {
  try {
    const url = `${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      return { online: true, modelCount: data?.models?.length || 0 };
    }
    return { online: false, modelCount: 0 };
  } catch (e) {
    return { online: false, modelCount: 0 };
  }
}
