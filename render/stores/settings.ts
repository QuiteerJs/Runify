import type { Settings } from '../../shared/types'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../ipc'

export const useSettings = defineStore('settings', () => {
  const settings = ref<Settings>({
    defaultShell: '/bin/zsh',
    globalEnv: [],
    logLimit: 2000,
    theme: 'system',
  })

  async function load(): Promise<void> {
    settings.value = await api.getSettings()
  }

  async function save(s: Settings): Promise<void> {
    settings.value = s
    await api.saveSettings(s)
  }

  /**
   * 只更新部分字段（不落盘）。
   * 供主题这类「已通过专用通道持久化」的字段使用：
   * 内存里要跟上，但不能再走 save() 整份回写，否则会覆盖掉别处的并发编辑。
   */
  function patch(p: Partial<Settings>): void {
    settings.value = { ...settings.value, ...p }
  }

  return { settings, load, save, patch }
})
