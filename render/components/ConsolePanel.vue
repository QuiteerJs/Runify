<script setup lang="ts">
import type { LogEntry } from '../../shared/types'
import { NButton, NButtonGroup, NInput, NRadioButton, NRadioGroup, NSwitch } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { dialog, message } from '../feedback'
import { api } from '../ipc'
import { useProjects } from '../stores/projects'

const props = withDefaults(defineProps<{ runId: string | null, logs: LogEntry[], running: boolean, /** true = 根元素与日志区吃满父容器高度（命令详情页用）；默认固定 320px（详情页脚本树布局用） */ fill?: boolean }>(), { fill: false })

const projects = useProjects()

const mode = ref<'terminal' | 'structured'>('terminal')
const autoScroll = ref(true)
const showTs = ref(true)
// 两种模式各用一个 ref：v-if/v-else 分支共用同一个 ref 名，切换时赋值顺序不稳定
const termScroller = ref<HTMLElement | null>(null)
const structScroller = ref<HTMLElement | null>(null)
const scroller = computed<HTMLElement | null>(() =>
  mode.value === 'terminal' ? termScroller.value : structScroller.value,
)

const filterText = ref('')
const streamFilter = ref<'all' | 'stdout' | 'stderr'>('all')

const filtered = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  return props.logs.filter((l) => {
    if (streamFilter.value !== 'all' && l.stream !== streamFilter.value)
      return false
    if (q && !l.text.toLowerCase().includes(q))
      return false
    return true
  })
})

interface TextSeg { text: string, hit: boolean }
function splitByQuery(text: string): TextSeg[] {
  const q = filterText.value.trim()
  if (!q)
    return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const lq = q.toLowerCase()
  const out: TextSeg[] = []
  let i = 0
  while (true) {
    const idx = lower.indexOf(lq, i)
    if (idx < 0) {
      if (i < text.length)
        out.push({ text: text.slice(i), hit: false })
      break
    }
    if (idx > i)
      out.push({ text: text.slice(i, idx), hit: false })
    out.push({ text: text.slice(idx, idx + q.length), hit: true })
    i = idx + q.length
  }
  return out
}

