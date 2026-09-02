import { defineConfig, presetIcons, presetUno, transformerDirectives, transformerVariantGroup } from 'unocss'

// 把项目现有的 CSS 变量（定义在 style.css 的 .theme-dark/.theme-light）映射成 UnoCSS 颜色，
// 这样 `bg-bg-elevated` / `text-fg` / `border-line` / `text-accent` 等工具类会引用主题变量，自动跟随明/暗主题。

export default defineConfig({
  presets: [
    presetUno(),
    // Iconify 图标：i-<collection>-<icon> 形式，默认用 currentColor（跟随文字颜色）。
    // 已安装 @iconify-json/carbon、@iconify-json/tabler、@iconify-json/lucide 三套图标集。
    // 走 preset-icons 默认加载器（loadNodeIcon 加载已安装的 @iconify-json/*）。
    // tabler 是 stroke-only 风格（fill="none" stroke="currentColor"），默认 auto 模式会走
    // mask 渲染，mask 按 alpha 通道裁切，描边线条（不透明）仍能正常显示——无需自定义 collection。
    presetIcons({
      scale: 1.1,
      extraProperties: {
        'vertical-align': 'middle',
      },
    }),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  // 这些类由 Vue 在运行时通过模板字符串拼接生成（`st-${status}`），
  // 静态扫描看不到，必须显式加入 safelist 才能保证构建期生成对应 CSS。
  // 图标类（i-*）中，部分通过 `:class="item.icon"` 动态绑定（如主导航），也必须 safelist 兜底。
  safelist: [
    'st-idle',
    'st-running',
    'st-success',
    'st-error',
    // 仅出现在当前未接入的 Toolbar.vue 中，提前加入 safelist 以防复用该组件时图标丢失
    'i-carbon-moon',
    'i-carbon-sun',
    // 品牌 logo 图标
    'i-lucide-zap',
    // 侧栏主导航图标
    'i-tabler-home',
    'i-tabler-history',
    'i-tabler-folder',
    'i-tabler-chevron-down',
    'i-carbon-folder-add',
    'i-carbon-package',
    'i-carbon-information',
    'i-lucide-workflow',
    // 账户大菜单图标
    'i-carbon-copy',
    'i-tabler-crown',
    'i-tabler-flame',
    'i-tabler-user-plus',
    'i-tabler-coin',
    'i-tabler-plant',
    'i-tabler-settings',
    'i-tabler-leaf',
    'i-tabler-palette',
    'i-tabler-help',
    'i-tabler-refresh',
    'i-tabler-logout',
    'i-tabler-chevron-right',
    // 卡片运行/备注动态 class（ProjectCard.vue 模板里有 :class 三元但模板里能直接看到，先 safelist 兜底）
    'i-carbon-circle-filled',
    'i-carbon-text-footnote',
    // 环境管理页：卡片图标经 :class 动态绑定（ManagerMeta.icon / PmMeta.icon / RUNTIME_ICONS），静态扫描看不到
    'i-tabler-brand-vite',
    'i-tabler-stack-2',
    'i-tabler-rocket',
    'i-tabler-battery-charging',
    'i-tabler-letter-n',
    'i-tabler-tools',
    'i-tabler-puzzle',
    'i-tabler-package',
    'i-tabler-brand-yarn',
    'i-tabler-bread',
    'i-tabler-box',
    'i-tabler-brand-nodejs',
    'i-tabler-check',
    'i-tabler-trash',
    'i-tabler-arrows-exchange',
    'i-tabler-circle-minus',
  ],
  theme: {
    colors: {
      'bg': 'var(--bg)',
      'bg-elevated': 'var(--bg-elevated)',
      'bg-card': 'var(--bg-card)',
      'line': 'var(--border)',
      'fg': 'var(--text)',
      'fg-dim': 'var(--text-dim)',
      'accent': 'var(--accent)',
      'danger': '#e5484d',
    },
  },
  // 仅保留运行时动态拼接、无法内联到模板的语义类（模板用 `st-${status}` 引用，构建期静态扫描不到）。
  shortcuts: {
    'st-idle': 'text-fg-dim',
    'st-running': 'text-accent border-accent',
    'st-success': 'text-[#34c759] border-[#34c759]',
    'st-error': 'text-danger border-danger',
  },

})
