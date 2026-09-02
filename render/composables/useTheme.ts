import type { SystemTheme, ThemeMode } from '../../shared/types'
import { computed, ref, watch } from 'vue'
import { initFeedback } from '../feedback'
import { api } from '../ipc'
import { useSettings } from '../stores/settings'

/**
 * 主题全局状态机 —— 全应用唯一数据源。
 *
 * 在此之前主题状态散落在三处：App.vue 用 systemDark + isDark + watch 推算、
 * Sidebar.vue 的 setTheme 直接改 store、SettingsModal.vue 另存一份独立的 theme ref。
 * 三者互不通信，导致「设置弹窗里显示的是打开瞬间的旧值」这类不一致。
 * 这里把它们收敛成一个模块级单例：任何组件拿到的都是同一份状态。
 *
 * 明暗解析链路：
 *   用户档位 themeMode（light / dark / system）
 *     → 结合系统实际明暗 systemDark
 *     → 解析出 isDark
 *     → watch 自动调 apply()，落到 <html> 的 class / data-theme / color-scheme
 *
 * 持久化：themeMode 存在 <userData>/runify-settings.json（主进程权威），
 * 同时把「解析后的明暗」镜像到 localStorage，仅供下次启动首帧防闪烁使用。
 */

/** 启动首帧主题镜像的 key，必须与 index.html 内联脚本中的保持一致 */
const CACHE_KEY = 'runify:theme-cache'

/** 与 style.css 的 --bg、main/index.ts 的 WINDOW_BG 保持一致 */
const ROOT_BG = { dark: '#16171a', light: '#f3f4f6' } as const

// 模块级单例状态。放在函数体里会随每次 useTheme() 调用重建，
// 各组件就会各持一份互不相干的主题。
const themeMode = ref<ThemeMode>('system')
const systemDark = ref(false)
const ready = ref(false)

/** 已应用到 DOM 的明暗，用于跳过重复渲染（apply 会被多条路径调用） */
let appliedDark: boolean | null = null

/** 解析后的实际明暗：dark 恒深、light 恒浅、system 跟随操作系统 */
const isDark = computed(() =>
  themeMode.value === 'system' ? systemDark.value : themeMode.value === 'dark',
)

/**
 * 把明暗结果落到 <html> 上。
 *
 * 必须挂在 documentElement，不能只挂在 #app 内的容器上 ——
 * NaiveUI 的 popover / modal / dropdown 会 teleport 到 body 下，
 * 脱离容器作用域后拿不到 CSS 变量，会解析成 transparent（浮层背景透底）。
 */
function apply(dark: boolean): void {
  // 幂等：setTheme 的乐观更新与回执校正、系统事件、init 都会走到这里，
  // 重复的 initFeedback 会销毁并重建反馈层单例，必须挡掉
  if (appliedDark === dark)
    return
  appliedDark = dark

  const el = document.documentElement
  el.classList.toggle('theme-dark', dark)
  el.classList.toggle('theme-light', !dark)
  // data-theme 供原生样式与调试；color-scheme 让滚动条、表单控件等原生 UI 跟随
  el.dataset.theme = dark ? 'dark' : 'light'
  el.style.colorScheme = dark ? 'dark' : 'light'
  el.style.backgroundColor = ROOT_BG[dark ? 'dark' : 'light']

  // 下次启动的首帧在 Vue 挂载前就要定色，只能靠这份同步可读的镜像
  try {
    localStorage.setItem(CACHE_KEY, dark ? 'dark' : 'light')
  }
  catch {
    // 隐私模式下 localStorage 可能不可写，只影响下次启动首帧，不阻断主题生效
  }

  // 反馈层是离散 API，不随 NConfigProvider 继承主题，需主动重建
  initFeedback(dark)
}

// 唯一的应用点：无论档位是被用户点按钮改的、系统外观变化触发的，
// 还是设置弹窗整份回写带过来的，只要解析结果变了视觉就会跟上。
// ready 之前不自动应用 —— init() 里 systemDark 与 themeMode 是先后赋值的，
// 中间态会多触发一次无意义的重绘，由 init 结束后一次性 apply 真实结果。
watch(isDark, (dark) => {
  if (ready.value)
    apply(dark)
})

/** 系统外观变化 / 其它窗口切档后的同步入口（由 App.vue 的事件分发转交） */
function applySystemTheme(snap: SystemTheme): void {
  systemDark.value = snap.dark
  // 档位本身也可能被别处改动（多窗口、设置弹窗回写），以主进程为准
  if (snap.themeSource !== themeMode.value)
    themeMode.value = snap.themeSource
}

let initPromise: Promise<void> | null = null

async function init(): Promise<void> {
  // 幂等：多个组件挂载时都调 init 也只加载一次
  if (initPromise)
    return initPromise

  initPromise = (async () => {
    const settings = useSettings()
    await settings.load()
    // 主进程已在 initState() 里把持久化的档位写进 nativeTheme，
    // 这里读到的 dark 是「按用户档位解析后」的最终结果
    const snap = await api.getSystemTheme()
    systemDark.value = snap.dark
    themeMode.value = settings.settings.theme
    // 用真实档位一次性应用（此时 ready 仍为 false，watch 不会插手）
    apply(isDark.value)
    ready.value = true
  })()

  return initPromise
}

async function setTheme(mode: ThemeMode): Promise<void> {
  const settings = useSettings()

  // 先乐观更新本地：UI 立刻响应，不等 IPC 往返（watch 会自动 apply）
  themeMode.value = mode

  try {
    // 走独立的 setTheme 通道而非整份 Settings 回写，
    // 避免把 SettingsModal 里尚未保存的草稿一并提交
    const snap = await api.setTheme(mode)
    // 用主进程回执校正：Electron 解析出的档位才是权威值
    systemDark.value = snap.dark
    themeMode.value = snap.themeSource
    settings.patch({ theme: mode })
  }
  catch {
    // 落盘失败时保留本地状态：本次会话仍然生效，下次启动回退到上次的值
  }
}

export function useTheme() {
  return {
    /** 用户选择的档位：light / dark / system */
    themeMode: computed(() => themeMode.value),
    /** 系统当前实际明暗（仅 system 档位参与最终解析） */
    systemDark: computed(() => systemDark.value),
    /** 解析后的最终明暗 */
    isDark,
    /** 是否已完成初始化 */
    ready: computed(() => ready.value),
    init,
    setTheme,
    applySystemTheme,
  }
}
