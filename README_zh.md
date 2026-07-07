[English](./README.md) | [简体中文](./README_zh.md) | [日本語](./README_ja.md)

---

# VoiceFlow AI (语音随写・智能听写助手)

VoiceFlow AI 是一款基于 Tauri + React + TypeScript 构建的智能语音听写与文本优化助手。

## 核心功能

- **实时语音识别**：按住快捷键启动录音，文字实时流式输入到当前光标所在位置。
- **AI 智能润色**：松开快捷键自动停止录音，并调用 AI 对刚输入的文字进行去口语化、纠正语法、调整标点及优化表达。
- **原文与优化对比**：支持“原始识别结果”与“AI优化结果”的一键切换和对比。
- **自定义快捷键**：默认使用右 Option (Mac) / 右 Ctrl (Windows) 长按唤醒，支持自定义。
- **多语言支持**：支持中文、英文及中英混合识别。
- **本地历史记录**：交互记录（原文+优化文本）自动本地保存，随时查看、复制或删除。
- **自定义优化风格**：内置多种优化风格（如自然口语转通顺书面语、精简摘要、专业术语强化等）。

## 核心使用场景

- **聊天/邮件快速回复**：按住快捷键说话，松开后自动将口语转化为通顺得体的书面表达，无需手动打字和二次修改。
- **会议记录/周报**：口述工作要点，AI 自动将碎片化的口语整理成结构清晰的书面笔记，直接用于文档编写。

## 技术栈

- **桌面核心层**：[Tauri](https://tauri.app/) (Rust)
- **前端渲染层**：[React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **开发语言**：TypeScript
- **状态与存储**：Tauri Plugin Store

## 开发与构建

### 推荐 IDE 设置

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### 常用命令

安装依赖:
```bash
npm install
```

启动开发模式 (包含 Tauri 窗口及前端热更新):
```bash
npm run tauri dev
```

构建生产版本安装包:
```bash
npm run tauri build
```