/**
 * 把一行日志切成「普通文本 / 链接」两类片段。
 * dev server 的启动日志里几乎必然带 http://localhost:xxxx 地址，
 * 之前只能靠肉眼复制，现在直接可点。
 */
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi
/** 句子末尾紧跟的标点不属于 URL（例如 "see http://localhost:3000."），需要剥掉 */
const TRAILING_PUNCT = /[.,;:!?'")\]}]+$/

interface Token { link: boolean, text: string }
function tokenize(text: string): Token[] {
  const out: Token[] = []
  let last = 0
  URL_RE.lastIndex = 0
  let m = URL_RE.exec(text)
  while (m !== null) {
    const url = m[0].replace(TRAILING_PUNCT, '')
    if (m.index > last)
      out.push({ link: false, text: text.slice(last, m.index) })
    if (url)
      out.push({ link: true, text: url })
    last = m.index + url.length
    m = URL_RE.exec(text)
  }
  if (last < text.length)
    out.push({ link: false, text: text.slice(last) })
  return out
}

/** 每行预处理成 cell 列表：链接 cell 单独成块（不做过滤高亮，避免把 URL 切碎），文本 cell 再按关键词切片高亮 */
interface LineCell { link: boolean, segs: TextSeg[] }
const lineCells = computed<LineCell[][]>(() => filtered.value.map((l) => {
  const cells: LineCell[] = []
  for (const tk of tokenize(l.text)) {
    if (tk.link)
      cells.push({ link: true, segs: [{ text: tk.text, hit: false }] })
    else if (tk.text)
      cells.push({ link: false, segs: splitByQuery(tk.text) })
  }
  return cells
}))

/**
 * 终端日志分级着色：按行内容智能降噪，而不是 stderr 一律标红。
 * - error：真正的致命错误（npm ERR! / yarn error / pnpm ERR_PNPM_ / 异常堆栈等）→ 红
 * - warn：npm warn / warning / deprecated 等非致命告警 → 暗黄（降级，不再刺眼）
 * - success：changed / added / done / ✓ 等成功标记 → 绿
 * - normal：默认（stderr 但非 error 也归 normal，避免 npm 把 warn 吐到 stderr 时误标红）
 */
type LineLevel = 'error' | 'warn' | 'success' | 'normal'
// 只做明确匹配，避免复杂断言触发 lint 的矛盾正则规则。
// 上一版的 `E[A-Z]\w+:/i` 在 /i 下等于「任意一个 e 开头的字母单词 + 冒号」，
// 把对象 dump 里所有 key: value 形式（envConfig:、VITE_DESC: 等）全部误判成错误，
// 几乎把整屏染红。这里改成具体 errno 码 + 行首的 Error，避免误报。
const ERROR_RE = /npm ERR!|npm error|ERR_PNPM_|yarn error|\bTypeError\b|\bReferenceError\b|\bSyntaxError\b|^\s*Error\b|command failed with exit code|exited with code [1-9]|EACCES:|ENOENT:|ENOTDIR:|EEXIST:|EPERM:|ETIMEDOUT:|ECONNREFUSED:|ENOMEM:|EAI_AGAIN:/i
const WARN_RE = /npm warn\b|\bwarn(?:ing)?\b|deprecat/i
const SUCCESS_RE = /(?:changed|added|updated|removed) \d+ package|installed \d+ package|successfully|compiled successfully|built in|passed|[✓✔✅]/i

function levelOf(l: LogEntry): LineLevel {
  const text = l.text
  if (ERROR_RE.test(text))
    return 'error'
  if (SUCCESS_RE.test(text))
    return 'success'
  if (WARN_RE.test(text))
    return 'warn'
  // stderr 但没命中任何明确级别 → 不再一律标红，降级为 normal（关键去噪点）
  return 'normal'
}
const lineLevels = computed(() => filtered.value.map(l => levelOf(l)))

/** 距底部阈值：小于它就算「贴着底部」，自动滚动才生效 */
const BOTTOM_EPSILON = 24
const atBottom = ref(true)
function onScroll(): void {
  const el = scroller.value
  if (!el)
    return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_EPSILON
}
function scrollToBottom(el: HTMLElement | null): void {
  if (!el)
    return
  el.scrollTop = el.scrollHeight
  atBottom.value = true
}

// 跟随新日志：只有「开关打开」且「当前已贴底」时才拽到底部。
// 这样用户手动往上翻看历史时不会被新输出一直打断，回到底部后又自动恢复跟随。
watch(
  () => props.logs.length,
  async () => {
    if (!autoScroll.value || !atBottom.value)
      return
    await nextTick()
    scrollToBottom(scroller.value)
  },
)

async function openLink(url: string): Promise<void> {
  const ok = await api.openUrl(url)
  if (!ok)
    message.warning('该链接不是 http(s) 地址，已拒绝打开')
}

async function exportLog(): Promise<void> {
  if (!props.runId)
    return
  const path = await api.exportLog(props.runId)
  if (path)
    message.success(`日志已导出：${path}`)
  else
    message.warning('导出已取消')
}

/** 写入剪贴板：优先用异步 Clipboard API，失败回落到 execCommand（老的 file:// 场景） */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  }
  catch {
    // 继续走兜底
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
  catch {
    return false
  }
}

async function copyLog(): Promise<void> {
  if (!filtered.value.length) {
    message.warning('没有可复制的日志')
    return
  }
  const text = filtered.value.map(l => l.text).join('\n')
  const ok = await writeClipboard(text)
  if (ok)
    message.success(`已复制 ${filtered.value.length} 行`)
  else
    message.error('复制失败，请手动选择文本')
}

function doClear(): void {
  if (!props.runId)
    return
  projects.clearLogs(props.runId)
  message.success('日志已清空')
}

function clearLog(): void {
  if (!props.runId || !props.logs.length)
    return
  // 运行中清空容易误以为「把任务也清了」，所以先确认；已结束的任务直接清
  if (props.running) {
    dialog.warning({
      title: '清空日志',
      content: '该任务仍在运行，清空仅丢弃已显示的历史，新输出会继续出现。',
      positiveText: '清空',
      negativeText: '取消',
      onPositiveClick: doClear,
    })
  }
  else {
    doClear()
  }
}

