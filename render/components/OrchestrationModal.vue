<script setup lang="ts">
import type { Project, TaskPlan, TaskStep } from '../../shared/types'
import {
  NButton,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
} from 'naive-ui'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message } from '../feedback'
import { buildRunRequest } from '../run-utils'
import { useProjects } from '../stores/projects'
import { useSettings } from '../stores/settings'
import { useTasks } from '../stores/tasks'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [v: boolean] }>()

const projects = useProjects()
const settings = useSettings()
const tasksStore = useTasks()

const activeId = ref<string | null>(null)
const editing = ref<TaskPlan | null>(null)

const isRunning = ref(false)
const abortOnError = ref(true)
const stepStatus = reactive<Record<string, 'idle' | 'running' | 'success' | 'error'>>({})
const runIdMap = reactive<Record<string, string>>({})

const projectOptions = computed(() =>
  projects.projects.map(p => ({ label: p.name, value: p.id })),
)

function projectOf(step: TaskStep): Project | undefined {
  return projects.projects.find(p => p.id === step.projectId)
}
function pkgOptionsFor(step: TaskStep) {
  const p = projectOf(step)
  if (!p)
    return []
  return [
    { label: '根', value: '' },
    ...p.packages.map(pkg => ({ label: pkg.name, value: pkg.id })),
  ]
}
function scriptOptionsFor(step: TaskStep) {
  const p = projectOf(step)
  if (!p)
    return []
  const pkg = step.packageId ? p.packages.find(x => x.id === step.packageId) : null
  const scripts = pkg ? pkg.scripts : p.scripts
  return scripts.map(s => ({ label: s.name, value: s.name }))
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function newPlan() {
  editing.value = { id: uid(), name: '新编排', steps: [] }
  activeId.value = null
}
function selectPlan(id: string) {
  const p = tasksStore.find(id)
  if (!p)
    return
  editing.value = JSON.parse(JSON.stringify(p)) as TaskPlan
  activeId.value = id
}

function onProjectChange(step: TaskStep) {
  step.packageId = null
  step.script = ''
}
function onPkgChange(step: TaskStep) {
  step.script = ''
}
function addStep() {
  if (!editing.value)
    return
  const first = projects.projects[0]
  editing.value.steps.push({
    id: uid(),
    projectId: first?.id ?? '',
    packageId: null,
    script: first?.scripts[0]?.name ?? '',
    mode: 'serial',
  })
}
function removeStep(i: number) {
  editing.value?.steps.splice(i, 1)
}
function moveStep(i: number, dir: -1 | 1) {
  const arr = editing.value?.steps
  if (!arr)
    return
  const j = i + dir
  if (j < 0 || j >= arr.length) {
    return
  }
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

async function save() {
  if (!editing.value)
    return
  if (!editing.value.name.trim()) {
    message.warning('请先填写编排名称')
    return
  }
  if (!editing.value.steps.length) {
    message.warning('请至少添加一个步骤')
    return
  }
  tasksStore.upsert(editing.value)
  await tasksStore.save()
  activeId.value = editing.value.id
  message.success('编排已保存')
}

function waitForEnd(runId: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = watch(
      () => projects.runs[runId]?.status,
      (s) => {
        if (s === 'stopped' || s === 'error') {
          stop()
          resolve()
        }
      },
      { immediate: true },
    )
  })
}

async function runStep(step: TaskStep) {
  stepStatus[step.id] = 'running'
  const project = projectOf(step)
  if (!project || !step.script) {
    stepStatus[step.id] = 'error'
    return
  }
  const req = buildRunRequest({
    project,
    packageId: step.packageId,
    script: step.script,
    shell: '',
    params: '',
    defaultShell: settings.settings.defaultShell,
  })
  try {
    const info = await projects.run(req)
    runIdMap[step.id] = info.runId
    await waitForEnd(info.runId)
    stepStatus[step.id]
      = projects.runs[info.runId]?.status === 'error' ? 'error' : 'success'
  }
  catch {
    stepStatus[step.id] = 'error'
  }
}

async function runPlan() {
  if (!editing.value || !editing.value.steps.length)
    return
  isRunning.value = true
  for (const s of editing.value.steps)
    stepStatus[s.id] = 'idle'
  let batch: TaskStep[] = []
  let aborted = false
  const flush = async () => {
    if (!batch.length)
      return
    const pending = batch
    batch = []
    await Promise.all(pending.map(s => runStep(s)))
    if (abortOnError.value && pending.some(s => stepStatus[s.id] === 'error'))
      aborted = true
  }
  for (const step of editing.value.steps) {
    if (aborted)
      break
    if (step.mode === 'parallel') {
      batch.push(step)
    }
    else {
      await flush()
      if (aborted)
        break
      await runStep(step)
      if (abortOnError.value && stepStatus[step.id] === 'error')
        aborted = true
    }
  }
  await flush()
  isRunning.value = false
  if (aborted)
    message.warning('遇到失败，已中止后续步骤')
  else
    message.success('编排执行完毕')
}

