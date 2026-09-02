<script setup lang="ts">
import type { ProjectStatus, RunInfo } from '../../shared/types'
import {
  NButton,
  NInput,
  NTag,
} from 'naive-ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { message } from '../feedback'
import { api } from '../ipc'
import { buildRunRequest } from '../run-utils'
import { useProjects } from '../stores/projects'
import { useSettings } from '../stores/settings'
import ConsolePanel from './ConsolePanel.vue'
import EnvEditorModal from './EnvEditorModal.vue'

const props = defineProps<{
  target: { projectId: string, packageId: string | null }
}>()
const emit = defineEmits<{ close: [] }>()

const projects = useProjects()
const settings = useSettings()

const project = computed(() =>
  projects.projects.find(p => p.id === props.target.projectId),
)

// === 当前聚焦的包 + 命令 ===
// selPkg：当前控制台跟随的子包（null = 根）
// selScript：显式选中的脚本名；null = 「跟随最新」，即展示该包最新一次运行对应的命令
const selPkg = ref<string | null>(props.target.packageId)
const selScript = ref<string | null>(null)

function selectScript(packageId: string | null, scriptName: string) {
  selPkg.value = packageId
  selScript.value = scriptName
}
function selectPackage(packageId: string | null) {
  selPkg.value = packageId
  // 切包后回到「跟随最新」；原选中脚本若恰好也在新包里则保留
  const list = packageId
    ? (project.value?.packages.find(x => x.id === packageId)?.scripts ?? [])
    : (project.value?.scripts ?? [])
  if (!list.some(s => s.name === selScript.value))
    selScript.value = null
}

/** 打开详情页时，若当前包没有运行中的任务，自动切到第一个运行中的子包，让控制台直接显示日志 */
function autoFocusRunning() {
  const p = project.value
  if (!p || selScript.value)
    return
  if (projects.activeRunId(p.id, selPkg.value))
    return
  const runningPkg = p.packages.find(pkg => projects.activeRunId(p.id, pkg.id))
  if (runningPkg)
    selPkg.value = runningPkg.id
}

watch(
  () => props.target,
  (t) => {
    selPkg.value = t.packageId
    selScript.value = null
    autoFocusRunning()
  },
  { immediate: true },
)

// === 当前命令的运行信息（显式选中优先，否则跟随该包最新一条运行） ===
const packageRuns = computed<RunInfo[]>(() =>
  project.value ? projects.runsOf(project.value.id, selPkg.value) : [],
)
const activeScriptName = computed(() => selScript.value ?? packageRuns.value[0]?.script ?? null)

const selPkgObj = computed(() =>
  selPkg.value ? project.value?.packages.find(p => p.id === selPkg.value) ?? null : null,
)
const scriptObj = computed(() => {
  if (!activeScriptName.value)
    return null
  const list = selPkg.value ? (selPkgObj.value?.scripts ?? []) : (project.value?.scripts ?? [])
  return list.find(s => s.name === activeScriptName.value) ?? null
})
const displayName = computed(() => {
  if (!activeScriptName.value)
    return ''
  return selPkg.value
    ? `${selPkgObj.value?.name ?? '?'}:${activeScriptName.value}`
    : activeScriptName.value
})

const path = computed(() =>
  selPkgObj.value ? selPkgObj.value.absolutePath : (project.value?.path ?? ''),
)

// 该命令的全部运行记录（同一脚本可并发多实例，按开始时间倒序）
const cmdRuns = computed<RunInfo[]>(() =>
  project.value && activeScriptName.value
    ? projects.runsOfScript(project.value.id, selPkg.value, activeScriptName.value)
    : [],
)
const runInfo = computed(() => cmdRuns.value[0] ?? null)
const runningCount = computed(() => cmdRuns.value.filter(r => r.status === 'running').length)
const running = computed(() => runningCount.value > 0)

// 控制台跟随策略：运行中跟随最新启动的实例；全部结束后跟随最新一条（可回看日志）
const consoleRunId = computed(() =>
  (running.value ? cmdRuns.value.find(r => r.status === 'running')?.runId : null)
  ?? runInfo.value?.runId
  ?? null,
)
const logs = computed(() =>
  consoleRunId.value ? (projects.logs[consoleRunId.value] ?? []) : [],
)

const status = computed<ProjectStatus>(() => {
  if (running.value)
    return 'running'
  if (!runInfo.value)
    return 'idle'
  if (cmdRuns.value.some(r => r.status === 'error'))
    return 'error'
  return runInfo.value.status
})

