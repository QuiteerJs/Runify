# Changelog

## [0.1.0](https://github.com/QuiteerJs/Runify/compare/runify-v0.0.1...runify-v0.1.0) (2026-09-03)


### Features

* **console:** 终端日志分级着色 + 环境操作完成后按退出码自动回写 ([54beaa2](https://github.com/QuiteerJs/Runify/commit/54beaa20ac2cda1d33a5697428b96cc082be8b75))
* **env:** 升级按钮按当前版本是否等于最新切换「已是最新」态 ([8a278a5](https://github.com/QuiteerJs/Runify/commit/8a278a5010915bfc48b2b82a32545ec503a97d2a))
* **env:** 本机生态概览的 node 卡片补「default: vX」副标 ([e3ffdb8](https://github.com/QuiteerJs/Runify/commit/e3ffdb89c268733ea7688533eea2003114283ed6))
* **env:** 版本管理工具卡片统一加「升级工具」入口 ([27f071a](https://github.com/QuiteerJs/Runify/commit/27f071a9271fc3455485e572fb95537f8960ad34))
* 初始化 Runify 工程管理桌面应用 ([fa4e461](https://github.com/QuiteerJs/Runify/commit/fa4e46120aa170a4723bec34412896d23a2e45c5))


### Bug Fixes

* **build:** 显式声明 electron 依赖并统一链接模式，修复 build 找不到 electron ([0f50a18](https://github.com/QuiteerJs/Runify/commit/0f50a185938841f0f91ef37343d208d39cee7e78))
* **deps:** 修复 pnpm v10 供应链策略拦截与打包签名失败 ([95a5f83](https://github.com/QuiteerJs/Runify/commit/95a5f83e0d3cb23a315871bb6c9054319a6895f1))
* **deps:** 修复 pnpm v10 迁移导致的依赖错配与构建白名单失效 ([ba2f77a](https://github.com/QuiteerJs/Runify/commit/ba2f77af3902afc97bba5a929d74a46503395ef1))
* **deps:** 填平 allowBuilds 占位符，终止 pnpm 反复要求重装 ([69da1df](https://github.com/QuiteerJs/Runify/commit/69da1df084876c6ffaac90e3c848032b662898db))
* **env:** Node 版本切换后「当前激活」标签不变 ([5d0de01](https://github.com/QuiteerJs/Runify/commit/5d0de01d97f2f40e291721a0a8575e5c6cab808e))
* **env:** 一键安装 pnpm/yarn/n/corepack 加 --force，绕过 Corepack shim 的 EEXIST ([e3ba762](https://github.com/QuiteerJs/Runify/commit/e3ba76215a6e9ecc4faaa3cd4caee1e1f61aa7a5))
* **env:** 版本下拉移除滚动懒加载，解决滚动到底回弹顶部 ([1d461e1](https://github.com/QuiteerJs/Runify/commit/1d461e16abff9075d8f01355453e64f54794d501))


### Documentation

* 新增项目 README ([f64e95d](https://github.com/QuiteerJs/Runify/commit/f64e95db12d38e34ad379b4c8729ca59a247a436))
