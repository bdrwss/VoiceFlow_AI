## 1. 整体方案概述
本项目采用「Rust 侧用 `Result<T, String>` 返回错误字符串，前端通过 Tauri invoke 的 Promise reject 捕获；前端自身使用 `try/catch` + `console.error` 记录异常」的轻量策略。没有定义统一的错误类型、错误码或 panic/recover 机制，属于“约定式”而非框架化的错误处理。

## 2. Rust 后端（src-tauri）
- **命令返回值**：所有 `#[tauri::command]` 函数统一返回 `Result<(), String>` 或 `Result<String, String>`，错误信息以 `String` 形式上抛给前端（如 `lib.rs` 中的 `set_listen_key`、`simulate_typing`、`replace_with_ai_text`，以及 `sensevoice.rs` 中的 `download_sensevoice`、`transcribe_sensevoice`）。内部 IO/网络错误通过 `.map_err(|e| e.to_string())?` 转换。
- **下载与解压容错**：`sensevoice.rs` 的 `download_file` 对每个镜像源循环重试（最多 12 次），记录最后一次失败原因并在全部失败后构造包含 `Last error:` 的聚合错误字符串返回；`unpack_tar_bz2_atomic` 在原子替换前校验必需文件存在，缺失则返回明确错误消息。
- **后台线程错误**：全局快捷键监听线程中 `rdev::listen` 的错误通过 `log::error!` 输出，不向上冒泡，避免阻塞主事件循环。
- **应用启动**：`run()` 末尾 `.run(...).expect("error while running tauri application")` 直接 panic，未做优雅降级。

## 3. 前端（React/Tauri）
- **invoke 调用**：Tauri invoke 返回 Promise，前端普遍使用 `.catch(console.error)` 或 `try/catch` 捕获错误，并将错误对象打印到控制台（如 `useSettings.ts`、`App.tsx` 中对 `set_blacklist`、`isEnabled` 等的调用）。
- **状态驱动 UI 反馈**：`App.tsx` 维护 `status: "initializing" | "idle" | "recording" | "transcribing" | "rewriting" | "success" | "error"` 和 `errorMessage` 两个状态，在初始化失败、麦克风启动失败、SenseVoice 推理失败、AI 润色失败等路径设置 `status="error"` 并填充用户可读的错误提示。
- **独立浮窗同步**：当 `status` 变为 `error` 时，通过 `indicatorWin.emit("indicator-state", { status, errorMessage, text })` 将错误状态广播到浮空胶囊窗口，由 CSS 渲染橙色警告图标。
- **日志劫持**：`App.tsx` 在根组件挂载时重写 `console.log/warn/error`，将所有输出追加到内存日志数组（最多保留 99 条），供“设置”面板展示，便于用户排查问题。

## 4. 架构与约定
- **无统一错误类型**：Rust 侧未定义自定义 Error enum，全部以 `String` 作为错误载体；前端也未封装统一的错误类，仅依赖 `err.message` 或原始对象。
- **跨进程边界**：错误从 Rust → Tauri → JS 的传递链为 `Result<T, String>` → Promise reject → `catch(err)`，错误语义在传递过程中被扁平化为字符串。
- **异步流式进度**：模型下载阶段通过 `download-progress` 事件推送 `{ step, progress }`，前端据此更新进度条；下载失败时仍走 `Result` 错误通道。

## 5. 开发者应遵循的规则
1. **Rust 命令一律返回 `Result<T, String>`**，不要 `panic!`，将具体错误原因写入字符串以便前端展示。
2. **前端 invoke 调用必须包裹 try/catch 或 .catch**，禁止吞掉错误；如需向用户展示，请同时设置 `status="error"` 和 `errorMessage`。
3. **对用户可见的错误消息必须是中文且可操作**（例如提示检查网络、重新下载模型），避免直接透传底层堆栈。
4. **后台线程错误只记录日志**（`log::error!`），不得阻塞主循环；需要恢复的场景应通过事件通知前端重试。
5. **不要在顶层 run() 之外使用 expect/unwrap**，以免意外崩溃导致整个桌面应用退出。