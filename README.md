# Runify

本地前端工程统一运行器：导入即识别类型与脚本，一键运行、编排与查看日志。

一个基于 **Electron + Vue 3 + Vite** 构建的桌面应用，把散落在本机的前端工程统一收纳、分类管理，提供脚本运行、任务编排、环境管理三大能力。导入一个目录，Runify 会自动识别工程类型（Vite / Webpack / Vue / React / Monorepo…）、解析 `package.json` 脚本、探测包管理器与 Node 环境，让「跑起来」这件事变得直观可控。

## ✨ 功能特性

- **工程导入与识别**：导入目录即自动扫描，识别工程类型、子包结构、包管理器（由 lock 文件推断）与 git 分支。
- **命令运行**：运行任意 `package.json` 脚本，支持自定义环境变量、额外参数、多实例并发；实时控制台日志（stdout/stderr 分流）、运行时长、退出码、端口探测一应俱全。
- **任务编排**：把多个工程的脚本串成一条流水线，支持串行 / 并行两种执行模式。
- **环境管理**：探测本机 Node 运行时与版本管理工具（nvm / fnm / Volta / n / mise / asdf），支持一键安装、卸载、切换 Node 版本；包管理工具（pnpm / Yarn / bun / Corepack）的安装与升级；官方源 Node 版本列表懒加载 + 模糊搜索。
- **项目详情页**：脚本树、当前命令摘要卡（状态 / 端口 / 时长 / Node 版本 / 退出码）、控制台跟随。
- **主题切换**：明 / 暗 / 跟随系统三档，窗口位置与尺寸记忆。
- **系统集成**：应用菜单、系统托盘、导出运行日志。

## 🛠 技术栈

| 层       | 技术                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面框架 | [Electron](https://www.electronjs.org/) + [electronup](https://github.com/QuiteerJs/electronup)                                                                                        |
| 前端     | [Vue 3](https://vuejs.org/)（Composition API）、[Vite](https://vitejs.dev/)、[Pinia](https://pinia.vuejs.org/)                                                                         |
| UI       | [Naive UI](https://www.naiveui.com/)                                                                                                                                                   |
| 样式     | [UnoCSS](https://unocss.dev/)（presetIcons：Tabler / Carbon / Lucide）                                                                                                                 |
| 代码规范 | [ESLint](https://eslint.org/)（@antfu/eslint-config）、[simple-git-hooks](https://github.com/toplenboren/simple-git-hooks) + [lint-staged](https://github.com/lint-staged/lint-staged) |
| 语言     | TypeScript                                                                                                                                                                             |

## 📋 环境要求

- **Node.js** ≥ 20（项目以 `24.12.0` 锁定，见 `.node-version`）
- **pnpm**（项目使用 pnpm 管理依赖，见 `.npmrc` 与 `pnpm-lock.yaml`）

## 🚀 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

启动后会自动打开 Electron 窗口，并开启 DevTools，渲染层走 Vite HMR 热更新。

### 构建

```bash
# 构建当前平台安装包（默认按 electronup.config.ts 的 target）
pnpm build

# 仅打包产物目录（不生成安装包，适合快速验证）
pnpm build:dir

# 指定平台
pnpm build:mac         # macOS（默认 arm64）
pnpm build:mac-x64     # macOS x64
pnpm build:mac-arm64   # macOS arm64
pnpm build:mac-universal # macOS 通用包
pnpm build:win         # Windows
pnpm build:win64       # Windows x64
pnpm build:win32       # Windows ia32
pnpm build:linux       # Linux
```

构建产物输出到 `dist/out/`。

### 代码检查

```bash
pnpm lint        # 检查
pnpm lint:fix    # 自动修复
```

### 提交

```bash
pnpm commit      # 交互式生成符合 Conventional Commits 规范的提交信息
```

> 提交时 `pre-commit` 会执行 lint-staged 的 `eslint --fix`，`commit-msg` 会校验提交信息是否符合 Conventional Commits 规范，不符合会被拒绝。

## 📁 目录结构

```text
Runify
├── main/                    # Electron 主进程
│   ├── index.ts             #   入口：窗口 / 菜单 / 托盘 / 应用生命周期
│   ├── core/                #   核心逻辑
│   │   ├── env-detect.ts    #     环境探测（Node 运行时 / 版本管理工具 / 官方版本列表）
│   │   ├── port.ts          #     端口探测
│   │   ├── runner.ts        #     命令运行（子进程 / 日志流 / 多实例）
│   │   ├── scanner.ts       #     工程扫描（类型识别 / package.json / .env 解析）
│   │   └── store.ts         #     持久化（工程列表 / 设置 / 窗口状态 / 编排任务）
│   └── ipc/handlers.ts      #   IPC 通道注册
├── render/                  # 渲染进程（Vue 3）
│   ├── components/          #   页面与组件（Sidebar / MainView / 各详情页 / 弹窗…）
│   ├── composables/         #   组合式函数（useTheme 等）
│   ├── stores/              #   Pinia store（projects / settings / tasks）
│   ├── ipc.ts               #   渲染层 IPC 封装
│   └── main.ts / App.vue    #   入口
├── shared/types.ts          # 主进程 / 渲染进程共享的类型与 IPC 通道常量
├── resources/               # 图标 / 托盘 / DMG 背景等静态资源
├── scripts/                 # 辅助脚本（如图标生成）
├── electronup.config.ts     # 构建配置（electronup + electron-builder）
└── uno.config.ts            # UnoCSS 配置（presetIcons 等）
```

## 🧩 架构说明

- **进程划分**：主进程（`main/`）负责工程扫描、命令运行、环境探测与持久化；渲染进程（`render/`）负责 UI 交互。两者通过 `shared/types.ts` 中定义的 `IPC` 通道常量通信，类型共享、编译期擦除、无运行时副作用。
- **命令运行**：主进程用 `spawn` 拉起子进程，stdout / stderr 经 `RunifyEvent` 事件流实时推送到渲染层，日志用滑动窗口（`logLimit`）控制内存占用。
- **环境探测**：走登录 shell（`$SHELL -l -i -c`）执行探测命令，确保 `.zshrc` / `.bashrc` 里初始化的 nvm / fnm 等别名可见；官方 Node 版本列表从 [nodejs.org dist index](https://nodejs.org/dist/index.json) 拉取，主进程缓存 1 小时并带离线兜底。
- **主题**：通过 `nativeTheme.themeSource` 联动系统明暗，窗口底色与 CSS 变量保持一致，避免启动时的白闪。

## 🤝 贡献

欢迎提交 Issue 与 Pull Request。提交代码前请确保 `pnpm lint` 通过，并遵循 Conventional Commits 提交规范。

## 📄 许可

[MIT](./LICENSE)
