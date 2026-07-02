本项目采用 Tauri v2 架构，同时维护两套独立的依赖管理系统：前端使用 npm（Node.js），后端使用 Cargo（Rust）。两套系统各自拥有声明式清单与锁定文件，并通过脚本实现跨层版本号同步。

## 1. 使用的系统与工具
- **前端（React + Vite + TypeScript）**：使用 `package.json` 声明依赖，通过 `package-lock.json`（lockfileVersion: 3）锁定精确版本；构建工具链为 Vite 7 + TypeScript 5.8 + @vitejs/plugin-react 4。
- **后端（Tauri v2 + Rust）**：使用 `src-tauri/Cargo.toml` 声明 crate 依赖，通过 `src-tauri/Cargo.lock` 锁定所有传递依赖的精确版本与 checksum。
- **版本同步**：自定义 Node 脚本 `scripts/sync-version.cjs`，在运行 `npm run version` 时把 `package.json` 的版本号同步写入 `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 的 `[package]` 段。

## 2. 关键文件
- `package.json` — 前端依赖声明、脚本入口（dev/build/preview/tauri/version）
- `package-lock.json` — npm 依赖树锁定文件（含 integrity hash）
- `src-tauri/Cargo.toml` — Rust 依赖声明，包含条件编译目标 `cfg(not(any(target_os = "android", target_os = "ios")))` 下的 `tauri-plugin-autostart`
- `src-tauri/Cargo.lock` — Cargo 完整依赖锁定（6900+ 行，含 crates.io checksum）
- `scripts/sync-version.cjs` — 单源版本同步脚本（读取 package.json → 写 tauri.conf.json + Cargo.toml）

## 3. 架构与约定
- **单一版本源**：应用版本号只维护在根 `package.json`，通过 `version` 钩子自动传播到 Tauri 配置与 Cargo 包元数据，避免多端不一致。
- **平台差异化依赖**：Rust 侧通过 `target.'cfg(...)'.dependencies` 仅在桌面平台启用 `tauri-plugin-autostart`，Android/iOS 不引入该 crate。
- **无私有仓库或 vendoring**：未发现 `.npmrc`、`.cargo/config.toml` 中的私有源配置，也未见 vendor 目录；全部依赖来自 npm registry 与 crates.io。
- **构建产物隔离**：前端 `node_modules` 与后端 `src-tauri/target` 分别由各自包管理器缓存，互不影响。

## 4. 开发者应遵循的规则
- 新增/升级依赖时，仅修改对应层的清单文件（`package.json` 或 `src-tauri/Cargo.toml`），不要手动编辑 lock 文件。
- 变更应用版本号时，统一执行 `npm run version`，确保 `tauri.conf.json` 与 `Cargo.toml` 的版本字段保持同步。
- 若需按平台裁剪依赖，沿用 `target.'cfg(...)'.dependencies` 的条件语法，而非在运行时判断。
- 由于未配置私有 npm/crates 镜像，CI 环境需保证能访问公网 npm registry 与 crates.io。