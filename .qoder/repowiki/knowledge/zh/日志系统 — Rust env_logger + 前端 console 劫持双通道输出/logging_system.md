本仓库采用前后端分离的日志策略：Rust 后端使用 `log` facade + `env_logger`，前端通过劫持 `console.*` 将浏览器控制台输出收集到 React 状态并在 UI 中展示。两者互不耦合，各自独立运行。

## 1. 使用的系统与框架
- **Rust 后端**：`log` crate（抽象层）+ `env_logger::init()`（初始化器），在 Tauri `run()` 入口调用，按环境变量控制级别。
- **前端**：无专用日志库，直接在 `src/App.tsx` 中用 `useEffect` 保存原始 `console.log/warn/error` 引用并替换为自定义实现，把消息格式化后追加到本地 `logs` 状态数组（最多保留最近 99 条），同时仍转发给原 `console` 以保留 DevTools 输出。

## 2. 关键文件与位置
- `src-tauri/src/lib.rs`：Tauri 应用入口，调用 `env_logger::init()`；全局快捷键监听回调中使用 `info!` / `error!` 宏记录事件与异常。
- `src/App.tsx`：前端日志劫持逻辑所在，负责时间戳、类型标签 `[LOG]/[WARN]/[ERROR]` 拼接与 UI 渲染。
- `log.txt`：根目录下的运行时日志文件（由外部 WebSocket/ASR 服务写入，非本应用直接产生）。

## 3. 架构与约定
- **后端日志**
  - 仅在 `run()` 中调用一次 `env_logger::init()`，未设置 `RUST_LOG` 时默认输出 `info` 及以上级别。
  - 使用结构化字段风格：`info!("Shortcut pressed event emitted! App: {:?}", app_name)`，便于 grep 过滤。
  - 错误路径统一走 `error!`，如按键监听线程启动失败。
- **前端日志**
  - 所有业务调试点直接使用 `console.log/warn/error`，无需额外封装；统一被 `App` 组件拦截并持久化到内存数组。
  - 日志条目格式固定为 `[HH:mm:ss] [TYPE] message`，便于在 UI 面板中快速定位。
  - 仅保留最近 99 条，避免长时间运行导致内存膨胀。

## 4. 开发者应遵循的规则
- **Rust 侧**
  - 新增日志一律通过 `log::{info,error}` 宏，不要直接 `println!`。
  - 在关键流程（快捷键命中、黑名单拦截、AI 替换、SenseVoice 下载）必须记录带上下文字段的 `info!`；异常捕获使用 `error!`。
  - 如需调整输出级别，通过环境变量 `RUST_LOG=debug|info|warn|error` 控制，不要在代码里硬编码级别。
- **前端侧**
  - 继续直接使用 `console.log/warn/error` 进行调试，无需引入第三方 logger。
  - 若需向用户可见的“日志面板”输出，优先使用已劫持的 `console.*`，避免重复实现。
  - 不要在 `console` 中打印敏感信息（密钥、剪贴板原文等）。
- **通用**
  - 根目录 `log.txt` 由外部 ASR WebSocket 服务生成，不属于本应用日志子系统，不应由本仓库代码写入。
