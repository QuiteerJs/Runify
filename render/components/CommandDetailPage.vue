<script setup lang="ts">
import type { ProjectStatus } from '../../shared/types'
import { NButton } from 'naive-ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { message } from '../feedback'
import { api } from '../ipc'
import { buildRunRequest } from '../run-utils'
import { useProjects } from '../stores/projects'
import { useSettings } from '../stores/settings'
import ConsolePanel from './ConsolePanel.vue'

/**
 * 命令详情页：侧栏单击某条命令后，主区展示「运行摘要条 + 控制台」。
 * 导航职责已移交侧栏，这里不再有脚本树。
 */
const props = defineProps<{
  target: { projectId: string, packageId: string | null, scriptName: string }
}>()
const emit = defineEmits<{ close: [] }>()

const projects = useProjects()
const settings = useSettings()

const project = computed(() =>
  projects.projects.find(p => p.id === props.target.projectId),
)
const pkgObj = computed(() =>
  props.target.packageId
    ? project.value?.packages.find(x => x.id === props.target.packageId) ?? null
    : null,
)
const scriptObj = computed(() => {
  const list = props.target.packageId ? (pkgObj.value?.scripts ?? []) : (project.value?.scripts ?? [])
  return list.find(s => s.name === props.target.scriptName) ?? null
})
/** 展示名：子包脚本用「包名:脚本」与侧栏一致 */
const displayName = computed(() =>
  props.target.packageId
    ? `${pkgObj.value?.name ?? '?'}:${props.target.scriptName}`
    : props.target.scriptName,
)
const path = computed(() =>
  pkgObj.value ? pkgObj.value.absolutePath : (project.value?.path ?? ''),
)

// 该脚本的全部运行记录（同一脚本可并发多实例，按开始时间倒序）
const runs = computed(() =>
  project.value
    ? projects.runsOfScript(project.value.id, props.target.packageId, props.target.scriptName)
    : [],
)
const runInfo = computed(() => runs.value[0] ?? null)
const runningCount = computed(() => runs.value.filter(r => r.status === 'running').length)
const running = computed(() => runningCount.value > 0)
const activeRunId = computed(() =>
  running.value ? (runs.value.find(r => r.status === 'running')?.runId ?? null) : null,
)

// 控制台跟随策略：运行中跟随最新启动的实例；全部结束后跟随最新一条（可回看日志）
const consoleRunId = computed(() => activeRunId.value ?? runInfo.value?.runId ?? null)
const logs = computed(() =>
  consoleRunId.value ? (projects.logs[consoleRunId.value] ?? []) : [],
)

const status = computed<ProjectStatus>(() => {
  if (running.value)
    return 'running'
  if (!runInfo.value)
    return 'idle'
  if (runs.value.some(r => r.status === 'error'))
    return 'error'
  return runInfo.value.status
})

const statusMeta: Record<ProjectStatus, { label: string, color: string, bg: string }> = {
  idle: { label: '空闲', color: '#8a8f98', bg: 'rgba(138,143,152,0.12)' },
  running: { label: '运行中', color: '#34c759', bg: 'rgba(52,199,89,0.14)' },
  stopped: { label: '已停止', color: '#8a8f98', bg: 'rgba(138,143,152,0.12)' },
  error: { label: '报错', color: '#e5484d', bg: 'rgba(229,72,77,0.14)' },
}

// 运行中每 1s 刷新一次时间基准，驱动「时长」实时跳动
const nowTick = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null
watch(running, (v) => {
  if (v && !tickTimer) {
    nowTick.value = Date.now()
    tickTimer = setInterval(() => {
      nowTick.value = Date.now()
    }, 1000)
  }
  else if (!v && tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}, { immediate: true })
onUnmounted(() => {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})

function fmtDuration(ms?: number): string {
  if (!ms || ms < 0)
    return '—'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0)
    return `${d}d`
  if (h > 0)
    return `${h}h`
  if (m > 0)
    return `${m}m`
  return `${s}s`
}
const duration = computed(() => {
  const r = runInfo.value
  if (!r)
    return null
  const end = r.status === 'running' ? nowTick.value : (r.endedAt ?? Date.now())
  return fmtDuration(end - r.startedAt)
})
function fmtTime(ts?: number): string {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—'
}

