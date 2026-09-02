<script setup lang="ts">
import { NPopover } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import { message } from '../feedback'
import { buildRunRequest } from '../run-utils'
import { useProjects } from '../stores/projects'
import { useSettings } from '../stores/settings'

/** 侧栏命令选中态（主区据此渲染命令详情页） */
interface CommandTarget {
  projectId: string
  packageId: string | null
  scriptName: string
}

const props = defineProps<{
  /** 主区打开的工程 / 子包（用于侧栏项目列表选中态） */
  activeTarget?: { projectId: string, packageId: string | null } | null
  /** 侧栏选中的命令（用于命令行高亮） */
  activeCommand?: CommandTarget | null
  /** 当前主区面板（用于主导航高亮） */
  activeView: 'home' | 'detail' | 'import' | 'orchestrate' | 'env' | 'settings'
}>()

const emit = defineEmits<{
  home: []
  import: []
  orchestrate: []
  settings: []
  /** 打开环境管理页 */
  env: []
  /** 点击项目列表里的工程 / 子包（打开完整详情页） */
  selectProject: [v: { projectId: string, packageId: string | null }]
  /** 单击命令行：主区切换到该命令的控制台 */
  selectCommand: [v: CommandTarget]
}>()

const projectsStore = useProjects()
const settingsStore = useSettings()
// 主题走统一入口：setTheme 内部完成「改内存 → 落盘 → 同步主进程 nativeTheme」，
// 不再直接改 settings store（那样只改内存、原生层完全不知情）
const { themeMode, setTheme } = useTheme()

const projects = computed(() => projectsStore.projects)
const appVersion = computed(() => '0.1.0')

// 只渲染两个手动档位；'system' 仍在底层作为「首次启动/跟随系统」的默认值，
// 用户主动选过「浅色/深色」后就锁到手动档位，不再弹按钮打扰。
const themeOptions = computed(() => [
  { key: 'light' as const, label: '浅色' },
  { key: 'dark' as const, label: '深色' },
])

// DEBUG removed

// === 项目折叠组 + 命令列表 ===
const projectsExpanded = ref(true)
function toggleProjects() {
  projectsExpanded.value = !projectsExpanded.value
}

// 展开状态持久化：重启后恢复上次展开的项目
const EXPAND_KEY = 'runify:expanded-projects'
function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(EXPAND_KEY) ?? '{}') as Record<string, boolean>
  }
  catch {
    return {}
  }
}
const expandedProjectIds = ref<Record<string, boolean>>(loadExpanded())
watch(expandedProjectIds, (v) => {
  try {
    localStorage.setItem(EXPAND_KEY, JSON.stringify(v))
  }
  catch {
    // localStorage 不可用时静默失败，不影响功能
  }
}, { deep: true })
function toggleProject(id: string) {
  expandedProjectIds.value[id] = !expandedProjectIds.value[id]
}

/** 命令条目 */
interface CmdEntry {
  key: string
  packageId: string | null
  packageName: string
  script: string
  label: string
  command: string
}

/**
 * 侧栏命令分区：保持层级 —— 根目录脚本直接平铺，
 * 子包脚本挂在子包分组头（可折叠）下面，不再拍成「包名:脚本」
 */
interface CmdSection {
  key: string
  packageId: string | null
  packageName: string
  /** true = 子包分组（有自己的分组头行）；false = 根脚本（直接平铺） */
  isGroup: boolean
  scripts: CmdEntry[]
}

function sectionsOf(projectId: string): CmdSection[] {
  const p = projectsStore.projects.find(x => x.id === projectId)
  if (!p)
    return []
  const rootScripts: CmdEntry[] = p.scripts.map(s => ({
    key: `root:${s.name}`,
    packageId: null,
    packageName: p.name,
    script: s.name,
    label: s.name,
    command: s.command,
  }))
  // 没有子包的工程：整体一层平铺，不引入多余层级
  if (p.packages.length === 0)
    return [{ key: 'root', packageId: null, packageName: p.name, isGroup: false, scripts: rootScripts }]
  const sections: CmdSection[] = []
  if (rootScripts.length > 0)
    sections.push({ key: 'root', packageId: null, packageName: p.name, isGroup: false, scripts: rootScripts })
  for (const pkg of p.packages) {
    sections.push({
      key: pkg.id,
      packageId: pkg.id,
      packageName: pkg.name,
      isGroup: true,
      scripts: pkg.scripts.map(s => ({
        key: `${pkg.id}:${s.name}`,
        packageId: pkg.id,
        packageName: pkg.name,
        script: s.name,
        label: s.name,
        command: s.command,
      })),
    })
  }
  return sections
}

