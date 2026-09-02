<script setup lang="ts">
import type { Project, RunRequest } from '../../shared/types'
import { NButton, NInput, NSelect } from 'naive-ui'
import { computed, ref } from 'vue'
import { buildRunRequest } from '../run-utils'
import { useSettings } from '../stores/settings'

const props = defineProps<{
  project: Project
  packageId: string | null
  scripts: { name: string, command: string }[]
}>()
const emit = defineEmits<{
  run: [req: RunRequest]
}>()

const settings = useSettings()
const script = ref(props.scripts[0]?.name ?? '')
const params = ref('')
const shell = ref('')

const scriptOptions = computed(() =>
  props.scripts.map(s => ({ label: `${s.name}  ·  ${s.command}`, value: s.name })),
)
const shellOptions = computed(() => [
  { label: `默认 (${settings.settings.defaultShell})`, value: '' },
  { label: '/bin/zsh', value: '/bin/zsh' },
  { label: '/bin/bash', value: '/bin/bash' },
  { label: '/bin/sh', value: '/bin/sh' },
])

function submit() {
  if (!script.value)
    return
  emit(
    'run',
    buildRunRequest({
      project: props.project,
      packageId: props.packageId,
      script: script.value,
      shell: shell.value,
      params: params.value,
      defaultShell: settings.settings.defaultShell,
    }),
  )
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <NSelect v-model:value="script" :options="scriptOptions" placeholder="选择脚本" />
    <NInput
      v-model:value="params"
      placeholder="运行参数（追加到命令后，如 -- --host 0.0.0.0）"
    />
    <div class="flex items-center gap-2">
      <NSelect v-model:value="shell" :options="shellOptions" placeholder="Shell" style="flex: 1" />
      <NButton type="primary" @click="submit">
        运行
      </NButton>
    </div>
  </div>
</template>
