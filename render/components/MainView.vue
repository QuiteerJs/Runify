<script setup lang="ts">
import type { Project } from '../../shared/types'
import { NButton, NInput, NModal } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { dialog, message } from '../feedback'
import { api } from '../ipc'
import { useProjects } from '../stores/projects'
import CommandDetailPage from './CommandDetailPage.vue'
import ContextMenu from './ContextMenu.vue'
import EnvEditorModal from './EnvEditorModal.vue'
import EnvManagerPage from './EnvManagerPage.vue'
import ImportDialog from './ImportDialog.vue'
import OrchestrationModal from './OrchestrationModal.vue'
import PackageInfoModal from './PackageInfoModal.vue'
import ProjectDetailPage from './ProjectDetailPage.vue'
import ProjectGrid from './ProjectGrid.vue'
import RunListDialog from './RunListDialog.vue'
import SettingsModal from './SettingsModal.vue'
import Sidebar from './Sidebar.vue'

const projects = useProjects()

const showImport = ref(false)
const showSettings = ref(false)
/** 环境管理页显隐（主导航 / 账户菜单入口） */
const showEnv = ref(false)
const detailTarget = ref<{ projectId: string, packageId: string | null } | null>(null)
/** 侧栏选中的命令：主区渲染命令详情页（摘要条 + 控制台） */
const commandTarget = ref<{ projectId: string, packageId: string | null, scriptName: string } | null>(null)
const runTarget = ref<Project | null>(null)
const envTarget = ref<Project | null>(null)
const showOrchestration = ref(false)
const infoTarget = ref<Project | null>(null)
const noteTarget = ref<Project | null>(null)
const noteDraft = ref('')
const ctx = ref<{ x: number, y: number, project: Project, packageId: string | null } | null>(null)
const dragOver = ref(false)
let dragCounter = 0

function onDragEnter(e: DragEvent) {
  dragCounter++
  if (e.dataTransfer)
    e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}
function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    dragOver.value = false
  }
}
function onDropWithHighlight(e: DragEvent) {
  dragCounter = 0
  dragOver.value = false
  onDrop(e)
}

function openDetail(projectId: string, packageId: string | null = null) {
  detailTarget.value = { projectId, packageId }
}
function onCardRun(p: Project) {
  runTarget.value = p
}
function onCardInfo(p: Project) {
  infoTarget.value = p
}

function onSidebarHome() {
  detailTarget.value = null
  commandTarget.value = null
  showEnv.value = false
}

function onSidebarEnv() {
  detailTarget.value = null
  commandTarget.value = null
  showEnv.value = true
}

function onSidebarSelectProject(v: { projectId: string, packageId: string | null }) {
  // 与卡片点击打开详情走同一路径
  detailTarget.value = v
}

function onSidebarSelectCommand(v: { projectId: string, packageId: string | null, scriptName: string }) {
  commandTarget.value = v
}

// 选中命令持久化：重启后恢复上次查看的命令详情
const CMD_KEY = 'runify:selected-command'
watch(commandTarget, (v) => {
  try {
    if (v)
      localStorage.setItem(CMD_KEY, JSON.stringify(v))
    else
      localStorage.removeItem(CMD_KEY)
  }
  catch {
    // localStorage 不可用时静默失败
  }
})
onMounted(() => {
  try {
    const raw = localStorage.getItem(CMD_KEY)
    if (raw) {
      const v = JSON.parse(raw) as { projectId: string, packageId: string | null, scriptName: string }
      // 项目可能已被移除：不存在就不恢复
      if (v && projects.projects.some(p => p.id === v.projectId))
        commandTarget.value = v
    }
  }
  catch {
    // 损坏的缓存直接忽略
  }
})

/** 当前主区面板：用于侧栏主导航高亮 */
const activeView = computed<'home' | 'detail' | 'import' | 'orchestrate' | 'env' | 'settings'>(() => {
  if (showSettings.value)
    return 'settings'
  if (showOrchestration.value)
    return 'orchestrate'
  if (showImport.value)
    return 'import'
  if (detailTarget.value || commandTarget.value)
    return 'detail'
  if (showEnv.value)
    return 'env'
  return 'home'
})