// 子包分组展开状态持久化：未记录的包默认展开（!== false）
const PKG_EXPAND_KEY = 'runify:expanded-packages'
function loadPkgExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PKG_EXPAND_KEY) ?? '{}') as Record<string, boolean>
  }
  catch {
    return {}
  }
}
const expandedPackageIds = ref<Record<string, boolean>>(loadPkgExpanded())
watch(expandedPackageIds, (v) => {
  try {
    localStorage.setItem(PKG_EXPAND_KEY, JSON.stringify(v))
  }
  catch {
    // localStorage 不可用时静默失败，不影响功能
  }
}, { deep: true })
function togglePackage(id: string) {
  expandedPackageIds.value[id] = !(expandedPackageIds.value[id] !== false)
}
function isPkgExpanded(id: string): boolean {
  return expandedPackageIds.value[id] !== false
}

function isCmdRunning(projectId: string, c: CmdEntry): boolean {
  return !!projectsStore.activeRunIdOfScript(projectId, c.packageId, c.script)
}
function runningCountOfSection(projectId: string, sec: CmdSection): number {
  return sec.scripts.filter(c => isCmdRunning(projectId, c)).length
}
function runningCountOf(projectId: string): number {
  return sectionsOf(projectId).reduce((n, sec) => n + runningCountOfSection(projectId, sec), 0)
}
function isCmdActive(projectId: string, c: CmdEntry): boolean {
  return !!props.activeCommand
    && props.activeCommand.projectId === projectId
    && (props.activeCommand.packageId ?? null) === c.packageId
    && props.activeCommand.scriptName === c.script
}

/** 侧栏 hover 播放按钮：直接运行并选中该命令 */
async function runCommand(projectId: string, c: CmdEntry) {
  const p = projectsStore.projects.find(x => x.id === projectId)
  if (!p)
    return
  const req = buildRunRequest({
    project: p,
    packageId: c.packageId,
    script: c.script,
    shell: '',
    params: '',
    defaultShell: settingsStore.settings.defaultShell,
  })
  await projectsStore.run(req)
  message.info(`启动：${c.packageName} / ${c.script}`)
  emit('selectCommand', { projectId, packageId: c.packageId, scriptName: c.script })
}
async function stopCommand(projectId: string, c: CmdEntry) {
  const id = projectsStore.activeRunIdOfScript(projectId, c.packageId, c.script)
  if (id) {
    await projectsStore.stop(id)
    message.info('已发送停止信号')
  }
}
function selectCommand(projectId: string, c: CmdEntry) {
  emit('selectCommand', { projectId, packageId: c.packageId, scriptName: c.script })
}

// === 选中态 ===
function onPackageClick(projectId: string, packageId: string | null) {
  emit('selectProject', { projectId, packageId })
}

// === 账户大菜单 ===
const userMenuOpen = ref(false)
function closeUserMenu() {
  userMenuOpen.value = false
}

const userName = 'Quiteer'
async function copyUserName() {
  try {
    await navigator.clipboard.writeText(userName)
  }
  catch {
    // 剪贴板不可用时静默失败
  }
}
function openEnvManager() {
  emit('env')
  closeUserMenu()
}
function logout() {
  window.location.reload()
}

const navItems = computed(() => [
  {
    key: 'home',
    icon: 'i-tabler-home',
    label: '全部工程',
    count: projects.value.length,
    active: props.activeView === 'home',
    onClick: () => emit('home'),
  },
  {
    key: 'import',
    icon: 'i-carbon-folder-add',
    label: '导入工程',
    count: 0,
    active: props.activeView === 'import',
    onClick: () => emit('import'),
  },
  {
    key: 'env',
    icon: 'i-tabler-leaf',
    label: '环境管理',
    count: 0,
    active: props.activeView === 'env',
    onClick: () => emit('env'),
  },
  {
    key: 'history',
    icon: 'i-tabler-history',
    label: '运行历史',
    count: 0,
    active: false,
    tag: 'SOON',
    onClick: () => {},
  },
] as const)
</script>

