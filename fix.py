import codecs

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_code = """
  const retryRefine = async (item: any) => {
    const { id, rawText: text, style } = item;
    if (!settings.apiKey) return;
    const llmConfig = { 
      apiKey: settings.apiKey, 
      baseUrl: settings.baseUrl, 
      model: settings.modelName, 
      promptStyle: style, 
      appName: activeAppRef.current,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens
    };
    
    const refined = await refineText(text, llmConfig);
    updateHistoryItem(id, { refinedText: refined, success: true });
    
    // 自动复制到剪贴板
    try {
      await navigator.clipboard.writeText(refined);
    } catch(e) {
      console.error("Auto copy failed", e);
    }
  };

  const promptStyleLabels: Record<string, string> = {
    natural: "口语",
    formal: "正式",
    concise: "简明",
    academic: "学术"
  };
  const promptStyleKeys = Object.keys(promptStyleLabels);
  
  const cyclePromptStyle = () => {
    const currentIndex = promptStyleKeys.indexOf(settings.promptStyle);
    const nextIndex = (currentIndex + 1) % promptStyleKeys.length;
    updateSetting("promptStyle", promptStyleKeys[nextIndex]);
  };

  // 如果是小药丸窗口，渲染特殊 UI
  if (windowLabel === "indicator") {
    return (
      <div className="indicator-container">
        {status === "recording" && (
          <div className="recording-indicator pulse-animation">
            <Mic size={14} className="text-red" />
"""

lines.insert(692, new_code)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)
