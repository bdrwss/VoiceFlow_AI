export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  promptStyle: string; // "formal" | "concise" | "academic" | "natural"
  appName?: string;
  hotWords?: string;
}

const STYLE_PROMPTS: Record<string, string> = {
  natural: "你是一个智能听写助手的文本精炼系统。请将以下口述生成的识别文本进行去口语化、理顺句子结构、修正多余的重复词和错别字，并补全合适的标点。要求表达流畅、自然。请直接输出最终的精炼文本，不要带任何前言、解释、分析或括号说明，也不要加上任何多余的内容。",
  formal: "你是一个专业的公文和商务写作助理。请将以下识别文本转换为得体、严谨、结构清晰的正式书面语（如职场汇报、工作邮件风格）。修正所有口头表达。请直接输出改写后的书面语文本，不要带任何多余的解释、寒暄或格式说明。",
  concise: "你是一个文本精简专家。请提炼以下识别文本的核心信息，去掉无意义的修饰和废话，用最少、最直接的文字进行表达。请直接输出精简后的结果，不带任何附加分析。",
  academic: "你是一个学术与技术文档润色专家。请将以下识别文本改写为专业、严谨、学术化的表达方式，纠正术语，提升用词的精确度。请直接输出最终结果，不要作任何额外说明。"
};

export async function refineText(text: string, config: LLMConfig): Promise<string> {
  if (!config.apiKey) {
    throw new Error("请先在设置中配置 LLM API Key。");
  }

  let systemPrompt = STYLE_PROMPTS[config.promptStyle] || STYLE_PROMPTS.natural;

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
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const MAX_RETRIES = 2;
  const TIMEOUT_MS = 15000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `原始识别文本为：\n"""\n${text}\n"""` }
          ],
          temperature: 0.3,
          max_tokens: 1000
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
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