<template>
  <aside class="w-[280px] flex-none bg-bg-elevated flex flex-col h-full overflow-hidden text-fg select-none">
    <!-- 1. 品牌 / logo 区 -->
    <div class="flex items-center gap-2.5 px-4 pt-3.5 pb-3 select-none border-b border-line/50 flex-none">
      <span class="w-8 h-8 rounded-[10px] bg-accent text-white flex items-center justify-center text-[18px] flex-none">
        <i class="i-lucide-zap" />
      </span>
      <span class="flex flex-col min-w-0 leading-tight">
        <span class="text-[15px] font-semibold text-fg tracking-wide truncate">Runify</span>
        <span class="text-[11px] text-fg-dim opacity-80">v{{ appVersion }}</span>
      </span>
    </div>

    <!-- 2. 主导航（随 activeView 高亮当前项） -->
    <nav class="flex flex-col gap-0.5 px-2 pt-2 pb-2 flex-none">
      <button
        v-for="item in navItems"
        :key="item.key"
        type="button"
        class="flex items-center gap-2.5 h-9 px-3 rounded-lg border-none text-[13.5px] cursor-pointer text-left transition-colors duration-150 hover:bg-[rgba(128,128,128,0.10)] hover:text-fg active:scale-[0.99]"
        :class="item.active
          ? 'bg-[rgba(52,199,89,0.12)] text-fg font-medium'
          : 'bg-transparent text-fg-dim font-normal'"
        @click="item.onClick"
      >
        <i :class="item.icon" class="w-4 text-center text-[16px] flex-none" />
        <span class="flex-1 min-w-0 truncate">{{ item.label }}</span>
        <span v-if="item.count" class="text-[11px] text-fg-dim bg-[rgba(128,128,128,0.12)] rounded-full px-1.5 py-px flex-none">{{ item.count }}</span>
        <span v-else-if="'tag' in item && item.tag" class="text-[10px] font-semibold text-fg-dim tracking-wider flex-none">{{ item.tag }}</span>
      </button>
    </nav>

    <!-- 3. 项目折叠组（整行可点击展开） -->
    <div class="flex flex-col gap-1 px-2 flex-1 min-h-0">
      <button
        type="button"
        class="flex items-center gap-1.5 h-7 px-2 rounded-md border-none bg-transparent text-fg-dim text-[12px] font-semibold cursor-pointer transition-colors duration-150 hover:text-fg flex-none"
        @click="toggleProjects"
      >
        <i
          class="text-[14px] flex-none transition-transform duration-200 i-tabler-chevron-down"
          :class="{ '-rotate-90': !projectsExpanded }"
        />
        <span class="flex-1 min-w-0 text-left">项目</span>
        <span class="text-fg-dim opacity-70 font-normal">({{ projects.length }})</span>
      </button>
      <ul
        v-show="projectsExpanded"
        class="sidebar__group-list flex flex-col gap-0.5 pl-1 py-1.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
      >
        <li
          v-for="p in projects"
          :key="p.id"
          class="flex flex-col gap-0.5"
        >
          <button
            type="button"
            class="flex items-center gap-2 h-8 px-2.5 rounded-lg border-none bg-transparent text-fg text-[13px] font-normal cursor-pointer text-left transition-colors duration-150 hover:bg-[rgba(128,128,128,0.10)] active:scale-[0.99]"
            @click="toggleProject(p.id)"
          >
            <i
              class="i-tabler-chevron-down w-3.5 text-[13px] text-fg-dim flex-none transition-transform duration-200"
              :class="{ '-rotate-90': !expandedProjectIds[p.id] }"
            />
            <i class="i-tabler-folder w-4 text-center text-[14px] text-fg-dim flex-none" />
            <span class="truncate flex-1 min-w-0">{{ p.name }}</span>
            <span
              v-if="runningCountOf(p.id)"
              class="text-[10.5px] text-accent bg-[rgba(52,199,89,0.14)] rounded-full px-1.5 py-px flex-none"
              :title="`${runningCountOf(p.id)} 个命令运行中`"
            >{{ runningCountOf(p.id) }}</span>
          </button>
          <!-- 命令列表（有层级）：根脚本平铺，子包作为可折叠分组挂自己的命令 -->
          <ul v-show="expandedProjectIds[p.id]" class="flex flex-col gap-0.5 pl-3 border-l border-line/40 ml-3.5 my-0.5">
            <li
              v-for="sec in sectionsOf(p.id)"
              :key="sec.key"
              class="flex flex-col gap-0.5"
            >
              <!-- 子包分组头（可折叠，带运行数徽章） -->
              <button
                v-if="sec.isGroup"
                type="button"
                class="flex items-center gap-1.5 h-7 px-2 rounded-md border-none bg-transparent text-fg-dim text-[12.5px] font-medium cursor-pointer text-left transition-colors duration-150 hover:bg-[rgba(128,128,128,0.10)] hover:text-fg"
                :title="`子包 ${sec.packageName}`"
                @click="togglePackage(sec.key)"
              >
                <i
                  class="i-tabler-chevron-down w-3 text-[11px] flex-none transition-transform duration-200"
                  :class="{ '-rotate-90': !isPkgExpanded(sec.key) }"
                />
                <i class="i-tabler-folder w-3.5 text-center text-[12px] text-fg-dim flex-none" />
                <span class="truncate flex-1 min-w-0">{{ sec.packageName }}</span>
                <span
                  v-if="runningCountOfSection(p.id, sec)"
                  class="text-[10.5px] text-accent bg-[rgba(52,199,89,0.14)] rounded-full px-1.5 py-px flex-none"
                  :title="`${runningCountOfSection(p.id, sec)} 个命令运行中`"
                >{{ runningCountOfSection(p.id, sec) }}</span>
              </button>
              <!-- 脚本行：根脚本随项目展开；子包脚本再随分组头展开 -->
              <ul
                v-show="!sec.isGroup || isPkgExpanded(sec.key)"
                class="flex flex-col gap-0.5"
                :class="sec.isGroup ? 'pl-3 ml-2 border-l border-line/30 my-0.5' : ''"
              >
                <li
                  v-for="c in sec.scripts"
                  :key="c.key"
                  class="group/cmd flex items-center gap-2 h-7 px-2.5 rounded-md text-[12.5px] cursor-pointer transition-colors duration-150"
                  :class="isCmdActive(p.id, c)
                    ? 'bg-[rgba(52,199,89,0.12)] text-fg font-medium'
                    : 'text-fg-dim hover:bg-[rgba(128,128,128,0.10)] hover:text-fg'"
                  :title="`${sec.packageName} · ${c.command}`"
                  @click="selectCommand(p.id, c)"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full flex-none"
                    :class="isCmdRunning(p.id, c) ? 'bg-accent' : 'bg-line/80 group-hover/cmd:bg-fg-dim/50'"
                  />
                  <span class="truncate flex-1 min-w-0 font-mono">{{ c.label }}</span>
                  <button
                    v-if="!isCmdRunning(p.id, c)"
                    type="button"
                    title="运行这条命令"
                    class="flex-none w-4 h-4 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center text-accent opacity-0 group-hover/cmd:opacity-100 transition-opacity duration-150"
                    @click.stop="runCommand(p.id, c)"
                  >
                    <i class="i-carbon-play text-[12px]" />
                  </button>
                  <button
                    v-else
                    type="button"
                    title="停止这条命令"
                    class="flex-none w-4 h-4 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center text-danger opacity-0 group-hover/cmd:opacity-100 transition-opacity duration-150"
                    @click.stop="stopCommand(p.id, c)"
                  >
                    <i class="i-carbon-stop-outline text-[12px]" />
                  </button>
                </li>
                <li
                  v-if="sec.scripts.length === 0"
                  class="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-dim/60 cursor-default"
                >
                  <span class="truncate">{{ sec.isGroup ? '该子包没有脚本' : '未检测到脚本' }}</span>
                </li>
              </ul>
            </li>
            <li
              class="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12.5px] text-fg-dim/70 cursor-pointer transition-colors duration-150 hover:bg-[rgba(128,128,128,0.10)] hover:text-fg"
              title="打开完整工程详情（脚本树 / 环境变量 / 备注）"
              @click="onPackageClick(p.id, null)"
            >
              <i class="i-carbon-information w-3.5 text-[12px] flex-none" />
              <span class="truncate">查看工程详情</span>
            </li>
          </ul>
        </li>
        <li
          v-if="projects.length === 0"
          class="flex items-center gap-2 h-8 px-2.5 rounded-lg border-none bg-transparent text-fg-dim text-[13px] cursor-default text-left"
        >
          <span class="truncate">暂无工程</span>
        </li>
      </ul>
    </div>

    <!-- 4. 底部账户（点击向上弹出大菜单） -->
    <NPopover
      v-model:show="userMenuOpen"
      trigger="click"
      placement="top-end"
      :show-arrow="false"
      raw
    >
      <template #trigger>
        <div class="flex items-center gap-2.5 cursor-pointer select-none rounded-xl px-3 pb-4 border-t border-line/40 transition-colors duration-150 flex-none">
          <span class="w-7 h-7 rounded-full bg-accent text-white font-bold text-[12px] flex items-center justify-center flex-none">Q</span>
          <span class="text-[13px] font-semibold text-fg truncate">{{ userName }}</span>
        </div>
      </template>

      <div class="flex flex-col gap-1 min-w-[260px] py-2 bg-bg-elevated border border-line rounded-xl shadow-[0_12px_32px_rgba(0,0,0,0.45)] overflow-hidden text-fg">
        <!-- 头部：用户名 + 复制 -->
        <div class="flex items-center gap-2 px-3 pb-2 mb-1 border-b border-line/60">
          <span class="flex-1 text-[14px] font-semibold text-fg truncate">{{ userName }}</span>
          <button
            type="button"
            title="复制"
            class="w-6 h-6 flex items-center justify-center border-none bg-transparent rounded text-fg-dim cursor-pointer text-[14px] hover:text-fg hover:bg-[rgba(128,128,128,0.10)]"
            @click="copyUserName"
          >
            <i class="i-carbon-copy" />
          </button>
        </div>

        <!-- 等级 / 推广位 -->
        <div class="flex items-center gap-2.5 px-3 h-9 text-[13px] text-fg rounded-md transition-colors duration-150 bg-bg-card/40">
          <i class="i-tabler-crown" />
          <span class="flex-1 min-w-0 truncate">体验版</span>
          <span class="text-[10px] font-semibold text-white bg-accent rounded-full px-1.5 py-px flex-none">升级</span>
        </div>

        <div class="h-px bg-line/60 my-1 mx-3" />

        <!-- 设置类（低频操作） -->
        <div
          class="flex items-center gap-2.5 px-3 h-9 text-[13px] text-fg rounded-md transition-colors duration-150 cursor-pointer hover:bg-[rgba(128,128,128,0.10)]"
          @click="emit('settings'); closeUserMenu()"
        >
          <i class="i-tabler-settings" />
          <span class="flex-1 min-w-0 truncate">设置</span>
        </div>
        <div
          class="flex items-center gap-2.5 px-3 h-9 text-[13px] text-fg rounded-md transition-colors duration-150 cursor-pointer hover:bg-[rgba(128,128,128,0.10)]"
          @click="openEnvManager"
        >
          <i class="i-tabler-leaf" />
          <span class="flex-1 min-w-0 truncate">环境管理</span>
        </div>
        <div class="flex items-center gap-2.5 px-3 h-9 text-[13px] text-fg rounded-md transition-colors duration-150 cursor-default">
          <i class="i-tabler-palette" />
          <span class="flex-1 min-w-0 truncate">外观</span>
          <div class="inline-flex items-center rounded-lg border border-line/80 overflow-hidden">
            <button
              v-for="opt in themeOptions"
              :key="opt.key"
              type="button"
              class="px-3 py-1 text-[12px] border-none cursor-pointer transition-colors duration-150"
              :class="themeMode === opt.key
                ? 'bg-fg text-bg font-semibold'
                : 'bg-bg-card text-fg-dim hover:text-fg'"
              @click="setTheme(opt.key)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2.5 px-3 h-9 text-[13px] text-fg rounded-md transition-colors duration-150 cursor-pointer hover:bg-[rgba(128,128,128,0.10)]" @click="closeUserMenu">
          <i class="i-tabler-help" />
          <span class="flex-1 min-w-0 truncate">帮助与反馈</span>
        </div>
        <div class="flex items-center gap-2.5 px-3 h-9 text-[13px] text-fg rounded-md transition-colors duration-150 cursor-pointer hover:bg-[rgba(128,128,128,0.10)]" @click="closeUserMenu">
          <i class="i-tabler-refresh" />
          <span class="flex-1 min-w-0 truncate">检查更新</span>
        </div>

        <div class="h-px bg-line/60 my-1 mx-3" />

        <div class="flex items-center gap-2.5 px-3 h-9 text-[13px] text-fg rounded-md transition-colors duration-150 cursor-pointer hover:bg-[rgba(128,128,128,0.10)] text-danger hover:!bg-[rgba(229,72,77,0.12)]" @click="logout">
          <i class="i-tabler-logout" />
          <span class="flex-1 min-w-0 truncate">退出登录</span>
        </div>
      </div>
    </NPopover>
  </aside>
</template>
