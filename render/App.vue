<script setup lang="ts">
import { darkTheme, NConfigProvider } from 'naive-ui'
import { computed, onMounted } from 'vue'
import MainView from './components/MainView.vue'
import { useTheme } from './composables/useTheme'
import { api } from './ipc'
import { useProjects } from './stores/projects'

const projects = useProjects()
// 主题的解析、落盘、DOM 副作用全部收敛在 useTheme 里；
// 这里只消费最终明暗，不再自己维护 systemDark / isDark / watch
const { isDark, init, applySystemTheme } = useTheme()

const theme = computed(() => (isDark.value ? darkTheme : null))

const themeOverrides = {
  common: {
    primaryColor: '#34c759',
    primaryColorHover: '#4cd964',
    primaryColorPressed: '#28a745',
    primaryColorSuppl: '#4cd964',
    borderRadius: '8px',
  },
}

onMounted(async () => {
  // 首帧明暗已由 index.html 的内联脚本按上次缓存定好，
  // init() 只是用主进程的真实档位校正（正常情况下无可见跳变）
  await Promise.all([init(), projects.load()])
  api.onEvent((ev) => {
    // 系统外观变化 / 其它窗口切档，交给 useTheme 统一处理
    if (ev.kind === 'theme-changed')
      applySystemTheme({ dark: ev.dark, themeSource: ev.themeSource })
    else
      projects.handleEvent(ev)
  })
})
</script>

<template>
  <NConfigProvider :theme="theme" :theme-overrides="themeOverrides">
    <div class="h-screen w-screen flex flex-col transition-colors duration-200 overflow-hidden">
      <MainView />
    </div>
  </NConfigProvider>
</template>