/** 工程级状态（顶栏圆点）：聚合根包 + 全部子包，running > error > 最新一条 */
const projectStatus = computed<ProjectStatus>(() => {
  const p = project.value
  if (!p)
    return 'idle'
  const all: RunInfo[] = [
    ...projects.runsOf(p.id, null),
    ...p.packages.flatMap(pkg => projects.runsOf(p.id, pkg.id)),
  ]
  if (all.some(r => r.status === 'running'))
    return 'running'
  if (all.some(r => r.status === 'error'))
    return 'error'
  return all[0]?.status ?? 'idle'
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

function fmtTime(ts?: number | null): string {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—'
}
function fmtDuration(ms?: number): string {
  if (!ms || ms < 0)
    return '—'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0)
    return `${h}h${m % 60}m`
  if (m > 0)
    return `${m}m${s % 60}s`
  return `${s}s`
}
const duration = computed(() => {
  const r = runInfo.value
  if (!r)
    return null
  const end = r.status === 'running' ? nowTick.value : (r.endedAt ?? Date.now())
  return fmtDuration(end - r.startedAt)
})
const exitCode = computed(() => runInfo.value?.exitCode ?? null)
const hasError = computed(() =>
  status.value === 'error' || (exitCode.value !== null && exitCode.value !== 0),
)

// === 脚本树（左侧） ===
// 分组：根 + 各子包
interface Group {
  packageId: string | null
  packageName: string
  scripts: { name: string, command: string }[]
}
const groups = computed<Group[]>(() => {
  const p = project.value
  if (!p)
    return []
  const g: Group[] = []
  if (p.scripts.length)
    g.push({ packageId: null, packageName: '根目录', scripts: p.scripts })
  for (const pkg of p.packages) {
    if (pkg.scripts.length)
      g.push({ packageId: pkg.id, packageName: pkg.name, scripts: pkg.scripts })
  }
  return g
})

function scriptRuns(packageId: string | null, name: string): RunInfo[] {
  return project.value ? projects.runsOfScript(project.value.id, packageId, name) : []
}
function isScriptRunning(packageId: string | null, name: string): boolean {
  return scriptRuns(packageId, name).some(r => r.status === 'running')
}
function scriptHasError(packageId: string | null, name: string): boolean {
  const list = scriptRuns(packageId, name)
  return list.some(r => r.status === 'error') && !list.some(r => r.status === 'running')
}
function runningCountOfGroup(g: Group): number {
  return g.scripts.filter(s => isScriptRunning(g.packageId, s.name)).length
}
function isScriptSelected(packageId: string | null, name: string): boolean {
  return selPkg.value === packageId && selScript.value === name
}

async function runScript(group: Group, scriptName: string, params = '', shell = '') {
  if (!project.value)
    return
  selectScript(group.packageId, scriptName)
  const req = buildRunRequest({
    project: project.value,
    packageId: group.packageId,
    script: scriptName,
    shell,
    params,
    defaultShell: settings.settings.defaultShell,
  })
  await projects.run(req)
  message.info(`启动：${group.packageName} / ${scriptName}`)
}

/** 停止该脚本运行中的实例（并发多实例时停最新启动的一个） */
async function stopScript(packageId: string | null, scriptName: string) {
  const hit = scriptRuns(packageId, scriptName).find(r => r.status === 'running')
  if (hit) {
    await projects.stop(hit.runId)
    message.info('已发送停止信号')
  }
}

async function stopCurrent() {
  if (!activeScriptName.value)
    return
  await stopScript(selPkg.value, activeScriptName.value)
}
async function runCurrent() {
  const p = project.value
  const g = groups.value.find(x => x.packageId === selPkg.value)
  if (!p || !activeScriptName.value || !g)
    return
  await runScript(g, activeScriptName.value)
}

// 备注
const note = ref('')
watch(project, (p) => {
  note.value = p?.note ?? ''
}, { immediate: true })
const noteDirty = computed(() => note.value !== (project.value?.note ?? ''))
async function saveNote() {
  if (!project.value)
    return
  await projects.updateProject(project.value.id, { note: note.value })
  message.success('备注已保存')
}

// 环境变量
const showEnv = ref(false)

async function openFolder() {
  if (path.value)
    await api.openFolder(path.value)
}
function openPort() {
  if (runInfo.value?.port)
    api.openUrl(`http://localhost:${runInfo.value.port}`)
}
</script>

<template>
  <div v-if="project" class="flex flex-col h-full min-h-0 bg-bg text-fg">
    <!-- 顶栏：返回 + 工程名 + 工程级状态 + 元信息 + 全局操作 -->
    <div class="flex items-center gap-3 px-4 py-2.5 border-b border-line bg-bg-elevated flex-wrap flex-none">
      <NButton size="small" @click="emit('close')">
        <template #icon>
          <i class="i-carbon-arrow-left" />
        </template>
        返回
      </NButton>
      <span
        class="w-2 h-2 rounded-full inline-block flex-none"
        :style="{ background: statusMeta[projectStatus].color, boxShadow: `0 0 0 3px ${statusMeta[projectStatus].bg}` }"
      />
      <span class="text-[15px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-w-[280px]">{{ project.name }}</span>
      <NTag
        v-for="t in (selPkgObj ? selPkgObj.type : project.type)"
        :key="t"
        size="small"
        :bordered="false"
      >
        {{ t }}
      </NTag>
      <span
        v-if="project.pm"
        class="text-[11px] text-fg-dim bg-bg-card border border-line rounded-full px-2 py-0.5 flex-none"
        :title="`包管理器：${project.pm}`"
      >{{ project.pm }}</span>
      <span
        v-if="project.branch"
        class="text-[11px] text-fg-dim bg-bg-card border border-line rounded-full px-2 py-0.5 flex-none font-mono"
        :title="`git 分支：${project.branch}`"
      >⎇ {{ project.branch }}</span>
      <div class="ml-auto flex gap-2 flex-none">
        <NButton size="small" @click="openFolder">
          打开文件夹
        </NButton>
        <NButton size="small" @click="showEnv = true">
          环境变量
        </NButton>
      </div>
    </div>

    <div class="px-4 py-1.5 text-[11.5px] text-fg-dim break-all border-b border-line font-mono flex-none">
      {{ path }}
    </div>

    <div class="flex-1 flex min-h-0">
      <!-- 左：脚本树 + 备注 -->
      <div class="w-[340px] flex-none border-r border-line overflow-y-auto overflow-x-hidden p-3.5 flex flex-col gap-4">
        <section>
          <div class="text-[12px] font-semibold mb-2 text-fg-dim tracking-wide">
            脚本
          </div>
          <div
            v-for="g in groups"
            :key="g.packageId ?? 'root'"
            class="mb-2.5"
          >
            <!-- 包分组头 -->
            <button
              type="button"
              class="group/pkg flex items-center gap-1.5 w-full px-1.5 py-1 rounded-md border-none bg-transparent text-left cursor-pointer transition-colors duration-150 hover:bg-[rgba(128,128,128,0.08)]"
              :class="selPkg === g.packageId && !selScript ? 'text-fg' : 'text-fg-dim'"
              title="查看该包最新运行的命令"
              @click="selectPackage(g.packageId)"
            >
              <i class="i-tabler-folder w-3.5 text-[12px] flex-none" />
              <span class="text-[12px] font-semibold truncate flex-1 min-w-0">{{ g.packageName }}</span>
              <span
                v-if="runningCountOfGroup(g)"
                class="text-[10px] text-accent bg-[rgba(52,199,89,0.14)] rounded-full px-1.5 py-px flex-none"
                :title="`${runningCountOfGroup(g)} 个命令运行中`"
              >{{ runningCountOfGroup(g) }}</span>
            </button>
            <!-- 脚本行 -->
            <div
              v-for="s in g.scripts"
              :key="s.name"
              class="group/sc flex items-center gap-2.5 mt-1 pl-2.5 pr-2 py-1.5 rounded-lg cursor-pointer transition-colors duration-150"
              :class="isScriptSelected(g.packageId, s.name)
                ? 'bg-[rgba(52,199,89,0.10)] ring-1 ring-inset ring-accent/40'
                : 'bg-bg-elevated hover:bg-[rgba(128,128,128,0.10)]'"
              :title="s.command"
              @click="selectScript(g.packageId, s.name)"
            >
              <span
                class="w-1.5 h-1.5 rounded-full flex-none"
                :class="isScriptRunning(g.packageId, s.name)
                  ? 'bg-accent'
                  : scriptHasError(g.packageId, s.name)
                    ? 'bg-danger'
                    : 'bg-line/80'"
              />
              <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                <span class="text-[12.5px] font-medium truncate">{{ s.name }}</span>
                <span class="text-[10.5px] text-fg-dim break-all font-mono leading-snug">{{ s.command }}</span>
              </div>
              <button
                v-if="!isScriptRunning(g.packageId, s.name)"
                type="button"
                title="运行这条命令"
                class="flex-none w-6 h-6 p-0 border-none bg-transparent rounded-md cursor-pointer flex items-center justify-center text-accent opacity-0 group-hover/sc:opacity-100 transition-opacity duration-150 hover:bg-[rgba(52,199,89,0.12)]"
                @click.stop="runScript(g, s.name)"
              >
                <i class="i-carbon-play text-[12px]" />
              </button>
              <button
                v-else
                type="button"
                title="停止这条命令"
                class="flex-none w-6 h-6 p-0 border-none bg-transparent rounded-md cursor-pointer flex items-center justify-center text-danger opacity-70 group-hover/sc:opacity-100 transition-opacity duration-150 hover:bg-[rgba(229,72,77,0.12)]"
                @click.stop="stopScript(g.packageId, s.name)"
              >
                <i class="i-carbon-stop-outline text-[12px]" />
              </button>
            </div>
          </div>
          <div v-if="!groups.length" class="text-fg-dim p-5 text-center">
            未检测到脚本
          </div>
        </section>

        <!-- 备注 -->
        <section class="flex flex-col gap-2">
          <div class="text-[12px] font-semibold text-fg-dim tracking-wide">
            备注
          </div>
          <NInput
            v-model:value="note"
            type="textarea"
            :rows="3"
            :maxlength="200"
            show-count
            placeholder="记录这个工程的用途、注意事项…"
          />
          <NButton
            size="tiny"
            secondary
            type="primary"
            :disabled="!noteDirty"
            class="self-start"
            @click="saveNote"
          >
            保存备注
          </NButton>
        </section>
      </div>

      <!-- 右：当前命令摘要卡 + 控制台 -->
      <div class="flex-1 min-w-0 p-3.5 flex flex-col gap-3 min-h-0">
        <div
          v-if="activeScriptName"
          class="rounded-xl border border-line bg-bg-elevated px-4 py-3 flex-none flex flex-col gap-2.5"
        >
          <!-- 第一行：状态点 + 命令名 + 状态徽章 + 端口 + 操作 -->
          <div class="flex items-center gap-2.5 flex-wrap">
            <span
              class="w-2 h-2 rounded-full inline-block flex-none"
              :style="{ background: statusMeta[status].color, boxShadow: `0 0 0 3px ${statusMeta[status].bg}` }"
            />
            <span class="text-[14px] font-semibold font-mono truncate" :title="`${project.name} · ${displayName}`">
              {{ displayName }}
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
            <span
              v-if="runningCount > 1"
              class="text-xs text-fg-dim flex-none"
              :title="`该脚本共有 ${runningCount} 个实例在运行，控制台跟随最新启动的一个`"
            >
              另有 {{ runningCount - 1 }} 个实例在跑
            </span>
            <div class="ml-auto flex gap-2 flex-none">
              <NButton v-if="running" size="small" type="warning" @click="stopCurrent">
                <template #icon>
                  <i class="i-carbon-stop-outline" />
                </template>
                停止
              </NButton>
              <NButton v-else size="small" type="primary" @click="runCurrent">
                <template #icon>
                  <i class="i-carbon-play" />
                </template>
                运行
              </NButton>
            </div>
          </div>
          <!-- 第二行：脚本实际命令内容 -->
          <div v-if="scriptObj" class="text-[11.5px] text-fg-dim break-all font-mono leading-snug">
            {{ scriptObj.command }}
          </div>
          <!-- 第三行：运行统计 -->
          <div class="flex gap-x-6 gap-y-2 flex-wrap pt-2.5 border-t border-line/60">
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[10.5px] text-fg-dim/80">时长</span>
              <span class="text-[12.5px] font-medium tabular-nums">{{ duration ?? '—' }}</span>
            </div>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[10.5px] text-fg-dim/80">Node</span>
              <span class="text-[12.5px] font-medium tabular-nums">{{ runInfo?.nodeVersion || '—' }}</span>
            </div>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[10.5px] text-fg-dim/80">退出码</span>
              <span
                class="text-[12.5px] font-medium tabular-nums"
                :class="hasError ? 'text-danger' : ''"
              >{{ exitCode ?? '—' }}</span>
            </div>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[10.5px] text-fg-dim/80">开始时间</span>
              <span class="text-[12.5px] font-medium tabular-nums">{{ fmtTime(runInfo?.startedAt) }}</span>
            </div>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[10.5px] text-fg-dim/80">历史实例</span>
              <span class="text-[12.5px] font-medium tabular-nums">{{ cmdRuns.length }}</span>
            </div>
          </div>
        </div>

        <!-- 控制台 -->
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
            还没有运行记录
          </div>
          <div class="text-[12.5px]">
            在左侧点一条脚本运行，或把鼠标移上去点播放按钮
          </div>
        </div>
      </div>
    </div>

    <EnvEditorModal
      v-if="showEnv"
      :project="project"
      @close="showEnv = false"
      @saved="showEnv = false"
    />
  </div>
  <div v-else class="text-fg-dim p-5 text-center">
    工程不存在
  </div>
</template>
