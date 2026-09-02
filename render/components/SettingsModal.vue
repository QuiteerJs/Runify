<script setup lang="ts">
import type { Settings } from '../../shared/types'
import {
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
} from 'naive-ui'
import { ref, watch } from 'vue'
import { message } from '../feedback'
import { useSettings } from '../stores/settings'
import EnvEditor from './EnvEditor.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [v: boolean]
}>()

const settings = useSettings()

function clone(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s)) as Settings
}

const draft = ref<Settings>(clone(settings.settings))

// 每次打开都重新克隆。此前只在组件初始化时快照一次，
// 导致在弹窗关闭期间用侧栏「外观」改过主题后，这里仍显示旧档位。
watch(
  () => props.show,
  (v) => {
    if (v)
      draft.value = clone(settings.settings)
  },
)

async function save() {
  await settings.save(draft.value)
  message.success('设置已保存')
  emit('update:show', false)
}
</script>

<template>
  <NModal
    :show="show"
    title="全局设置"
    preset="card"
    style="width: 560px"
    @update:show="v => emit('update:show', v)"
  >
    <div class="flex flex-col gap-2">
      <label class="text-xs text-fg-dim">默认 Shell</label>
      <NInput v-model:value="draft.defaultShell" placeholder="/bin/zsh" />

      <label class="text-xs text-fg-dim">日志上限（滑动窗口行数）</label>
      <NInputNumber v-model:value="draft.logLimit" :min="100" :max="50000" :step="100" />

      <label class="text-xs text-fg-dim">主题</label>
      <NRadioGroup v-model:value="draft.theme">
        <NRadioButton value="dark">
          暗色
        </NRadioButton>
        <NRadioButton value="light">
          亮色
        </NRadioButton>
        <NRadioButton value="system">
          跟随系统
        </NRadioButton>
      </NRadioGroup>

      <label class="text-xs text-fg-dim">全局环境变量</label>
      <EnvEditor v-model="draft.globalEnv" />

      <div class="flex justify-end gap-2 mt-2">
        <NButton @click="emit('update:show', false)">
          取消
        </NButton>
        <NButton type="primary" @click="save">
          保存
        </NButton>
      </div>
    </div>
  </NModal>
</template>