async function handleImportPath(path: string) {
  if (!path)
    return
  try {
    const p = await projects.importProject(path)
    message.success(`已导入工程：${p.name}`)
    showImport.value = false
  }
  catch (e: unknown) {
    message.error(`导入失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file)
    handleImportPath(file.path)
}

function onContextMenu(e: MouseEvent, project: Project, packageId: string | null = null) {
  e.preventDefault()
  ctx.value = { x: e.clientX, y: e.clientY, project, packageId }
}
function closeCtx() {
  ctx.value = null
}

function ctxRun() {
  if (!ctx.value)
    return
  runTarget.value = ctx.value.project
  closeCtx()
}
async function ctxStop() {
  if (!ctx.value)
    return
  const id = projects.activeRunId(ctx.value.project.id, ctx.value.packageId)
  if (id) {
    await projects.stop(id)
    message.info('已发送停止信号')
  }
  closeCtx()
}
async function ctxOpenFolder() {
  if (!ctx.value)
    return
  const { project, packageId } = ctx.value
  const p = packageId
    ? project.packages.find(x => x.id === packageId)?.absolutePath ?? project.path
    : project.path
  await api.openFolder(p)
  closeCtx()
}
async function ctxCopyPath() {
  if (!ctx.value)
    return
  const { project, packageId } = ctx.value
  const p = packageId
    ? project.packages.find(x => x.id === packageId)?.absolutePath ?? project.path
    : project.path
  try {
    await navigator.clipboard.writeText(p)
    message.success('路径已复制')
  }
  catch {
    message.error('复制失败')
  }
  closeCtx()
}
async function ctxOpenTerminal() {
  if (!ctx.value)
    return
  const { project, packageId } = ctx.value
  const p = packageId
    ? project.packages.find(x => x.id === packageId)?.absolutePath ?? project.path
    : project.path
  await api.openTerminal(p)
  closeCtx()
}
async function ctxRefresh() {
  if (!ctx.value)
    return
  await projects.refreshProject(ctx.value.project.id)
  message.success('脚本已刷新')
  closeCtx()
}
async function ctxRemove() {
  if (!ctx.value)
    return
  confirmRemove(ctx.value.project)
  closeCtx()
}
async function confirmRemove(project: Project) {
  dialog.warning({
    title: '删除工程',
    content: `确定从 Runify 移除「${project.name}」吗？不会删除磁盘上的文件。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await projects.removeProject(project.id)
      message.success('已移除')
    },
  })
}
function onCardRemove(p: Project) {
  confirmRemove(p)
}
function ctxEditEnv() {
  if (!ctx.value)
    return
  envTarget.value = ctx.value.project
  closeCtx()
}
function ctxEditNote() {
  if (!ctx.value)
    return
  openNoteEditor(ctx.value.project)
  closeCtx()
}
function openNoteEditor(p: Project) {
  noteTarget.value = p
  noteDraft.value = p.note ?? ''
}
async function saveNote() {
  if (!noteTarget.value)
    return
  await projects.updateProject(noteTarget.value.id, { note: noteDraft.value })
  message.success('备注已保存')
  noteTarget.value = null
}
</script>

