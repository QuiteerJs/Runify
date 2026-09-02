<script setup lang="ts">
import type { EnvVar, Project } from '../../shared/types'
import { NButton, NModal } from 'naive-ui'
import { ref } from 'vue'
import { message } from '../feedback'
import { api } from '../ipc'
import { useProjects } from '../stores/projects'
import EnvEditor from './EnvEditor.vue'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: [], saved: [] }>()

const projects = useProjects()
const env = ref<EnvVar[]>(JSON.parse(JSON.stringify(props.project.env)))

async function loadDotEnv() {
  const vars = await api.readEnv(`${props.project.path}/.env`)
  const merged = [...env.value]
  for (const [k, v] of Object.entries(vars)) {
    if (!merged.find(e => e.key === k))
      merged.push({ key: k, value: v, enabled: true })
  }
  env.value = merged
  message.success(`已从 .env 载入 ${Object.keys(vars).length} 项`)
}

async function save() {
  await projects.updateProject(props.project.id, { env: env.value })
  message.success('环境变量已保存')
  emit('saved')
}
</script>

<template>
  <NModal
    :show="true"
    title="编辑环境变量"
    preset="card"
    style="width: 560px"
    @update:show="v => !v && emit('close')"
  >
    <div class="flex flex-col gap-3">
      <div class="flex justify-between items-center">
        <NButton size="small" @click="loadDotEnv">
          从 .env 载入
        </NButton>
        <span class="text-xs text-fg-dim">修改仅作用于本工程</span>
      </div>
      <EnvEditor v-model="env" />
      <div class="flex justify-end gap-2">
        <NButton @click="emit('close')">
          取消
        </NButton>
        <NButton type="primary" @click="save">
          保存
        </NButton>
      </div>
    </div>
  </NModal>
</template>
