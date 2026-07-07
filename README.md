[English](./README.md) | [简体中文](./README_zh.md) | [日本語](./README_ja.md)

---

# VoiceFlow AI

VoiceFlow AI is an intelligent voice dictation and text refinement assistant built with Tauri, React, and TypeScript.

## Core Features

- **Real-time Voice Recognition**: Hold down a shortcut key to start recording; recognized text streams directly to your cursor's location in real-time.
- **AI Smart Refinement**: Release the shortcut key to stop recording. The AI automatically polishes the spoken text by removing filler words, correcting grammar, fixing punctuation, and improving overall expression.
- **Original vs. Refined Comparison**: One-click toggle to compare the "original recognition result" with the "AI refined text".
- **Customizable Shortcuts**: Long-press Right Option (Mac) or Right Ctrl (Windows) by default to wake up the assistant. Fully customizable.
- **Multi-language Support**: Supports Chinese, English, and mixed Chinese-English recognition.
- **Local History**: Interaction history (both original and refined text) is automatically saved locally. View, copy, or delete it anytime.
- **Custom Refinement Styles**: Built-in refinement styles (e.g., Natural Speech to Formal Writing, Concise Summary, Professional Terminology Enhancement, etc.).

## Key Scenarios

- **Quick Replies (Chat/Email)**: Hold the shortcut to speak, release to automatically convert colloquial speech into fluent and proper written language. No manual typing or editing required.
- **Meeting Notes / Weekly Reports**: Dictate your key points verbally. The AI organizes fragmented speech into structured, clear written notes, ready to be pasted into your documents.

## Tech Stack

- **Desktop Core**: [Tauri](https://tauri.app/) (Rust)
- **Frontend Rendering**: [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: TypeScript
- **State & Storage**: Tauri Plugin Store

## Development & Build

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### Common Commands

Install dependencies:
```bash
npm install
```

Run in development mode (includes Tauri window and frontend HMR):
```bash
npm run tauri dev
```

Build the production installer:
```bash
npm run tauri build
```
