export interface LLMProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  description?: string;
}

export const LLM_PROVIDERS: LLMProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    description: "性价比极高的国产大模型"
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
    description: "行业标杆 GPT 系列模型"
  },
  {
    id: "moonshot",
    name: "Kimi (月之暗面)",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    description: "Kimi 大模型，擅长长文本"
  },
  {
    id: "baichuan",
    name: "百川智能",
    baseUrl: "https://api.baichuan-ai.com/v1",
    models: ["Baichuan4", "Baichuan3-Turbo", "Baichuan3-Turbo-128k"],
    description: "百川大模型系列"
  },
  {
    id: "yi",
    name: "零一万物 (Yi)",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    models: ["yi-lightning", "yi-large", "yi-medium", "yi-vision"],
    description: "李开复带队开发的 Yi 系列模型"
  },
  {
    id: "siliconflow",
    name: "SiliconFlow (国内版)",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3", "THUDM/glm-4-9b-chat"],
    description: "国内聚合平台，支持多种开源模型"
  },
  {
    id: "siliconflow-global",
    name: "SiliconFlow (国际版)",
    baseUrl: "https://api.siliconflow.com/v1",
    models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3", "meta-llama/Llama-3.3-70B-Instruct"],
    description: "SiliconFlow 国际版节点"
  },
  {
    id: "zhipu",
    name: "智谱 AI (GLM)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus"],
    description: "智谱 GLM 系列，flash 版免费"
  },
  {
    id: "ollama",
    name: "Ollama (本地部署)",
    baseUrl: "http://localhost:11434/v1",
    models: ["qwen2.5:7b", "llama3.1:8b", "gemma2:9b"],
    description: "本地运行，无需 API Key"
  },
  {
    id: "custom",
    name: "自定义 (Custom)",
    baseUrl: "",
    models: [],
    description: "手动填写任何 OpenAI 兼容接口"
  }
];
