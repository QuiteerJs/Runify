<script setup lang="ts">
import type { Project, RunRequest } from '../../shared/types'
import { NButton, NModal, NTag } from 'naive-ui'
import { computed, ref } from 'vue'
import { message } from '../feedback'
import { buildRunRequest } from '../run-utils'
import { useProjects } from '../stores/projects'
import { useSettings } from '../stores/settings'
import RunForm from './RunForm.vue'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: [] }>()

const projects = useProjects()
const settings = useSettings()

interface Row {
  packageId: string | null
  packageName: string
  script: string
  command: string
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const s of props.project.scripts)
    out.push({ packageId: null, packageName: props.project.name, script: s.name, command: s.command })
  for (const pkg of props.project.packages) {
    for (const s of pkg.scripts)
      out.push({ packageId: pkg.id, packageName: pkg.name, script: s.name, command: s.command })
  }
  return out
})

function runningId(r: Row): string | null {
  return projects.activeRunId(props.project.id, r.packageId)
}

async function runRow(r: Row, params = '', shell = '') {
  const req = buildRunRequest({
    project: props.project,
    packageId: r.packageId,
    script: r.script,
    shell,
    params,
    defaultShell: settings.settings.defaultShell,
  })
  await projects.run(req)
  message.info(`启动：${r.packageName} / ${r.script}`)
}
async function stopRow(r: Row) {
  const id = runningId(r)
  if (id) {
    await projects.stop(id)
    message.info('已发送停止信号')
  }
}

// ⚙ 单独配置参数
const cfg = ref<Row | null>(null)
function onCfgRun(req: RunRequest) {
  projects.run(req)
  message.info(`启动：${cfg.value?.packageName} / ${cfg.value?.script}`)
  cfg.value = null
}
</script>

<template>
  <NModal
    :show="true"
    :title="`运行 · ${project.name}`"
    preset="card"
    style="width: 720px; max-width: 94vw"
    @update:show="v => !v && emit('close')"
  >
    <div class="flex flex-col gap-2.5">
      <div class="flex justify-between items-center text-xs text-fg-dim">
        <span>共 {{ rows.length }} 条脚本</span>
        <span>点「运行」直接按默认设置启动；<i class="i-carbon-settings" /> 可先配置参数 / Shell</span>
      </div>

      <div class="border border-line rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
        <div class="grid grid-cols-[140px_120px_1fr_auto] gap-2 items-center p-2 px-2.5 border-b border-line text-[13px] last:border-b-0 bg-bg-elevated font-semibold text-fg-dim sticky top-0">
          <span>包</span>
          <span class="font-semibold">脚本</span>
          <span class="text-fg-dim break-all font-mono">命令</span>
          <span class="flex gap-1.5 justify-end">操作</span>
        </div>
        <div v-for="r in rows" :key="`${r.packageId ?? 'root'}::${r.script}`" class="grid grid-cols-[140px_120px_1fr_auto] gap-2 items-center p-2 px-2.5 border-b border-line text-[13px] last:border-b-0">
          <span>
            <NTag size="small" :bordered="false">
              {{ r.packageName }}
            </NTag>
          </span>
          <span class="font-semibold">{{ r.script }}</span>
          <span class="text-fg-dim break-all font-mono">{{ r.command }}</span>
          <span class="flex gap-1.5 justify-end">
            <template v-if="runningId(r)">
              <NButton size="small" type="warning" @click="stopRow(r)">
                停止
              </NButton>
            </template>
            <template v-else>
              <NButton size="small" type="primary" @click="runRow(r)">
                运行
              </NButton>
              <NButton size="small" tertiary @click="cfg = r">
                <i class="i-carbon-settings" />
              </NButton>
            </template>
          </span>
        </div>
        <div v-if="!rows.length" class="p-4 text-center text-fg-dim">
          未检测到脚本
        </div>
      </div>
    </div>

    <NModal
      v-if="cfg"
      :show="true"
      title="配置运行参数"
      preset="card"
      style="width: 460px"
      @update:show="v => !v && (cfg = null)"
    >
      <RunForm
        :project="project"
        :package-id="cfg.packageId"
        :scripts="[{ name: cfg.script, command: cfg.command }]"
        @run="onCfgRun"
      />
    </NModal>
  </NModal>
</template>
