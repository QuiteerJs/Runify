<script setup lang="ts">
import type { Project } from '../../shared/types'
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  x: number
  y: number
  project: Project
  packageId: string | null
  running: boolean
}>()
const emit = defineEmits<{
  run: []
  stop: []
  editEnv: []
  editNote: []
  openFolder: []
  copyPath: []
  openTerminal: []
  refresh: []
  remove: []
  close: []
}>()

function onDocClick() {
  emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}

onMounted(() => {
  // 延迟到下一帧再绑定，避免被本次右键的默认行为误触发
  window.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="fixed z-[3000] bg-bg-elevated border border-line rounded-lg p-1 min-w-[170px] shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
  >
    <div class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('run')">
      运行…
    </div>
    <div v-if="running" class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('stop')">
      停止
    </div>
    <div class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('editEnv')">
      编辑环境变量
    </div>
    <div class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('editNote')">
      编辑备注
    </div>
    <div class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('openFolder')">
      打开文件夹
    </div>
    <div class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('copyPath')">
      复制路径
    </div>
    <div class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('openTerminal')">
      打开终端
    </div>
    <div class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white" @click="emit('refresh')">
      刷新脚本
    </div>
    <div
      class="p-1.5 rounded-md text-[13px] cursor-pointer flex justify-between items-center hover:bg-accent hover:text-white hover:!bg-danger"
      @click="emit('remove')"
    >
      删除
    </div>
  </div>
</template>
