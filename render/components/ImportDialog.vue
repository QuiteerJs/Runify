<script setup lang="ts">
import { NButton, NInput, NModal } from 'naive-ui'
import { ref } from 'vue'
import { message } from '../feedback'
import { api } from '../ipc'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [v: boolean]
  'pick': [path: string]
}>()
const manual = ref('')

async function pickFolder() {
  const p = await api.pickFolder()
  if (p)
    emit('pick', p)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const p = e.dataTransfer?.files?.[0]?.path
  if (p)
    emit('pick', p)
}

function confirmManual() {
  const p = manual.value.trim()
  if (!p) {
    message.warning('请输入工程路径')
    return
  }
  emit('pick', p)
}
</script>

<template>
  <NModal
    :show="show"
    title="导入工程"
    preset="card"
    style="width: 520px"
    @update:show="v => emit('update:show', v)"
  >
    <div class="flex flex-col gap-3">
      <NButton block type="primary" @click="pickFolder">
        选择文件夹…
      </NButton>
      <div class="border border-dashed border-line rounded-lg p-[22px] text-center text-fg-dim" @drop="onDrop" @dragover.prevent>
        将工程文件夹拖拽到此处
      </div>
      <div class="flex gap-2">
        <NInput
          v-model:value="manual"
          placeholder="或手动输入工程绝对路径，如 /Users/me/my-app"
          @keyup.enter="confirmManual"
        />
        <NButton @click="confirmManual">
          导入
        </NButton>
      </div>
      <p class="text-xs text-fg-dim m-0">
        支持 Vite / Webpack / Turborepo / Monorepo（pnpm-workspace / lerna / yarn
        workspaces）等工程，导入后自动识别类型与脚本。
      </p>
    </div>
  </NModal>
</template>
