<script setup lang="ts">
import type { SelectOption } from 'naive-ui'
import type { EnvManagerId, EnvSnapshot, NodeDistVersion } from '../../shared/types'
import { NButton, NSelect } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { dialog, message } from '../feedback'
import { api } from '../ipc'
import { useProjects } from '../stores/projects'
import ConsolePanel from './ConsolePanel.vue'

/**
 * 环境管理页：本机 Node 生态概览 + Node 版本快捷切换 + 版本管理工具检测/安装/卸载/切默认
 * + 包管理工具操作。命令执行走独立的 envRunCommand 通道（不绑定工程），
 * 日志复用现有事件流与控制台。
 */
const projects = useProjects()

// === 探测 ===
const snapshot = ref<EnvSnapshot | null>(null)
const detecting = ref(false)
async function detect() {
  detecting.value = true
  try {
    snapshot.value = await api.envDetect()
  }
  catch (e: unknown) {
    message.error(`探测失败：${e instanceof Error ? e.message : String(e)}`)
  }
  finally {
    detecting.value = false
  }
}

// === 工具配置（命令模板里的 {v} 会替换为版本号） ===
interface ManagerMeta {
  id: EnvManagerId
  name: string
  icon: string
  desc: string
  homepage: string
  /** 官方安装命令（未安装时展示 + 一键安装） */
  installCommand: string
  /** 安装指定 node 版本；null = 不支持单独安装 */
  installVersion: string | null
  /** 设默认版本；null = 安装即默认（volta/n/mise，用 installVersion 兼任切换） */
  setDefault: string | null
  /** 卸载命令（已安装卡片上的卸载按钮） */
  uninstall: string
  /** 卸载注意事项（确认弹窗里提示） */
  uninstallNote?: string
  /** 依赖已有 node/npm 才能安装 */
  requiresNode?: boolean
  /** 官方推荐的工具，卡片上挂「推荐」标签 */
  recommended?: boolean
}
const MANAGERS: ManagerMeta[] = [
  {
    id: 'vitep',
    name: 'Vite+',
    icon: 'i-tabler-brand-vite',
    desc: 'VoidZero 统一前端工具链：vp env 管理 Node 版本与包管理器，dev / build / test / lint 一体（基于 Vite 8 + Rolldown + Oxlint）',
    homepage: 'https://vite.plus',
    installCommand: 'curl -fsSL https://vite.plus | bash',
    installVersion: 'vp env install {v}',
    setDefault: 'vp env default {v}',
    uninstall: 'rm -rf "$HOME/.vite-plus"',
    uninstallNote: '安装脚本可能已在 ~/.zshrc / ~/.bashrc 写入初始化行，卸载后请手动移除',
    recommended: true,
  },
  {
    id: 'nvm',
    name: 'nvm',
    icon: 'i-tabler-stack-2',
    desc: '最流行的 Node 版本管理器，以 shell 函数形式工作，支持 .nvmrc',
    homepage: 'https://github.com/nvm-sh/nvm',
    installCommand: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash',
    installVersion: 'nvm install {v}',
    setDefault: 'nvm alias default {v}',
    uninstall: 'rm -rf "$HOME/.nvm"',
    uninstallNote: '请同时移除 shell 配置文件里的 nvm 初始化行',
  },
  {
    id: 'fnm',
    name: 'fnm',
    icon: 'i-tabler-rocket',
    desc: 'Rust 编写的高速 Node 版本管理器，启动快、兼容 .nvmrc / .node-version',
    homepage: 'https://github.com/Schniz/fnm',
    installCommand: 'curl -fsSL https://fnm.vercel.app/install | bash',
    installVersion: 'fnm install {v}',
    setDefault: 'fnm default {v}',
    uninstall: 'rm -rf "$HOME/.fnm"',
    uninstallNote: '若是 Homebrew 安装，请改用 brew uninstall fnm',
  },
  {
    id: 'volta',
    name: 'Volta',
    icon: 'i-tabler-battery-charging',
    desc: '按项目锁定工具链的 Node 管理器，安装即设为默认版本',
    homepage: 'https://volta.sh',
    installCommand: 'curl https://get.volta.sh | bash',
    installVersion: 'volta install node@{v}',
    setDefault: null,
    uninstall: 'rm -rf "$HOME/.volta"',
    uninstallNote: '请同时移除 shell 配置文件里的 volta 初始化行',
  },
  {
    id: 'n',
    name: 'n',
    icon: 'i-tabler-letter-n',
    desc: '极简风格的 Node 版本管理器（需要已有 npm）',
    homepage: 'https://github.com/tj/n',
    installCommand: 'npm install -g n',
    installVersion: 'n {v}',
    setDefault: null,
    uninstall: 'npm uninstall -g n; rm -rf /usr/local/n',
    requiresNode: true,
  },
  {
    id: 'mise',
    name: 'mise',
    icon: 'i-tabler-tools',
    desc: '多语言开发环境管理器，兼容 asdf 插件，速度更快',
    homepage: 'https://mise.jdx.dev',
    installCommand: 'curl https://mise.run | sh',
    installVersion: 'mise use -g node@{v}',
    setDefault: null,
    uninstall: 'rm -rf "$HOME/.local/share/mise" "$HOME/.config/mise"; rm -f "$HOME/.local/bin/mise"',
  },
  {
    id: 'asdf',
    name: 'asdf',
    icon: 'i-tabler-puzzle',
    desc: '插件化的多运行时版本管理器，支持海量语言与工具',
    homepage: 'https://asdf-vm.com',
    installCommand: 'git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.14.1',
    installVersion: 'asdf plugin add nodejs 2>/dev/null; asdf install nodejs {v}',
    setDefault: 'asdf global nodejs {v}',
    uninstall: 'rm -rf "$HOME/.asdf"',
    uninstallNote: '请同时移除 shell 配置文件里的 asdf 初始化行',
  },
]

