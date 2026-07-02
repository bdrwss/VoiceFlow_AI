本项目采用 Tauri v2 作为桌面应用宿主，前端基于 React + TypeScript + Vite，后端使用 Rust。构建流程由 npm scripts 驱动，通过 @tauri-apps/cli 统一协调前后端编译、打包与分发。

## 1. 构建系统组成
- 前端构建：Vite 7 + @vitejs/plugin-react，TypeScript 5.8 类型检查在 build 前执行（tsc && vite build）。
- Rust 后端构建：Cargo 管理，src-tauri/Cargo.toml 声明依赖与 release profile（strip/lto/opt-level=z/codegen-units=1/panic=abort）。
- Tauri 编排：src-tauri/tauri.conf.json 定义 beforeDevCommand/beforeBuildCommand、frontendDist、窗口配置、bundle targets（all）及 NSIS 安装器语言。
- 版本同步脚本：scripts/sync-version.cjs 将 package.json 的 version 同步写入 tauri.conf.json 与 Cargo.toml，通过 npm version 钩子自动触发。

## 2. 关键文件与职责
- package.json：定义 dev/build/preview/tauri/version 脚本，锁定 @tauri-apps/cli ^2、@tauri-apps/api ^2 等依赖
- vite.config.ts：固定开发端口 1420，HMR 走 ws://localhost:1421，忽略 src-tauri/** 变更，代理 /hf 到 hf-mirror.com 下载 ONNX 模型
- src-tauri/Cargo.toml：Rust crate 元数据、lib 输出 staticlib/cdylib/rlib、release profile 优化参数
- src-tauri/tauri.conf.json：应用名、标识符、双窗口（main + indicator）、CSP、bundle targets=all、NSIS 中文语言包
- src-tauri/build.rs：调用 tauri_build::build() 生成能力/权限 schema
- scripts/sync-version.cjs：单源版本管理：修改 package.json 后自动同步至 tauri.conf.json 与 Cargo.toml

## 3. 构建与运行命令
- npm run tauri dev：开发模式（Vite HMR + Tauri 热重载）
- npm run tauri build：生产构建（先 tsc + vite build，再 tauri build）
- npm run build：仅前端构建产物 → dist/
- npm version patch：版本递增并同步

## 4. 架构约定与设计决策
- 单源版本：所有版本号以 package.json 为准，通过 npm version 钩子保证 Tauri 与 Cargo 一致，避免多配置文件漂移。
- 跨平台打包：bundle.targets = "all" 同时产出 Windows (NSIS)、macOS (dmg)、Linux (AppImage/deb)；Windows 安装器内置 SimplChinese 语言。
- 开发体验：Vite 监听时排除 src-tauri/**，避免 Rust 重编译拖慢前端热更新；HF 镜像代理解决国内 ONNX 模型下载问题。
- 安全默认：CSP 限制 connect-src/img-src/script-src/worker-src，仅允许 self + https + localhost:* + blob:data。
- 发布优化：Rust release 开启 strip/lto/opt-level=z/codegen-units=1/panic=abort，最小化二进制体积。

## 5. 开发者应遵循的规则
1. 改版本号只动 package.json，不要手动编辑 tauri.conf.json 或 Cargo.toml 中的 version 字段。
2. 新增 Rust 依赖需在 src-tauri/Cargo.toml 中声明，注意按目标平台条件编译（如 cfg(not(any(target_os = "android", target_os = "ios")))）。
3. 新增前端资源放入 public/，确保 CSP 白名单已覆盖新域名（尤其是 ASR/LLM API）。
4. 自定义窗口行为在 tauri.conf.json 的 app.windows[] 中配置，保持 main 与 indicator 窗口职责分离。
5. 不直接调用 tauri CLI，始终通过 npm run tauri <cmd> 进入，确保环境变量与脚本链完整。