[English](./README.md) | [简体中文](./README_zh.md) | [日本語](./README_ja.md)

---

# VoiceFlow AI (音声入力・文章最適化アシスタント)

VoiceFlow AI は、Tauri + React + TypeScript で構築された、スマートな音声入力およびテキスト最適化アシスタントです。

## 主な機能

- **リアルタイム音声認識**: ショートカットキーを長押しすると録音が開始され、カーソル位置にテキストがリアルタイムで入力されます。
- **AI スマート文章最適化**: ショートカットキーを離すと録音が自動的に停止し、入力されたテキストの言い淀みを削除し、文法や句読点を修正し、より自然な表現に AI が最適化します。
- **原文と最適化後の比較**: 「認識された原文」と「AIによる最適化結果」をワンクリックで切り替えて比較できます。
- **カスタマイズ可能なショートカット**: デフォルトでは右 Option (Mac) または右 Ctrl (Windows) の長押しで起動します。設定で変更可能です。
- **多言語対応**: 中国語、英語、および中国語・英語の混在認識をサポートしています。
- **ローカル履歴保存**: 操作履歴（原文＋最適化後のテキスト）は自動的にローカルに保存され、いつでも確認、コピー、削除が可能です。
- **カスタマイズ可能な最適化スタイル**: 複数の最適化スタイル（例：話し言葉から自然な書き言葉へ、簡潔な要約、専門用語の強化など）が組み込まれています。

## 主な利用シーン

- **チャットやメールの迅速な返信**: ショートカットキーを押しながら話し、離すだけで、話し言葉が適切で自然な書き言葉に自動変換されます。手動でのタイピングや修正は不要です。
- **議事録や週報の作成**: 作業の要点を口頭で述べるだけで、AI が断片的な話し言葉を構造化された明確なメモに整理し、文書作成にそのまま利用できます。

## 技術スタック

- **デスクトップコア**: [Tauri](https://tauri.app/) (Rust)
- **フロントエンドレンダリング**: [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **開発言語**: TypeScript
- **状態管理とストレージ**: Tauri Plugin Store

## 開発とビルド

### 推奨される IDE 環境

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### よく使うコマンド

依存関係のインストール:
```bash
npm install
```

開発モードの起動 (Tauri ウィンドウとフロントエンドのホットリロードを含む):
```bash
npm run tauri dev
```

本番用のインストーラーをビルド:
```bash
npm run tauri build
```