interface PmMeta {
  key: 'pnpm' | 'yarn' | 'bun' | 'corepack'
  name: string
  icon: string
  desc: string
  /** 未安装时的安装命令 */
  installCommand: string
  /** 升级命令；null = 无升级入口 */
  upgradeCommand: string | null
  /** 卸载命令 */
  uninstall: string
  /** 卸载注意事项 */
  uninstallNote?: string
}
const PMS: PmMeta[] = [
  {
    key: 'pnpm',
    name: 'pnpm',
    icon: 'i-tabler-package',
    desc: '硬链接共享依赖，省磁盘、装得快，monorepo 首选',
    installCommand: 'npm install -g pnpm',
    upgradeCommand: 'npm install -g pnpm@latest',
    uninstall: 'npm uninstall -g pnpm',
    uninstallNote: '若经 Corepack / Vite+ 启用，请改用 corepack disable 关闭',
  },
  {
    key: 'yarn',
    name: 'Yarn',
    icon: 'i-tabler-brand-yarn',
    desc: '经典包管理器（Yarn Classic / Berry）',
    installCommand: 'npm install -g yarn',
    upgradeCommand: 'npm install -g yarn@latest',
    uninstall: 'npm uninstall -g yarn',
  },
  {
    key: 'bun',
    name: 'bun',
    icon: 'i-tabler-bread',
    desc: 'All-in-one 的 JS 运行时、包管理器与构建工具',
    installCommand: 'curl -fsSL https://bun.sh/install | bash',
    upgradeCommand: 'bun upgrade',
    uninstall: 'rm -rf "$HOME/.bun"',
    uninstallNote: '请同时移除 shell 配置文件里的 bun 初始化行',
  },
  {
    key: 'corepack',
    name: 'Corepack',
    icon: 'i-tabler-box',
    desc: 'Node 官方的包管理器版本管理器，按项目自动切 pnpm/yarn',
    installCommand: 'corepack enable 2>/dev/null || npm install -g corepack',
    upgradeCommand: null,
    uninstall: 'corepack disable 2>/dev/null; npm uninstall -g corepack',
  },
]

const RUNTIME_ICONS: Record<string, string> = {
  node: 'i-tabler-brand-nodejs',
  npm: 'i-tabler-package',
  pnpm: 'i-tabler-package',
  yarn: 'i-tabler-brand-yarn',
  bun: 'i-tabler-bread',
  corepack: 'i-tabler-box',
}

function runtimeOf(key: 'pnpm' | 'yarn' | 'bun' | 'corepack') {
  return snapshot.value?.runtimes.find(r => r.key === key) ?? null
}

// === 命令执行（复用事件流 + 控制台） ===
const currentRunId = ref<string | null>(null)
const currentOp = ref('')
const runInfo = computed(() =>
  currentRunId.value ? projects.runs[currentRunId.value] ?? null : null,
)
const running = computed(() => runInfo.value?.status === 'running')
const logs = computed(() =>
  currentRunId.value ? (projects.logs[currentRunId.value] ?? []) : [],
)

