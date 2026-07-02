## 1. 使用的系统与工具

- **Tauri v2 应用清单**：`src-tauri/tauri.conf.json`，声明产品名称、版本、窗口布局、CSP、打包图标与 NSIS 语言等。
- **Rust 包清单**：`src-tauri/Cargo.toml`，定义 crate 名、依赖（rdev、enigo、arboard、reqwest 等）与 release profile。
- **Node 工程清单**：`package.json`，定义脚本、依赖与 `@tauri-apps/*` 插件。
- **能力与权限**：`src-tauri/capabilities/default.json`，通过 JSON Schema 约束的 Capability 文件控制 Webview 可调用能力。
- **版本同步脚本**：`scripts/sync-version.cjs`，将 `package.json` 的版本同步到 `tauri.conf.json` 和 `Cargo.toml`。

## 2. 关键文件与位置

- `src-tauri/tauri.conf.json` — 应用元数据、窗口、安全策略、打包资源
- `src-tauri/Cargo.toml` — Rust 依赖与编译选项
- `src-tauri/capabilities/default.json` — 能力与权限白名单
- `src/hooks/useSettings.ts` — 前端统一 Settings 模型与持久化逻辑
- `src/components/SettingsPanel.tsx` — 用户编辑界面的设置面板
- `src-tauri/src/lib.rs` — Rust 侧 AppState 内存状态（快捷键、黑名单）
- `scripts/sync-version.cjs` — 多配置文件版本同步

## 3. 架构与设计约定

### 3.1 构建期配置（静态）
- 所有构建期常量（产品名、版本号、窗口尺寸、CSP、图标路径、NSIS 语言等）集中在 `tauri.conf.json`；Rust 端通过 `tauri::generate_context!()` 在编译期注入。
- 版本来源单一权威：`package.json` 中的 `version` 字段，发布前执行 `npm run version` 调用 `scripts/sync-version.cjs`，自动把该值写入 `tauri.conf.json` 与 `Cargo.toml` 的 `[package]` 段，避免三处版本不一致。

### 3.2 运行时配置（用户设置）
- 前端使用一个统一的 `Settings` 接口（`apiKey`、`baseUrl`、`modelName`、`promptStyle`、`listenKey`、`asrLanguage`、`whisperModel`、`inferenceDevice`、`asrEngine`、`asrApiUrl`、`asrApiKey`、`asrApiModel`、`blacklistStr`），默认值集中定义在 `useSettings.ts` 中。
- 持久化存储采用浏览器 `localStorage`，键名为 `vf_settings`（JSON 对象）。为兼容旧版单 key 存储，加载时会自动迁移到统一结构。
- 保存流程：点击“保存配置”后，`saveSettings()` 将当前 `settings` 序列化写入 `vf_settings`，同时回写 `vf_listen_key` 以便旧路径仍可读取。
- 跨进程同步：当 `listenKey` 变化时，`useEffect` 通过 `invoke("set_listen_key", ...)` 调用 Rust 侧 `set_listen_key` tauri command，更新 `AppState.listen_key`，从而改变全局快捷键监听目标。

### 3.3 Rust 侧运行时状态
- `AppState` 通过 `tauri::State` 管理，包含 `listen_key: RwLock<String>` 与 `blacklist: RwLock<Vec<String>>`，仅驻留于进程内存，重启即丢失。
- 快捷键监听线程通过 `rdev::listen` 阻塞运行，根据 `AppState` 中的目标键与黑名单判断是否触发事件，并通过 `app_handle.emit("shortcut-state", ...)` 向前端推送。

### 3.4 能力与权限配置
- `capabilities/default.json` 以 JSON Schema 形式声明对 `main` 与 `indicator` 两个窗口开放的 core/window/event/webview 权限，遵循 Tauri v2 的最小权限原则。

## 4. 开发者应遵守的规则

1. **新增构建期常量一律放入 `tauri.conf.json`**，不要在 Rust 或前端硬编码。
2. **修改版本号只改 `package.json`**，然后执行 `npm run version` 完成三处同步，禁止手动改 `tauri.conf.json` 或 `Cargo.toml`。
3. **新增用户可配置项**：
   - 先在 `useSettings.ts` 的 `Settings` 接口与 `defaultSettings` 中扩展字段；
   - 在 `SettingsPanel.tsx` 中添加对应 UI 控件；
   - 若需要影响 Rust 行为，通过 `invoke` 调用对应 tauri command 并更新 `AppState`。
4. **敏感信息（API Key）不要写进仓库**，由用户在界面输入后存入 `localStorage`；如需后端访问，请通过 tauri command 传递，不要在前端直接暴露给第三方库。
5. **保持最小权限**：新增能力只在 `capabilities/default.json` 中按需放开，避免全量授予。
6. **黑名单格式约定**：`blacklistStr` 使用逗号或换行分隔的可执行文件名片段，Rust 侧做大小写不敏感子串匹配，新增条目需遵循同一语义。