function stopAll() {
  for (const id of Object.values(runIdMap))
    projects.stop(id)
  message.info('已发送停止信号')
}

function statusLabel(s: 'idle' | 'running' | 'success' | 'error'): string {
  return { idle: '待运行', running: '运行中', success: '成功', error: '失败' }[s]
}

onMounted(() => {
  tasksStore.load()
})
</script>

<template>
  <NModal
    :show="show"
    title="任务编排"
    preset="card"
    style="width: 860px; max-width: 94vw"
    @update:show="v => emit('update:show', v)"
  >
    <div class="flex gap-3.5 min-h-[360px]">
      <div class="w-[200px] flex-none flex flex-col gap-2">
        <NButton size="small" block type="primary" @click="newPlan">
          ＋ 新建编排
        </NButton>
        <div class="flex-1 min-h-0 overflow-auto flex flex-col gap-1 border border-line rounded-lg p-1.5">
          <div
            v-for="p in tasksStore.plans"
            :key="p.id"
            class="flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-[13px] hover:bg-bg-elevated"
            :class="{ 'bg-accent text-white': p.id === activeId }"
            @click="selectPlan(p.id)"
          >
            <span>{{ p.name }}</span>
            <span class="opacity-60 hover:opacity-100 hover:text-[#ff7b72]" title="删除" @click.stop="tasksStore.remove(p.id); tasksStore.save()"><i class="i-carbon-close" /></span>
          </div>
          <div v-if="!tasksStore.plans.length" class="text-fg-dim text-xs p-2.5 text-center">
            暂无保存的编排
          </div>
        </div>
      </div>

      <div class="flex-1 min-w-0 flex flex-col gap-2.5">
        <template v-if="editing">
          <div class="flex items-center gap-2.5">
            <span class="text-xs text-fg-dim flex-none">名称</span>
            <NInput v-model:value="editing.name" size="small" placeholder="编排名称" class="flex-1" />
          </div>

          <div class="flex-1 overflow-auto flex flex-col gap-2 border border-line rounded-lg p-2.5 min-h-[120px]">
            <div v-for="(step, i) in editing.steps" :key="step.id" class="border border-line rounded-lg p-2 bg-bg-elevated">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="w-5 h-5 rounded-full bg-line text-fg inline-flex items-center justify-center text-[11px] flex-none">{{ i + 1 }}</span>
                <NSelect
                  v-model:value="step.projectId"
                  size="small"
                  :options="projectOptions"
                  placeholder="工程"
                  style="width: 150px"
                  @update:value="onProjectChange(step)"
                />
                <NSelect
                  v-model:value="step.packageId"
                  size="small"
                  :options="pkgOptionsFor(step)"
                  placeholder="子包"
                  style="width: 120px"
                  @update:value="onPkgChange(step)"
                />
                <NSelect
                  v-model:value="step.script"
                  size="small"
                  :options="scriptOptionsFor(step)"
                  placeholder="脚本"
                  style="width: 140px"
                />
                <NRadioGroup v-model:value="step.mode" size="small">
                  <NRadioButton value="serial">
                    串行
                  </NRadioButton>
                  <NRadioButton value="parallel">
                    并行
                  </NRadioButton>
                </NRadioGroup>
                <span class="text-[11px] py-px px-2 rounded-full flex-none border border-line" :class="`st-${stepStatus[step.id] || 'idle'}`">
                  {{ statusLabel(stepStatus[step.id] || 'idle') }}
                </span>
                <div class="ml-auto flex gap-1">
                  <NButton size="tiny" @click="moveStep(i, -1)">
                    <i class="i-carbon-arrow-up" />
                  </NButton>
                  <NButton size="tiny" @click="moveStep(i, 1)">
                    <i class="i-carbon-arrow-down" />
                  </NButton>
                  <NButton size="tiny" type="error" @click="removeStep(i)">
                    <i class="i-carbon-close" />
                  </NButton>
                </div>
              </div>
            </div>
            <div v-if="!editing.steps.length" class="text-fg-dim text-xs p-2.5 text-center">
              还没有步骤，点击下方「添加步骤」
            </div>
          </div>

          <div class="flex items-center gap-2">
            <NButton size="small" @click="addStep">
              ＋ 添加步骤
            </NButton>
            <NButton size="small" @click="save">
              保存方案
            </NButton>
            <label class="flex items-center gap-1.5 text-xs text-fg-dim">
              <n-switch v-model:value="abortOnError" size="small" />
              失败时中止
            </label>
            <NButton v-if="!isRunning" size="small" type="primary" :disabled="!editing.steps.length" @click="runPlan">
              <template #icon>
                <i class="i-carbon-play" />
              </template>
              运行编排
            </NButton>
            <NButton v-else size="small" type="warning" @click="stopAll">
              <template #icon>
                <i class="i-carbon-stop" />
              </template>
              停止
            </NButton>
          </div>
        </template>
        <div v-else class="text-fg-dim text-xs p-2.5 text-center">
          从左侧选择或新建一个编排方案
        </div>
      </div>
    </div>
  </NModal>
</template>