async function runOp(label: string, command: string) {
  if (running.value) {
    message.warning('有操作正在进行中，请等待完成或先停止')
    return
  }
  try {
    const info = await api.envRunCommand(command)
    currentOp.value = label
    currentRunId.value = info.runId
    projects.registerRun(info)
    message.info(`已开始：${label}`)
  }
  catch (e: unknown) {
    message.error(`启动失败：${e instanceof Error ? e.message : String(e)}`)
  }
}
async function stopOp() {
  if (!currentRunId.value)
    return
  await projects.stop(currentRunId.value)
  message.info('已发送停止信号')
}

// 操作结束后自动重新探测，刷新版本列表 / 默认版本
watch(() => runInfo.value?.status, (s, prev) => {
  if (prev === 'running' && s && s !== 'running') {
    message[s === 'error' ? 'error' : 'success'](
      s === 'error' ? `「${currentOp.value}」执行出错` : `「${currentOp.value}」已完成`,
    )
    setTimeout(detect, 600)
  }
})

// === Node 版本快捷切换 ===
interface SwitchEntry {
  version: string
  /** 装有该版本、且支持切换的管理工具（可能同版本被多个工具管理） */
  managers: { id: EnvManagerId, name: string }[]
}
const switchEntries = computed<SwitchEntry[]>(() => {
  const byVersion = new Map<string, SwitchEntry>()
  for (const m of snapshot.value?.managers ?? []) {
    if (!m.installed)
      continue
    const meta = MANAGERS.find(x => x.id === m.id)
    const switchCmd = meta?.setDefault ?? meta?.installVersion
    if (!switchCmd)
      continue
    for (const v of m.nodeVersions) {
      const ver = fmtVer(v)
      if (!byVersion.has(ver))
        byVersion.set(ver, { version: ver, managers: [] })
      byVersion.get(ver)!.managers.push({ id: m.id, name: meta?.name ?? m.name })
    }
  }
  return [...byVersion.values()].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
})
const activeNodeVersion = computed(() =>
  fmtVer(snapshot.value?.runtimes.find(r => r.key === 'node')?.version ?? null),
)
/** 当前激活版本的管理工具 id（切换时优先用同一个工具切，避免多工具打架） */
const activeManagerId = computed<EnvManagerId | null>(() => {
  const active = activeNodeVersion.value
  if (!active)
    return null
  const m = snapshot.value?.managers.find(
    m => m.installed && m.defaultVersion && fmtVer(m.defaultVersion) === active,
  )
  return m?.id ?? null
})
function switchTo(e: SwitchEntry) {
  if (e.version === activeNodeVersion.value) {
    message.info('该版本已是当前默认版本')
    return
  }
  const chosen = e.managers.find(m => m.id === activeManagerId.value) ?? e.managers[0]
  const meta = MANAGERS.find(x => x.id === chosen.id)
  const cmd = meta?.setDefault ?? meta?.installVersion
  if (!cmd)
    return
  runOp(`切换默认 Node 到 v${e.version}（${chosen.name}）`, cmd.replace('{v}', e.version))
}

// === 版本管理工具操作 ===
const versionSel = ref<Record<string, string | null>>({})

// === 版本下拉：远程拉取官方版本列表 + 模糊搜索 ===
// 注：选项不再做滚动增量。原因：n-select 内部默认 resetMenuOnOptionsChange=true，
// options 数组引用变化会触发其 treeMate watcher 调用 scrollToPendingNode()，
// 把滚动条强行归位到 pending 项（用户尚未选过时 = 第一项）。改用 NSelect 自带的虚拟滚动
// + 加 :reset-menu-on-options-change="false" 双保险，整列铺开放进去。
const remoteVersions = ref<NodeDistVersion[]>([])
const remoteLoading = ref(false)
const remoteLoaded = ref(false)
const remoteFailed = ref(false)

/** 拉取官方版本列表：失败不缓存，下次展开下拉自动重试 */
async function ensureRemoteVersions() {
  if (remoteLoaded.value || remoteLoading.value)
    return
  remoteLoading.value = true
  try {
    const list = await api.envNodeVersions()
    remoteVersions.value = list
    remoteLoaded.value = list.length > 0
    remoteFailed.value = list.length === 0
  }
  catch {
    remoteFailed.value = true
  }
  finally {
    remoteLoading.value = false
  }
}

