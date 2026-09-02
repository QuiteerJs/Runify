import { defineConfig } from 'electronup'

export default defineConfig(async () => {
  // 用动态 import 加载插件，避免 @quiteer/parser-config 用 esbuild 把配置打包成 CJS 时，
  // 对 unocss/vite、@vitejs/plugin-vue 的默认导出做错误的 __toESM 互操作（导致 default 不是函数）。
  const { default: UnoCSS } = await import('unocss/vite')
  const { default: vue } = await import('@vitejs/plugin-vue')

  return {
    viteConfig: {
      plugins: [UnoCSS(), vue()],
    },
    builderConfig: {
      asar: false,
      icon: 'resources/icon.png',
      mac: {
        icon: 'resources/icon.icns',
        target: [
          {
            target: 'dmg',
          },
        ],
      },
      dmg: {
        background: 'resources/dmg-background.png',
        window: { width: 660, height: 400 },
        iconSize: 100,
        iconTextSize: 12,
        contents: [
          { x: 180, y: 190, type: 'file' },
          { x: 480, y: 190, type: 'link', path: '/Applications' },
        ],
      },
      win: {
        icon: 'resources/icon.ico',
      },
      linux: {
        icon: 'resources/icon.png',
      },
      // 只打包渲染产物 + 运行时真正需要的 node_modules（preload 包通过 createRequire 运行时加载，无法被打进主进程 bundle）
      files: [
        'dist/resource/**/*',
        'node_modules/@quiteer/electron-preload/**/*',
        'package.json',
        'resources/**/*',
      ],
      extraResources: [{ from: 'resources', to: 'resources' }],
    },
  }
})