async function run() {
  const p = project.value
  if (!p)
    return
  const req = buildRunRequest({
    project: p,
    packageId: props.target.packageId,
    script: props.target.scriptName,
    shell: '',
    params: '',
    defaultShell: settings.settings.defaultShell,
  })
  await projects.run(req)
  message.info(`启动：${displayName.value}`)
}
async function stop() {
  const id = activeRunId.value
  if (id) {
    await projects.stop(id)
    message.info('已发送停止信号')
  }
}
function openPort() {
  if (runInfo.value?.port)
    api.openUrl(`http://localhost:${runInfo.value.port}`)
}
async function openFolder() {
  if (path.value)
    await api.openFolder(path.value)
}
const exitCode = computed(() => runInfo.value?.exitCode ?? null)
const hasError = computed(() =>
  status.value === 'error' || (exitCode.value !== null && exitCode.value !== 0),
)
</script>

<template>
  <div v-if="project" class="flex flex-col h-full min-h-0 bg-bg text-fg">
    <!-- 运行摘要条：命令名 / 状态 / 端口 / 时长 / Node / 退出码 / 多实例提示 -->
    <div class="flex items-center gap-2.5 px-4 py-2.5 border-b border-line bg-bg-elevated flex-wrap flex-none">
      <NButton size="small" @click="emit('close')">
        <template #icon>
          <i class="i-carbon-arrow-left" />
        </template>
        返回
      </NButton>
      <span
        class="w-2 h-2 rounded-full inline-block flex-none"
        :style="{ background: statusMeta[status].color, boxShadow: `0 0 0 3px ${statusMeta[status].bg}` }"
      />
      <span class="text-[15px] font-semibold truncate max-w-[320px]" :title="`${project.name} · ${displayName}`">
        {{ project.name }} · <span class="font-mono">{{ displayName }}</span>
      </span>
      <span
        class="text-[11px] font-medium px-2 py-0.5 rounded-full leading-tight flex-none"
        :style="{ color: statusMeta[status].color, background: statusMeta[status].bg }"
      >{{ statusMeta[status].label }}</span>
      <span
        v-if="runInfo?.port"
        class="text-xs text-accent cursor-pointer underline decoration-dashed hover:text-accent/80 flex-none"
        title="在浏览器打开"
        @click="openPort"
      >:{{ runInfo.port }}</span>
      <span v-if="duration" class="text-xs text-fg-dim tabular-nums flex-none" title="运行时长">{{ duration }}</span>
      <span v-if="runInfo?.nodeVersion" class="text-xs text-fg-dim flex-none" :title="`Node ${runInfo.nodeVersion}`">
        Node {{ runInfo.nodeVersion }}
      </span>
      <span v-if="hasError && exitCode !== null" class="text-xs text-danger tabular-nums flex-none" :title="`退出码 ${exitCode}`">
        ✕{{ exitCode }}
      </span>
      <span v-if="runningCount > 1" class="text-xs text-fg-dim flex-none" :title="`该脚本共有 ${runningCount} 个实例在运行，控制台跟随最新启动的一个`">
        另有 {{ runningCount - 1 }} 个实例在跑
      </span>
      <span v-if="runInfo" class="text-xs text-fg-dim flex-none" :title="`开始于 ${fmtTime(runInfo.startedAt)}`">
        最近 {{ fmtTime(runInfo.startedAt) }}
      </span>
      <div class="ml-auto flex gap-2 flex-none">
        <NButton size="small" @click="openFolder">
          打开文件夹
        </NButton>
        <NButton v-if="running" size="small" type="warning" @click="stop">
          <template #icon>
            <i class="i-carbon-stop-outline" />
          </template>
          停止
        </NButton>
        <NButton v-else size="small" type="primary" @click="run">
          <template #icon>
            <i class="i-carbon-play" />
          </template>
          运行
        </NButton>
      </div>
    </div>

    <!-- 脚本实际命令内容 -->
    <div v-if="scriptObj" class="px-4 py-1.5 text-[11.5px] text-fg-dim break-all border-b border-line flex-none font-mono">
      {{ scriptObj.command }}
    </div>

    <!-- 控制台 -->
    <div class="flex-1 min-h-0 p-3.5 flex flex-col">
      <ConsolePanel
        v-if="consoleRunId"
        :run-id="consoleRunId"
        :logs="logs"
        :running="running"
        fill
      />
      <div v-else class="flex-1 flex flex-col items-center justify-center text-fg-dim gap-2.5">
        <div class="text-5xl leading-none opacity-60">
          <i class="i-carbon-terminal" />
        </div>
        <div class="text-sm text-fg">
          「{{ displayName }}」还没有运行记录
        </div>
        <div class="text-[12.5px]">
          点上方「运行」，或在侧栏把鼠标移到该命令上点击播放按钮
        </div>
      </div>
    </div>
  </div>
  <div v-else class="text-fg-dim p-5 text-center">
    工程不存在
  </div>
</template>