const versionSearch = ref('')

/** 下拉展开时清空搜索、并触发首次远程拉取 */
function onVersionDropdown(show: boolean) {
  if (!show)
    return
  versionSearch.value = ''
  ensureRemoteVersions()
}

function onVersionSearch(q: string) {
  versionSearch.value = q
}

/** 模糊匹配：子串直接命中，或字符子序列（如 "2214" 命中 "22.14.0"，"lts" 命中所有 LTS） */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase().replace(/^v/, '')
  if (!q)
    return true
  const t = target.toLowerCase()
  if (t.includes(q))
    return true
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i])
      i++
  }
  return i === q.length
}

interface VersionCandidate {
  version: string
  label: string
  /** 模糊搜索匹配目标：版本号 + LTS 代号 + 已安装标记 */
  searchText: string
}

function versionCandidates(id: EnvManagerId): VersionCandidate[] {
  const installed = snapshot.value?.managers.find(x => x.id === id)?.nodeVersions ?? []
  const seen = new Set<string>()
  const list: VersionCandidate[] = []
  for (const v of installed) {
    const ver = fmtVer(v)
    if (seen.has(ver))
      continue
    seen.add(ver)
    list.push({ version: ver, label: `v${ver}（已安装）`, searchText: `${ver} 已安装 installed` })
  }
  for (const r of remoteVersions.value) {
    if (seen.has(r.version))
      continue
    seen.add(r.version)
    list.push({
      version: r.version,
      label: r.lts ? `v${r.version}（LTS · ${r.lts}）` : `v${r.version}`,
      searchText: `${r.version}${r.lts ? ` lts ${r.lts}` : ''}`,
    })
  }
  return list
}

function versionOptions(id: EnvManagerId): SelectOption[] {
  const q = versionSearch.value.trim()
  let matched = versionCandidates(id)
  if (q)
    matched = matched.filter(c => fuzzyMatch(q, c.searchText))
  const opts: SelectOption[] = matched.map(c => ({
    label: c.label,
    value: c.version,
  }))
  if (remoteFailed.value && !remoteLoading.value && remoteVersions.value.length === 0)
    opts.push({ label: '在线版本列表拉取失败，仅显示已安装版本（可手动输入版本号）', disabled: true })
  else if (q && opts.length === 0 && !remoteLoading.value)
    opts.push({ label: '无匹配版本；可回车直接使用输入的版本号', disabled: true })
  else if (matched.length >= 200)
    opts.push({ label: `共 ${matched.length} 条匹配，建议输入关键词缩小范围`, disabled: true })
  return opts
}
onMounted(() => {
  detect()
})

function validVersion(v: string): boolean {
  return /^\d+(?:\.\d+){0,2}$|^lts$/i.test(v.trim())
}
function installManagerVersion(m: ManagerMeta) {
  const v = (versionSel.value[m.id] ?? '').trim()
  if (!v || !validVersion(v)) {
    message.warning('请先在下拉中选择版本号（也支持直接输入，如 20 或 20.11.0）')
    return
  }
  if (!m.installVersion)
    return
  runOp(`${m.name} 安装 Node ${v}`, m.installVersion.replace('{v}', v))
}
function setDefaultManagerVersion(m: ManagerMeta) {
  const v = (versionSel.value[m.id] ?? '').trim()
  if (!v || !validVersion(v)) {
    message.warning('请先在下拉中选择已安装的版本号')
    return
  }
  if (!m.setDefault)
    return
  runOp(`${m.name} 设默认 Node ${v}`, m.setDefault.replace('{v}', v))
}
function quickInstall(m: ManagerMeta) {
  runOp(`安装 ${m.name}`, m.installCommand)
}
function uninstallManager(m: ManagerMeta) {
  dialog.warning({
    title: `卸载 ${m.name}`,
    content: `将执行：${m.uninstall}。${m.uninstallNote ? `${m.uninstallNote}。` : ''}该工具管理的 Node 版本通常存放在其目录内，会一并删除。此操作不可撤销，确定继续吗？`,
    positiveText: '卸载',
    negativeText: '取消',
    onPositiveClick: () => runOp(`卸载 ${m.name}`, m.uninstall),
  })
}

