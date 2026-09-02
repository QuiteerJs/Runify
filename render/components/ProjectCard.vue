<script setup lang="ts">
import type { Project, ProjectStatus, RunInfo } from '../../shared/types'
import { NButton, NInput, NTag } from 'naive-ui'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { message } from '../feedback'
import { api } from '../ipc'
import { useProjects } from '../stores/projects'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{
  open: [projectId: string, packageId: string | null]
  run: [project: Project]
  remove: [project: Project]
  info: [project: Project]
  contextMenu: [e: MouseEvent, project: Project, packageId: string | null]
}>()

const projects = useProjects()

// 一个项目可并发跑多条命令：取全部记录 + 聚合状态。
// 用 statusOf / latestRunId 只看「最新一条」会把并发任务吞掉 —— 先跑 dev 再跑 build，
// build 一结束卡片就会错误地显示已停止，而 dev 其实还在跑
const tasks = computed(() => projects.runsOf(props.project.id, null))
const status = computed<ProjectStatus>(() => projects.aggregateStatus(props.project.id, null))
const isRunning = computed(() => status.value === 'running')

// 只统计「还需要用户关注」的任务：运行中 / 失败 / 占着端口。
// 已成功结束且无端口的任务不再占位，否则历史记录会在聚合行里越堆越多
const activeTasks = computed(() => tasks.value.filter(r => r.status === 'running' || r.status === 'error' || r.port))
const runningCount = computed(() => activeTasks.value.filter(r => r.status === 'running').length)
const failedCount = computed(() => activeTasks.value.filter(r => r.status === 'error').length)
const ports = computed(() => activeTasks.value.filter(r => r.status === 'running' && r.port).map(r => r.port!))
const showTaskBar = computed(() => activeTasks.value.length > 0)

const statusMeta: Record<ProjectStatus, { label: string, color: string, bg: string }> = {
  idle: { label: '空闲', color: '#8a8f98', bg: 'rgba(138,143,152,0.12)' },
  running: { label: '运行中', color: '#34c759', bg: 'rgba(52,199,89,0.14)' },
  stopped: { label: '已停止', color: '#8a8f98', bg: 'rgba(138,143,152,0.12)' },
  error: { label: '报错', color: '#e5484d', bg: 'rgba(229,72,77,0.14)' },
}

