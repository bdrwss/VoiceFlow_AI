本仓库前端采用纯 CSS（无 SCSS/LESS、无 Tailwind、无 UI 组件库）配合 CSS 自定义属性（:root 变量）实现统一的深色玻璃拟态视觉风格，所有样式以独立 .css 文件与组件一一对应。

### 1. 使用的系统与工具
- **构建与开发**：Vite + React + TypeScript；样式直接以普通 CSS 引入，无需额外预处理器或插件。
- **图标**：使用 `lucide-react` 作为统一图标源。
- **字体**：通过 Google Fonts 加载 `Outfit` + `Noto Sans SC`，在 `App.css` 的 `@import` 中声明。
- **平台适配**：大量使用 `-webkit-app-region: drag/no-drag` 等 Tauri 专属前缀，说明样式围绕桌面端窗口行为定制。

### 2. 关键样式文件与包
- `src/App.css`：全局重置、`:root` 设计令牌、主布局、状态球、动态岛胶囊、滚动条、错误横幅等核心样式。
- `src/components/HistoryPanel.css`：历史记录卡片列表样式。
- `src/components/SettingsPanel.css`：设置面板分组、输入控件、搜索高亮样式。
- `package.json`：仅依赖 `lucide-react` 作为图标库，无任何 CSS-in-JS 或原子化框架。

### 3. 架构与设计约定
- **设计令牌集中管理**：所有颜色、边框、背景、阴影均定义在 `:root` 下的 CSS 变量（如 `--bg-color`、`--panel-bg`、`--accent-color`、`--accent-gradient`、`--red-neon`、`--green-neon`），组件样式只引用这些变量，保证全局一致性。
- **深色模式固定**：`color-scheme: dark` 与暗色变量值表明应用为“深色优先”，未实现浅色切换逻辑。
- **BEM 风格命名**：类名采用 `block__element--modifier` 的简化形式（如 `app-container`、`tab-pane.active`、`history-card:hover`），语义清晰且避免冲突。
- **组件级样式隔离**：每个组件目录内自带同名 `.css` 文件，由对应 `.tsx` 直接 import，形成“一个组件 = 一个 TSX + 一个 CSS”的一体化组织方式。
- **动效体系**：大量使用 `cubic-bezier(0.25, 0.8, 0.25, 1)` 缓动曲线、`backdrop-filter: blur()` 毛玻璃效果、`box-shadow` 发光与 `transform: scale()` 弹性缩放，营造“霓虹+玻璃”质感。
- **响应式策略**：未使用媒体查询，主要依赖 Flexbox + 百分比宽度 + `max-width` 自适应，适合桌面窗口尺寸而非移动端。

### 4. 开发者应遵循的规则
- **新增颜色/尺寸必须走 CSS 变量**：在 `:root` 中扩展 `--xxx` 变量，禁止在组件 CSS 中硬编码十六进制颜色。
- **保持 BEM 命名规范**：块名用全小写连字符，修饰符用 `.active`、`.recording` 等单点后缀，避免嵌套过深。
- **组件样式文件与组件同名同目录**：新增组件时同步创建 `ComponentName.css` 并在 TSX 中 import。
- **动画缓动统一使用 `cubic-bezier(0.25, 0.8, 0.25, 1)`**：除非特殊需求，否则复用已有 `@keyframes`（如 `pulse-glow`、`fade-in`）。
- **Tauri 拖拽区域标记**：可拖拽区域加 `-webkit-app-region: drag`，内部按钮加 `no-drag`，确保窗口交互正确。
- **不引入第三方 UI 库或 CSS 框架**：当前风格完全自研，新增样式应保持玻璃拟态与霓虹配色基调。