// === 包管理工具操作 ===
function installPm(pm: PmMeta) {
  runOp(`安装 ${pm.name}`, pm.installCommand)
}
function upgradePm(pm: PmMeta) {
  if (pm.upgradeCommand)
    runOp(`升级 ${pm.name}`, pm.upgradeCommand)
}
function uninstallPm(pm: PmMeta) {
  dialog.warning({
    title: `卸载 ${pm.name}`,
    content: `将执行：${pm.uninstall}。${pm.uninstallNote ? `${pm.uninstallNote}。` : ''}确定继续吗？`,
    positiveText: '卸载',
    negativeText: '取消',
    onPositiveClick: () => runOp(`卸载 ${pm.name}`, pm.uninstall),
  })
}

// === 杂项 ===
function fmtVer(v: string | null): string {
  return v ? v.replace(/^v/, '') : '—'
}
async function copyCommand(cmd: string) {
  try {
    await navigator.clipboard.writeText(cmd)
    message.success('命令已复制')
  }
  catch {
    message.error('复制失败')
  }
}
function openHomepage(url: string) {
  api.openUrl(url)
}
function isDefaultVersion(defaultVersion: string | null, v: string): boolean {
  if (!defaultVersion)
    return false
  return v === defaultVersion.replace(/^v/, '')
}
</script>