function fmtDuration(ms?: number): string {
  if (!ms || ms < 0)
    return '—'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  // 越往大尺度越压缩：< 1m 显示秒，< 1h 显示分，< 24h 只显示小时，>= 24h 只显示天
  // 避免「15h36m」「1d2h」这种长串撑爆 chip
  if (d > 0)
    return `${d}d`
  if (h > 0)
    return `${h}h`
  if (m > 0)
    return `${m}m`
  return `${s}s`
}
// 运行中每 1s 刷新一次时间基准，驱动「时长」实时跳动（纯 computed 不会自己更新）
const nowTick = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null
watch(isRunning, (running) => {
  if (running && !tickTimer) {
    nowTick.value = Date.now()
    tickTimer = setInterval(() => {
      nowTick.value = Date.now()
    }, 1000)
  }
  else if (!running && tickTimer) {
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

// 单条任务的时长（运行中按 nowTick 每秒实时跳动）
function durOf(r: RunInfo): string {
  const end = r.status === 'running' ? nowTick.value : (r.endedAt ?? Date.now())
  return fmtDuration(end - r.startedAt)
}

// 聚合行徽章文案：优先体现最需要关注的状态
const taskBadge = computed(() => {
  if (runningCount.value > 0)
    return `${runningCount.value} 个运行中`
  if (failedCount.value > 0)
    return `${failedCount.value} 个失败`
  return `${activeTasks.value.length} 个任务`
})

async function onStopTask(runId: string) {
  const ok = await projects.stop(runId)
  if (ok)
    message.success('已发送停止信号')
  else
    message.warning('该任务已结束')
}

const folderName = computed(() => {
  const parts = props.project.path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || props.project.path
})

// 统计信息：脚本数 / 子包数 / 环境变量数 / 依赖数
const envCount = computed(() => props.project.env.filter(e => e.enabled && e.key).length)
const depCount = computed(() => Object.keys(props.project.dependencies ?? {}).length)

// 备注：卡片内联编辑（NInput 实例直接暴露 focus()，无需再手动取内部 input 元素）
const hasNote = computed(() => !!props.project.note && props.project.note.trim().length > 0)
const noteEditing = ref(false)
const noteDraft = ref('')
const noteArea = ref<{ focus: () => void } | null>(null)
let noteSaving = false

async function startNoteEdit(e: MouseEvent) {
  e.stopPropagation()
  noteDraft.value = props.project.note ?? ''
  noteEditing.value = true
  await nextTick()
  noteArea.value?.focus()
}
async function commitNote() {
  if (!noteEditing.value || noteSaving)
    return
  noteSaving = true
  try {
    const v = noteDraft.value.trim()
    if (v !== (props.project.note ?? '')) {
      await projects.updateProject(props.project.id, { note: v })
      message.success('备注已保存')
    }
  }
  finally {
    noteSaving = false
    noteEditing.value = false
  }
}
function cancelNote() {
  // 先退出编辑态：紧随其后的 blur 触发 commitNote 时会因 noteEditing=false 直接返回，不会误保存
  noteEditing.value = false
}

function onCtx(e: MouseEvent) {
  emit('contextMenu', e, props.project, null)
}
function onOpen() {
  emit('open', props.project.id, null)
}
function onRun() {
  // 点击「运行」直接进入详情页：左侧脚本树选脚本运行，右侧实时日志
  emit('open', props.project.id, null)
}
function onInfo() {
  // 「详情」按钮弹出包信息（目录 / 作者 / 版本等）
  emit('info', props.project)
}
function onRemove(e: MouseEvent) {
  e.stopPropagation()
  emit('remove', props.project)
}
function onOpenPort(e: MouseEvent, port: number) {
  e.stopPropagation()
  api.openUrl(`http://localhost:${port}`)
}
function onOpenFolder(e: MouseEvent) {
  e.stopPropagation()
  api.openFolder(props.project.path)
}
</script>

<template>
  <!-- 不用 overflow-hidden：任务浮层需要溢出卡片边界；hover:z-30 保证浮层盖在相邻卡片之上 -->
  <div class="group relative flex flex-col bg-bg-card border border-line rounded-[12px] cursor-pointer transition-all duration-150 min-h-[176px] w-full min-w-0 box-border hover:z-30 hover:border-accent/60 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)] active:scale-[0.99]" @click="onOpen" @contextmenu="onCtx">
    <!-- 运行中：顶部扫光 -->
    <div v-if="isRunning" class="absolute top-0 left-0 right-0 h-0.5 rounded-t-[12px] overflow-hidden bg-[rgba(52,199,89,0.15)] pointer-events-none after:content-[''] after:absolute after:top-0 after:left-0 after:h-full after:w-[40%] after:rounded-full after:bg-[#34c759] after:animate-[runify-sweep_1.2s_ease-in-out_infinite]" />

    <!-- 顶栏：状态点 + 项目名 + 状态徽章 -->
    <div class="flex items-center gap-2 pt-4 px-4 min-w-0">
      <span class="w-2 h-2 rounded-full inline-block flex-none shrink-0" :style="{ background: statusMeta[status].color, boxShadow: `0 0 0 3px ${statusMeta[status].bg}` }" />
      <span class="truncate flex-1 min-w-0 text-[14.5px] font-semibold text-fg leading-tight" :title="project.name">{{ project.name }}</span>
      <span
        class="flex-none text-[11px] font-medium px-2 py-0.5 rounded-full leading-tight"
        :style="{ color: statusMeta[status].color, background: statusMeta[status].bg }"
      >{{ showTaskBar ? taskBadge : statusMeta[status].label }}</span>
    </div>

    <!-- 类型标签 + 路径 -->
    <div class="flex flex-col gap-1.5 px-4 pt-2 min-w-0">
      <div v-if="project.type.length" class="flex gap-1 flex-wrap">
        <NTag v-for="t in project.type" :key="t" size="small" :bordered="false">
          {{ t }}
        </NTag>
      </div>
      <div class="text-[12px] text-fg-dim flex items-center gap-1 min-w-0 cursor-pointer hover:text-accent transition-colors" :title="project.path" @click.stop="onOpenFolder">
        <i class="i-carbon-folder flex-none" />
        <span class="truncate">{{ folderName }}</span>
        <template v-if="project.branch">
          <i class="i-carbon-branch flex-none ml-1" />
          <span class="truncate">{{ project.branch }}</span>
        </template>
      </div>
    </div>

    <!-- 并发任务聚合行：高度恒定的单行摘要，无论跑 1 条还是 8 条，卡片高度都不变、整排对齐 -->
    <div v-if="showTaskBar" class="mt-2 px-4 relative group/tasks min-w-0" @click.stop>
      <div class="flex items-center gap-1.5 text-[11.5px] text-fg-dim min-w-0 overflow-hidden whitespace-nowrap cursor-default">
        <i class="flex-none text-[12px] leading-none i-carbon-list-boxes" />
        <span class="flex-none text-fg">{{ taskBadge }}</span>
        <template v-if="ports.length">
          <span class="text-fg-dim/40 select-none flex-none">·</span>
          <span
            v-for="p in ports"
            :key="p"
            class="text-accent flex-none cursor-pointer hover:text-accent/80"
            title="在浏览器打开"
            @click="onOpenPort($event, p)"
          >:{{ p }}</span>
        </template>
        <span v-if="failedCount" class="text-danger flex-none">· ✕{{ failedCount }}</span>
      </div>

      <!-- hover 浮层：绝对定位不占文档流，逐条展示 + 逐条停止，卡片本身不会被撑高 -->
      <div class="hidden group-hover/tasks:block absolute left-4 right-4 top-full mt-1 z-20 rounded-lg border border-line bg-bg-elevated shadow-[0_8px_24px_rgba(0,0,0,0.35)] py-1 max-h-[108px] overflow-y-auto">
        <div
          v-for="t in activeTasks"
          :key="t.runId"
          class="group/item flex items-center gap-2 px-2 py-1"
        >
          <span class="w-1.5 h-1.5 rounded-full flex-none" :style="{ background: statusMeta[t.status].color }" />
          <span class="flex-1 min-w-0 truncate text-[11.5px] text-fg" :title="t.script">{{ t.script }}</span>
          <span
            v-if="t.port"
            class="text-[11px] text-accent flex-none cursor-pointer hover:text-accent/80"
            title="在浏览器打开"
            @click.stop="onOpenPort($event, t.port)"
          >:{{ t.port }}</span>
          <span class="text-[11px] text-fg-dim tabular-nums flex-none">{{ durOf(t) }}</span>
          <span
            v-if="t.status === 'error'"
            class="text-[11px] text-danger flex-none"
            :title="`退出码 ${t.exitCode}`"
          >✕{{ t.exitCode }}</span>
          <button
            v-if="t.status === 'running'"
            class="flex-none text-[12px] leading-none text-fg-dim opacity-0 group-hover/item:opacity-100 hover:text-danger transition-opacity"
            title="停止这条命令"
            @click.stop="onStopTask(t.runId)"
          >
            <i class="i-carbon-stop-outline" />
          </button>
        </div>
      </div>
    </div>

    <!-- 统计信息条：包管理器 / 脚本数 / 子包数 / 环境变量 / 依赖数 -->
    <div class="mt-2.5 px-4 flex items-center gap-2.5 text-[11.5px] text-fg-dim flex-wrap min-w-0">
      <span v-if="project.pm" class="inline-flex items-center gap-1" :title="`包管理器 ${project.pm}`">
        <i class="i-carbon-package flex-none" /> {{ project.pm }}
      </span>
      <span class="inline-flex items-center gap-1" :title="`${project.scripts.length} 个脚本`">
        <i class="i-carbon-terminal flex-none" /> {{ project.scripts.length }}
      </span>
      <span v-if="project.isMonorepo" class="inline-flex items-center gap-1" :title="`${project.packages.length} 个子包`">
        <i class="i-carbon-cube flex-none" /> {{ project.packages.length }}
      </span>
      <span v-if="envCount" class="inline-flex items-center gap-1" :title="`${envCount} 个环境变量`">
        <i class="i-carbon-code flex-none" /> {{ envCount }}
      </span>
      <span v-if="depCount" class="inline-flex items-center gap-1" :title="`${depCount} 个运行时依赖`">
        <i class="i-carbon-box flex-none" /> {{ depCount }}
      </span>
    </div>

    <!-- 备注：编辑态用 NInput（与项目其他输入框风格一致），展示态为纯文本行 -->
    <div v-if="noteEditing" class="mt-2 px-4" @click.stop>
      <NInput
        ref="noteArea"
        v-model:value="noteDraft"
        size="small"
        :maxlength="10"
        placeholder="备注（最多 10 字）"
        @keydown.esc="cancelNote"
        @keydown.enter="commitNote"
        @blur="commitNote"
      />
    </div>
    <div
      v-else
      class="mt-2 px-4 text-[11.5px] cursor-pointer flex items-center gap-1 min-w-0 select-none"
      :class="hasNote
        ? 'text-fg-dim hover:text-accent'
        : 'text-fg-dim/40 group-hover:text-fg-dim/70'"
      :title="hasNote ? '点击编辑备注' : '点击添加备注'"
      @click.stop="startNoteEdit"
    >
      <i :class="hasNote ? 'i-carbon-text-footnote' : 'i-carbon-add'" class="flex-none opacity-70" />
      <span class="truncate">{{ hasNote ? project.note : '添加备注' }}</span>
    </div>

    <!-- 底部操作栏：flex 严格 baseline + 统一按钮高度，避免因 loading 高度变化错位 -->
    <div class="mt-auto flex items-center gap-1.5 px-4 pt-3 pb-3 border-t border-line/60 min-h-[52px]" @click.stop>
      <NButton size="small" type="primary" class="!h-7 leading-7" :loading="isRunning" @click="onRun">
        <template #icon>
          <i class="i-carbon-play" />
        </template>
        {{ isRunning ? '运行中' : '运行' }}
      </NButton>
      <NButton size="small" quaternary class="!h-7 leading-7" @click="onInfo">
        <template #icon>
          <i class="i-carbon-information" />
        </template>
        详情
      </NButton>
      <div class="flex-1" />
      <NButton size="small" quaternary type="error" class="!h-7 leading-7" @click="onRemove">
        <template #icon>
          <i class="i-carbon-trash-can" />
        </template>
      </NButton>
    </div>
  </div>
</template>