/**
 * 工具栏分段控件的选项定义。
 * 视图模式与流筛选用同一套自写控件渲染，视觉上成对呼应。
 */
const MODE_OPTIONS = [
  { value: 'terminal' as const, label: '终端' },
  { value: 'structured' as const, label: '结构化' },
]

const STREAM_OPTIONS = [
  { value: 'all' as const, label: '全部' },
  { value: 'stdout' as const, label: '输出' },
  { value: 'stderr' as const, label: '错误' },
]

/** 动作按钮：合成一个带竖线分隔的圆角条，disabled 由当前日志状态驱动 */
const ACTIONS = computed(() => [
  {
    key: 'export',
    icon: 'i-carbon-document-export',
    title: '导出日志到文件',
    disabled: !props.runId,
    run: exportLog,
  },
  {
    key: 'copy',
    icon: 'i-carbon-copy',
    title: '复制当前筛选的日志（纯文本，不含时间戳）',
    disabled: filtered.value.length === 0,
    run: copyLog,
  },
  {
    key: 'clear',
    icon: 'i-carbon-trash-can',
    title: '清空当前日志（仅清屏，不影响正在运行的任务）',
    disabled: props.logs.length === 0,
    run: clearLog,
  },
])

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="flex flex-col gap-2 min-h-0" :class="fill ? 'flex-1 h-full' : ''">
    <!-- 工具栏：控件全部用 NaiveUI 原生组件（NRadioGroup / NSwitch / NInput / NButtonGroup），
         不再自写分段控件——自写的 accent 实底高亮在整条工具栏里过于抢眼。
         布局保持扁平：无外层卡片框、无冗余描边，只留一条 border-b 与下方日志区分界。 -->
    <div class="flex items-center gap-3 py-1.5 flex-wrap border-b border-line/30">
      <!-- 视图模式 -->
      <NRadioGroup v-model:value="mode" size="small">
        <NRadioButton v-for="m in MODE_OPTIONS" :key="m.value" :value="m.value">
          {{ m.label }}
        </NRadioButton>
      </NRadioGroup>

      <!-- 开关组：扁平，无容器 -->
      <div class="flex items-center gap-3">
        <label class="text-xs text-fg-dim flex items-center gap-1.5 cursor-pointer select-none">
          <NSwitch v-model:value="autoScroll" size="small" />
          自动滚动
        </label>
        <label class="text-xs text-fg-dim flex items-center gap-1.5 cursor-pointer select-none">
          <NSwitch v-model:value="showTs" size="small" />
          时间戳
        </label>
      </div>

      <div class="flex-1" />

      <!-- 搜索 -->
      <NInput
        v-model:value="filterText"
        size="small"
        clearable
        placeholder="过滤日志…"
        class="w-[200px]"
      >
        <template #prefix>
          <i class="i-carbon-search" />
        </template>
      </NInput>

      <!-- 流筛选 -->
      <NRadioGroup v-model:value="streamFilter" size="small">
        <NRadioButton v-for="s in STREAM_OPTIONS" :key="s.value" :value="s.value">
          {{ s.label }}
        </NRadioButton>
      </NRadioGroup>

      <!-- 计数：扁平，仅靠文字色弱化 -->
      <span class="text-xs text-fg-dim tabular-nums whitespace-nowrap">
        {{ filtered.length }}/{{ logs.length }}
      </span>

      <!-- 动作组 -->
      <NButtonGroup size="small">
        <NButton
          v-for="a in ACTIONS"
          :key="a.key"
          quaternary
          :disabled="a.disabled"
          :title="a.title"
          @click="a.run()"
        >
          <template #icon>
            <i :class="a.icon" />
          </template>
        </NButton>
      </NButtonGroup>
    </div>

    <div v-if="mode === 'terminal'" ref="termScroller" class="font-mono text-xs leading-normal bg-[#0d0f12] text-[#d4d4d4] rounded-lg p-2.5 overflow-auto whitespace-pre-wrap break-all" :class="fill ? 'flex-1 min-h-[200px]' : 'h-[320px]'" @scroll="onScroll">
      <div
        v-for="(l, i) in filtered"
        :key="i"
        class="min-h-[1.4em]"
        :class="{
          'text-[#ff7b72]': lineLevels[i] === 'error',
          'text-[#d4a72c]': lineLevels[i] === 'warn',
          'text-[#7ee787]': lineLevels[i] === 'success',
        }"
      >
        <span v-if="showTs" class="text-[#6b7280] mr-1.5">{{ fmtTs(l.ts) }}</span>
        <template v-for="(cell, ci) in lineCells[i]" :key="ci">
          <a
            v-if="cell.link"
            class="text-[#58a6ff] underline decoration-dotted underline-offset-2 hover:text-[#79c0ff] cursor-pointer"
            :title="`在浏览器中打开 ${cell.segs[0].text}`"
            @click="openLink(cell.segs[0].text)"
          >{{ cell.segs[0].text }}</a>
          <template v-else>
            <template v-for="(seg, si) in cell.segs" :key="si">
              <mark v-if="seg.hit" class="bg-[rgba(52,199,89,0.4)] text-white rounded-[3px] px-[1px]">{{ seg.text }}</mark>
              <template v-else>
                {{ seg.text }}
              </template>
            </template>
          </template>
        </template>
      </div>
      <div v-if="!logs.length" class="text-[#6b7280]">
        暂无输出
      </div>
      <div v-else-if="!filtered.length" class="text-[#6b7280]">
        无匹配的日志
      </div>
    </div>

    <div v-else ref="structScroller" class="overflow-auto bg-bg-elevated border border-line rounded-lg" :class="fill ? 'flex-1 min-h-[200px]' : 'h-[320px]'" @scroll="onScroll">
      <table class="font-mono text-xs w-full border-collapse">
        <thead class="sticky top-0 z-1 bg-bg-elevated">
          <tr class="text-fg-dim font-normal text-[11px]">
            <th v-if="showTs" class="text-left font-normal px-2 py-1.5 w-1 whitespace-nowrap border-b border-line">
              时间
            </th>
            <th class="text-left font-normal px-2 py-1.5 w-[56px] border-b border-line">
              流
            </th>
            <th class="text-left font-normal px-2 py-1.5 border-b border-line">
              内容
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in filtered" :key="i" class="align-top hover:bg-[rgba(127,127,127,0.08)]">
            <td v-if="showTs" class="text-fg-dim whitespace-nowrap px-2 py-0.5 border-b border-line/60">
              {{ fmtTs(l.ts) }}
            </td>
            <td class="px-2 py-0.5 whitespace-nowrap border-b border-line/60" :class="l.stream === 'stderr' ? 'text-[#ff7b72]' : 'text-fg-dim'">
              {{ l.stream }}
            </td>
            <td
              class="px-2 py-0.5 break-all border-b border-line/60"
              :class="{
                'text-[#ff7b72]': lineLevels[i] === 'error',
                'text-[#d4a72c]': lineLevels[i] === 'warn',
                'text-[#34c759]': lineLevels[i] === 'success',
              }"
            >
              <template v-for="(cell, ci) in lineCells[i]" :key="ci">
                <a
                  v-if="cell.link"
                  class="text-[#58a6ff] underline decoration-dotted underline-offset-2 hover:text-[#79c0ff] cursor-pointer"
                  :title="`在浏览器中打开 ${cell.segs[0].text}`"
                  @click="openLink(cell.segs[0].text)"
                >{{ cell.segs[0].text }}</a>
                <template v-else>
                  <template v-for="(seg, si) in cell.segs" :key="si">
                    <mark v-if="seg.hit" class="bg-[rgba(52,199,89,0.4)] text-white rounded-[3px] px-[1px]">{{ seg.text }}</mark>
                    <template v-else>
                      {{ seg.text }}
                    </template>
                  </template>
                </template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!logs.length" class="text-fg-dim p-2">
        暂无日志
      </div>
      <div v-else-if="!filtered.length" class="text-fg-dim p-2">
        无匹配的日志
      </div>
    </div>
  </div>
</template>
