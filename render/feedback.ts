import type { DialogApi, DiscreteApi, MessageApi, NotificationApi } from 'naive-ui'
// 业务反馈层（message / dialog / notification）的全局单例。
//
// 为什么不用 naive-ui 的 useMessage() 组合式 API：
//   useMessage 依赖组件树中的 <n-message-provider> 通过 provide/inject 注入，
// 在 Electron + Vite 渲染进程里（单例 naive-ui 但模块实例/注入时机不稳定）极易出现
// “No outer <n-message-provider /> founded” 的报错。
// 改用 createDiscreteApi 自建一个自包含的离散应用，完全不依赖 provide/inject，
// 任意组件（含 setup 之外）都能直接调用，且跟随全局主题。
import {
  createDiscreteApi,
  darkTheme,

} from 'naive-ui'

const themeOverrides = {
  common: {
    primaryColor: '#34c759',
    primaryColorHover: '#4cd964',
    primaryColorPressed: '#28a745',
    primaryColorSuppl: '#4cd964',
    borderRadius: '8px',
  },
}

type FeedbackApi = DiscreteApi<'message' | 'dialog' | 'notification'>

let isDark = true
let api: FeedbackApi | null = null

function build(): FeedbackApi {
  return createDiscreteApi(['message', 'dialog', 'notification'], {
    configProviderProps: {
      theme: isDark ? darkTheme : null,
      themeOverrides,
    },
  })
}

export function initFeedback(dark: boolean): FeedbackApi {
  isDark = dark
  if (api) {
    api.message.destroyAll()
    api.notification.destroyAll()
  }
  api = build()
  return api
}

export function getFeedback(): FeedbackApi {
  if (!api)
    return initFeedback(true)
  return api
}

function makeProxy(key: 'message' | 'dialog' | 'notification') {
  return new Proxy({} as Record<string, (...args: any[]) => any>, {
    get: (_t, prop: string) => (...args: any[]) =>
      (getFeedback() as any)[key][prop](...args),
  })
}

export const message = makeProxy('message') as MessageApi
export const dialog = makeProxy('dialog') as DialogApi
export const notification = makeProxy('notification') as NotificationApi