<template>
  <div class="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-bg text-fg">
    <div class="p-5 flex flex-col gap-5 max-w-[1080px] mx-auto">
      <!-- 页头 -->
      <div class="flex items-center gap-3 flex-none">
        <span class="w-9 h-9 rounded-[10px] bg-accent text-white flex items-center justify-center flex-none">
          <i class="i-tabler-leaf w-[20px] h-[20px]" />
        </span>
        <div class="flex flex-col min-w-0">
          <span class="text-[17px] font-semibold">环境管理</span>
          <span class="text-[12px] text-fg-dim">
            本机 Node 版本管理工具与包管理器
            <template v-if="snapshot">
              · 探测 shell：{{ snapshot.shell }}
            </template>
          </span>
        </div>
        <div class="ml-auto flex gap-2 flex-none">
          <NButton size="small" :loading="detecting" @click="detect">
            <template #icon>
              <i class="i-carbon-renew" />
            </template>
            重新探测
          </NButton>
        </div>
      </div>

      <!-- 本机生态概览 -->
      <section class="flex flex-col gap-2.5">
        <div class="text-[13px] font-semibold text-fg-dim tracking-wide">
          本机生态概览
        </div>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-2.5">
          <div
            v-for="r in snapshot?.runtimes ?? []"
            :key="r.key"
            class="rounded-xl border px-3 py-2.5 flex flex-col gap-1"
            :class="r.version ? 'border-line bg-bg-elevated' : 'border-line/60 bg-bg-elevated/40'"
            :title="r.path ?? '未安装'"
          >
            <div class="flex items-center gap-1.5">
              <i
                class="text-[14px] flex-none"
                :class="r.version ? RUNTIME_ICONS[r.key] : 'i-tabler-circle-minus opacity-40'"
              />
              <span class="text-[12.5px] font-mono font-medium">{{ r.key }}</span>
            </div>
            <span
              class="text-[13px] tabular-nums"
              :class="r.version ? 'font-medium' : 'text-fg-dim/70'"
            >{{ r.version ? fmtVer(r.version) : '未安装' }}</span>
          </div>
          <div v-if="!snapshot && detecting" class="col-span-6 text-[12.5px] text-fg-dim py-3">
            正在探测本机环境…
          </div>
        </div>
      </section>

      <!-- Node 版本快捷切换 -->
      <section class="flex flex-col gap-2.5">
        <div class="text-[13px] font-semibold text-fg-dim tracking-wide">
          Node 版本切换
        </div>
        <div class="rounded-xl border border-line bg-bg-elevated p-3.5 flex flex-col gap-2.5">
          <div class="flex items-center gap-2.5 flex-wrap">
            <span class="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center flex-none">
              <i class="i-tabler-arrows-exchange text-[17px]" />
            </span>
            <span class="text-[13px] text-fg-dim">当前激活</span>
            <span class="text-[16px] font-semibold font-mono tabular-nums">
              {{ activeNodeVersion === '—' ? '未检测到 Node' : `v${activeNodeVersion}` }}
            </span>
            <span
              v-if="activeManagerId"
              class="text-[11px] font-medium px-2 py-0.5 rounded-full text-fg-dim bg-[rgba(128,128,128,0.12)]"
            >
              由 {{ MANAGERS.find(x => x.id === activeManagerId)?.name }} 管理
            </span>
          </div>
          <div v-if="switchEntries.length" class="flex flex-wrap gap-1.5 items-center">
            <button
              v-for="e in switchEntries"
              :key="e.version"
              type="button"
              class="text-[12px] font-mono px-2.5 py-1 rounded-md border cursor-pointer transition-colors duration-150 flex items-center gap-1"
              :class="e.version === activeNodeVersion
                ? 'text-accent bg-[rgba(52,199,89,0.12)] border-accent/40 font-medium'
                : 'text-fg-dim bg-bg border-line hover:border-accent/50 hover:text-fg'"
              :title="`切换默认 Node 到 v${e.version}（经 ${e.managers.map(m => m.name).join(' / ')}）`"
              @click="switchTo(e)"
            >
              <i
                v-if="e.version === activeNodeVersion"
                class="i-tabler-check text-[12px]"
              />
              v{{ e.version }}
            </button>
          </div>
          <div v-else class="text-[12px] text-fg-dim/70">
            未通过任何版本管理工具检测到已安装的 Node 版本；安装工具并安装版本后会出现在这里，点击即一键切换
          </div>
          <div v-if="switchEntries.length" class="text-[11px] text-fg-dim/70">
            点击版本号一键切换默认版本；切换完成后新开的终端与 Runify 内运行命令都会使用该版本
          </div>
        </div>
      </section>

      <!-- 版本管理工具 -->
      <section class="flex flex-col gap-2.5">
        <div class="text-[13px] font-semibold text-fg-dim tracking-wide">
          版本管理工具
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div
            v-for="m in MANAGERS"
            :key="m.id"
            class="rounded-xl border p-3.5 flex flex-col gap-2.5"
            :class="snapshot?.managers.find(x => x.id === m.id)?.installed
              ? 'border-line bg-bg-elevated'
              : 'border-dashed border-line bg-bg-elevated/40'"
          >
            <!-- 头部：图标 + 名称 + 版本 + 主页 -->
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="w-8 h-8 rounded-lg flex items-center justify-center text-[17px] flex-none"
                :class="snapshot?.managers.find(x => x.id === m.id)?.installed
                  ? 'bg-accent text-white'
                  : 'bg-[rgba(128,128,128,0.10)] text-fg-dim'"
              >
                <i :class="m.icon" />
              </span>
              <span class="text-[14px] font-semibold font-mono">{{ m.name }}</span>
              <span
                v-if="m.recommended"
                class="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white bg-accent flex-none"
                title="官方推荐的一体化工具链"
              >推荐</span>
              <span
                v-if="snapshot?.managers.find(x => x.id === m.id)?.installed"
                class="text-[11px] font-medium px-2 py-0.5 rounded-full text-accent bg-[rgba(52,199,89,0.14)] flex items-center gap-1"
              >
                <i class="i-tabler-check text-[11px]" />
                已安装{{ snapshot?.managers.find(x => x.id === m.id)?.version ? ` · ${fmtVer(snapshot?.managers.find(x => x.id === m.id)?.version ?? null)}` : '' }}
              </span>
              <span
                v-else
                class="text-[11px] font-medium px-2 py-0.5 rounded-full text-fg-dim bg-[rgba(128,128,128,0.12)]"
              >未安装</span>
              <button
                type="button"
                class="flex-none w-5 h-5 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center text-fg-dim hover:text-accent"
                :title="`打开 ${m.homepage}`"
                @click="openHomepage(m.homepage)"
              >
                <i class="i-carbon-link text-[12px]" />
              </button>
              <button
                v-if="snapshot?.managers.find(x => x.id === m.id)?.installed"
                type="button"
                class="flex-none w-5 h-5 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center text-fg-dim hover:text-danger ml-auto"
                title="卸载该工具（会一并删除其管理的 Node 版本）"
                @click="uninstallManager(m)"
              >
                <i class="i-tabler-trash text-[13px]" />
              </button>
            </div>
            <div class="text-[11.5px] text-fg-dim leading-snug">
              {{ m.desc }}
            </div>

            <!-- 已安装：版本列表 + 管理操作 -->
            <template v-if="snapshot?.managers.find(x => x.id === m.id)?.installed">
              <div class="flex flex-wrap gap-1.5 items-center">
                <span
                  v-for="v in snapshot?.managers.find(x => x.id === m.id)?.nodeVersions ?? []"
                  :key="v"
                  class="text-[11px] font-mono px-2 py-0.5 rounded-md border border-line"
                  :class="isDefaultVersion(snapshot?.managers.find(x => x.id === m.id)?.defaultVersion ?? null, fmtVer(v))
                    ? 'text-accent bg-[rgba(52,199,89,0.12)] border-accent/40 font-medium'
                    : 'text-fg-dim bg-bg'"
                >
                  {{ fmtVer(v) }}
                </span>
                <span
                  v-if="!snapshot?.managers.find(x => x.id === m.id)?.nodeVersions.length"
                  class="text-[11.5px] text-fg-dim/70"
                >未通过该工具检测到已装的 Node 版本</span>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <NSelect
                  v-model:value="versionSel[m.id]"
                  size="small"
                  filterable
                  tag
                  clearable
                  remote
                  :options="versionOptions(m.id)"
                  :loading="remoteLoading"
                  placeholder="选择或输入版本号（支持模糊搜索）"
                  class="w-[210px]"
                  :reset-menu-on-options-change="false"
                  :disabled="!m.installVersion && !m.setDefault"
                  @update:show="onVersionDropdown"
                  @search="onVersionSearch"
                />
                <NButton
                  v-if="m.installVersion"
                  size="small"
                  type="primary"
                  secondary
                  :disabled="running"
                  @click="installManagerVersion(m)"
                >
                  安装此版本
                </NButton>
                <NButton
                  v-if="m.setDefault"
                  size="small"
                  secondary
                  :disabled="running"
                  @click="setDefaultManagerVersion(m)"
                >
                  设为默认
                </NButton>
                <span
                  v-if="!m.setDefault"
                  class="text-[11px] text-fg-dim/70"
                >{{ m.name === 'n' ? 'n 安装即切换' : '该工具安装即默认' }}</span>
              </div>
            </template>

            <!-- 未安装：快捷安装 -->
            <template v-else>
              <div class="flex items-center gap-2 bg-bg border border-line rounded-lg px-2.5 py-1.5 min-w-0">
                <code class="flex-1 min-w-0 text-[11.5px] font-mono text-fg-dim truncate" :title="m.installCommand">{{ m.installCommand }}</code>
                <button
                  type="button"
                  title="复制安装命令"
                  class="flex-none w-6 h-6 p-0 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-fg-dim hover:text-accent hover:bg-[rgba(128,128,128,0.10)]"
                  @click="copyCommand(m.installCommand)"
                >
                  <i class="i-carbon-copy text-[13px]" />
                </button>
              </div>
              <div class="flex items-center gap-2">
                <NButton size="small" type="primary" :disabled="running || (!!m.requiresNode && !snapshot?.runtimes.find(r => r.key === 'node')?.version)" @click="quickInstall(m)">
                  <template #icon>
                    <i class="i-carbon-play" />
                  </template>
                  一键安装
                </NButton>
                <span
                  v-if="m.requiresNode"
                  class="text-[11px] text-fg-dim/70"
                >需要先有 npm</span>
                <span class="text-[11px] text-fg-dim/70">安装完成后建议重启终端使 PATH 生效</span>
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- 包管理工具 -->
      <section class="flex flex-col gap-2.5">
        <div class="text-[13px] font-semibold text-fg-dim tracking-wide">
          包管理工具
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div
            v-for="pm in PMS"
            :key="pm.key"
            class="rounded-xl border p-3.5 flex flex-col gap-2.5"
            :class="runtimeOf(pm.key)?.version ? 'border-line bg-bg-elevated' : 'border-dashed border-line bg-bg-elevated/40'"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="w-8 h-8 rounded-lg flex items-center justify-center text-[17px] flex-none"
                :class="runtimeOf(pm.key)?.version
                  ? 'bg-accent text-white'
                  : 'bg-[rgba(128,128,128,0.10)] text-fg-dim'"
              >
                <i :class="pm.icon" />
              </span>
              <span class="text-[14px] font-semibold font-mono">{{ pm.name }}</span>
              <span
                v-if="runtimeOf(pm.key)?.version"
                class="text-[11px] font-medium px-2 py-0.5 rounded-full text-accent bg-[rgba(52,199,89,0.14)] tabular-nums flex items-center gap-1"
              >
                <i class="i-tabler-check text-[11px]" />
                {{ fmtVer(runtimeOf(pm.key)?.version ?? null) }}
              </span>
              <span
                v-else
                class="text-[11px] font-medium px-2 py-0.5 rounded-full text-fg-dim bg-[rgba(128,128,128,0.12)]"
              >未安装</span>
              <span
                v-if="runtimeOf(pm.key)?.path"
                class="text-[11px] text-fg-dim/70 font-mono truncate max-w-[220px]"
                :title="runtimeOf(pm.key)?.path"
              >{{ runtimeOf(pm.key)?.path }}</span>
              <button
                v-if="runtimeOf(pm.key)?.version"
                type="button"
                class="flex-none w-5 h-5 p-0 border-none bg-transparent cursor-pointer flex items-center justify-center text-fg-dim hover:text-danger ml-auto"
                :title="`卸载 ${pm.name}`"
                @click="uninstallPm(pm)"
              >
                <i class="i-tabler-trash text-[13px]" />
              </button>
            </div>
            <div class="text-[11.5px] text-fg-dim leading-snug">
              {{ pm.desc }}
            </div>
            <!-- 已安装：升级 -->
            <div v-if="runtimeOf(pm.key)?.version && pm.upgradeCommand" class="flex items-center gap-2">
              <NButton size="small" secondary :disabled="running" @click="upgradePm(pm)">
                <template #icon>
                  <i class="i-carbon-renew" />
                </template>
                升级到最新
              </NButton>
              <code class="text-[11px] font-mono text-fg-dim/70 truncate" :title="pm.upgradeCommand ?? ''">{{ pm.upgradeCommand }}</code>
            </div>
            <!-- 未安装：快捷安装 -->
            <div v-else-if="!runtimeOf(pm.key)?.version" class="flex items-center gap-2 flex-wrap">
              <NButton size="small" type="primary" :disabled="running" @click="installPm(pm)">
                <template #icon>
                  <i class="i-carbon-play" />
                </template>
                一键安装
              </NButton>
              <div class="flex items-center gap-1.5 bg-bg border border-line rounded-lg px-2.5 py-1.5 min-w-0 flex-1">
                <code class="flex-1 min-w-0 text-[11.5px] font-mono text-fg-dim truncate" :title="pm.installCommand">{{ pm.installCommand }}</code>
                <button
                  type="button"
                  title="复制安装命令"
                  class="flex-none w-6 h-6 p-0 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-fg-dim hover:text-accent hover:bg-[rgba(128,128,128,0.10)]"
                  @click="copyCommand(pm.installCommand)"
                >
                  <i class="i-carbon-copy text-[13px]" />
                </button>
              </div>
            </div>
            <!-- 已安装但无升级命令 -->
            <div v-else class="text-[11.5px] text-fg-dim/70">
              已就绪，跟随 Node 版本管理工具分发
            </div>
          </div>
        </div>
      </section>

      <!-- 操作输出 -->
      <section class="flex flex-col gap-2.5 flex-none">
        <div class="flex items-center gap-2.5">
          <div class="text-[13px] font-semibold text-fg-dim tracking-wide">
            操作输出
          </div>
          <span v-if="currentOp" class="text-[12px] text-fg-dim truncate">{{ currentOp }}</span>
          <span
            v-if="running"
            class="text-[11px] font-medium px-2 py-0.5 rounded-full text-accent bg-[rgba(52,199,89,0.14)] flex-none"
          >执行中</span>
          <NButton
            v-if="currentRunId && running"
            size="tiny"
            type="warning"
            class="ml-auto"
            @click="stopOp"
          >
            <template #icon>
              <i class="i-carbon-stop-outline" />
            </template>
            停止
          </NButton>
        </div>
        <ConsolePanel
          v-if="currentRunId"
          :run-id="currentRunId"
          :logs="logs"
          :running="running"
        />
        <div
          v-else
          class="h-[120px] rounded-lg border border-dashed border-line flex flex-col items-center justify-center gap-1.5 text-fg-dim"
        >
          <i class="i-carbon-terminal text-[22px] opacity-50" />
          <span class="text-[12px]">点「一键安装 / 安装此版本 / 设为默认 / 切换版本」后，命令输出会显示在这里</span>
        </div>
      </section>
    </div>
  </div>
</template>