<template>
  <div class="flex flex-row h-full min-h-0 min-w-0 w-full">
    <Sidebar
      :active-target="detailTarget"
      :active-command="commandTarget"
      :active-view="activeView"
      @home="onSidebarHome"
      @import="showImport = true"
      @orchestrate="showOrchestration = true"
      @settings="showSettings = true"
      @env="onSidebarEnv"
      @select-project="onSidebarSelectProject"
      @select-command="onSidebarSelectCommand"
    />

    <div class="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
      <template v-if="!detailTarget && !commandTarget && !showEnv">
        <div
          class="runify-body flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4 bg-bg text-fg"
          :class="{ 'is-dragover': dragOver }"
          @dragenter="onDragEnter"
          @dragleave="onDragLeave"
          @drop="onDropWithHighlight"
          @dragover.prevent
        >
          <div v-if="projects.projects.length === 0" class="h-full flex flex-col items-center justify-center text-fg-dim gap-3 p-8">
            <div class="text-5xl leading-none">
              <i class="i-carbon-package" />
            </div>
            <div class="text-lg font-semibold text-fg">
              还没有工程
            </div>
            <div class="text-[13px] text-fg-dim">
              把项目文件夹拖到这里，或点击下方按钮导入
            </div>
            <NButton type="primary" @click="showImport = true">
              导入工程
            </NButton>
            <ol class="list-none m-0 mt-4 p-0 flex flex-col gap-2.5 max-w-[420px] w-full">
              <li class="flex items-start gap-2.5 text-[13px] text-fg bg-bg-elevated border border-line rounded-[10px] p-2.5">
                <span class="w-[22px] h-[22px] rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold flex-none mt-0.5">1</span>
                <span><b>导入</b>：拖拽或选择文件夹，自动识别类型、脚本与子包</span>
              </li>
              <li class="flex items-start gap-2.5 text-[13px] text-fg bg-bg-elevated border border-line rounded-[10px] p-2.5">
                <span class="w-[22px] h-[22px] rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold flex-none mt-0.5">2</span>
                <span><b>运行</b>：点击脚本 chip 一键跑，或「运行」按钮选脚本与参数</span>
              </li>
              <li class="flex items-start gap-2.5 text-[13px] text-fg bg-bg-elevated border border-line rounded-[10px] p-2.5">
                <span class="w-[22px] h-[22px] rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold flex-none mt-0.5">3</span>
                <span><b>编排</b>：用侧栏「任务编排」把多个工程串/并行跑成流水线</span>
              </li>
            </ol>
          </div>
          <ProjectGrid
            v-else
            :projects="projects.projects"
            @open="openDetail"
            @run="onCardRun"
            @remove="onCardRemove"
            @info="onCardInfo"
            @context-menu="onContextMenu"
          />
        </div>
      </template>

      <ProjectDetailPage
        v-else-if="detailTarget"
        :target="detailTarget"
        @close="detailTarget = null"
      />

      <!-- 侧栏单击命令：命令详情页（摘要条 + 控制台） -->
      <CommandDetailPage
        v-else-if="commandTarget"
        :target="commandTarget!"
        @close="commandTarget = null"
      />

      <!-- 环境管理页（主导航 / 账户菜单入口） -->
      <EnvManagerPage v-else-if="showEnv" />
    </div>

    <ImportDialog v-model:show="showImport" @pick="handleImportPath" />
    <SettingsModal v-model:show="showSettings" />
    <OrchestrationModal v-model:show="showOrchestration" />
    <RunListDialog
      v-if="runTarget"
      :project="runTarget"
      @close="runTarget = null"
    />
    <PackageInfoModal
      v-if="infoTarget"
      :project="infoTarget"
      @close="infoTarget = null"
    />
    <EnvEditorModal
      v-if="envTarget"
      :project="envTarget"
      @close="envTarget = null"
      @saved="envTarget = null"
    />
    <ContextMenu
      v-if="ctx"
      :x="ctx.x"
      :y="ctx.y"
      :project="ctx.project"
      :package-id="ctx.packageId"
      :running="!!projects.activeRunId(ctx.project.id, ctx.packageId)"
      @run="ctxRun"
      @stop="ctxStop"
      @edit-env="ctxEditEnv"
      @edit-note="ctxEditNote"
      @open-folder="ctxOpenFolder"
      @copy-path="ctxCopyPath"
      @open-terminal="ctxOpenTerminal"
      @refresh="ctxRefresh"
      @remove="ctxRemove"
      @close="closeCtx"
    />

    <NModal
      v-if="noteTarget"
      :show="true"
      title="编辑备注"
      preset="card"
      style="width: 480px"
      @update:show="v => !v && (noteTarget = null)"
    >
      <NInput
        v-model:value="noteDraft"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 8 }"
        placeholder="给这个工程写点备注…"
      />
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px">
        <NButton @click="noteTarget = null">
          取消
        </NButton>
        <NButton type="primary" @click="saveNote">
          保存
        </NButton>
      </div>
    </NModal>
  </div>
</template>
