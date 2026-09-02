<script setup lang="ts">
import type { LogEntry } from '../../shared/types'
import { NButton, NInput, NRadioButton, NRadioGroup, NSwitch } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { message } from '../feedback'
import { api } from '../ipc'

const props = withDefaults(defineProps<{ runId: string | null, logs: LogEntry[], running: boolean, /** true = 根元素与日志区吃满父容器高度（命令详情页用）；默认固定 320px（详情页脚本树布局用） */ fill?: boolean }>(), { fill: false })

const mode = ref<'terminal' | 'structured'>('terminal')
const autoScroll = ref(true)
const scroller = ref<HTMLElement | null>(null)

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
const lineSegments = computed(() => filtered.value.map(l => splitByQuery(l.text)))

/**
 * 终端日志分级着色：按行内容智能降噪，而不是 stderr 一律标红。
 * - error：真正的致命错误（npm ERR! / yarn error / pnpm ERR_PNPM_ / 异常堆栈等）→ 红
 * - warn：npm warn / warning / deprecated 等非致命告警 → 暗黄（降级，不再刺眼）
 * - success：changed / added / done / ✓ 等成功标记 → 绿
 * - normal：默认（stderr 但非 error 也归 normal，避免 npm 把 warn 吐到 stderr 时误标红）
 */
type LineLevel = 'error' | 'warn' | 'success' | 'normal'
// 只做明确匹配，避免复杂断言触发 lint 的矛盾正则规则
const ERROR_RE = /npm ERR!|npm error|ERR_PNPM_|yarn error|TypeError|ReferenceError|SyntaxError|command failed with exit code|exited with code [1-9]|E[A-Z]\w+:/i
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

watch(
  () => props.logs.length,
  async () => {
    if (autoScroll.value && scroller.value) {
      await nextTick()
      scroller.value.scrollTop = scroller.value.scrollHeight
    }
  },
)

async function exportLog() {
  if (!props.runId)
    return
  const path = await api.exportLog(props.runId)
  if (path)
    message.success(`日志已导出：${path}`)
  else
    message.warning('导出已取消')
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="flex flex-col gap-2 min-h-0" :class="fill ? 'flex-1 h-full' : ''">
    <div class="flex justify-between items-center gap-2.5 flex-wrap">
      <div class="flex items-center gap-3">
        <NRadioGroup v-model:value="mode" size="small">
          <NRadioButton value="terminal">
            终端模式
          </NRadioButton>
          <NRadioButton value="structured">
            结构化
          </NRadioButton>
        </NRadioGroup>
        <label class="text-xs text-fg-dim flex items-center gap-1.5">
          自动滚动
          <NSwitch v-model:value="autoScroll" size="small" />
        </label>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <NInput
          v-model:value="filterText"
          size="small"
          clearable
          placeholder="过滤日志…"
          class="w-[160px]"
        >
          <template #prefix>
            <i class="i-carbon-search" />
          </template>
        </NInput>
        <NRadioGroup v-model:value="streamFilter" size="small">
          <NRadioButton value="all">
            全部
          </NRadioButton>
          <NRadioButton value="stdout">
            输出
          </NRadioButton>
          <NRadioButton value="stderr">
            错误
          </NRadioButton>
        </NRadioGroup>
        <span class="text-[11px] text-fg-dim whitespace-nowrap">{{ filtered.length }}/{{ logs.length }}</span>
        <NButton size="small" :disabled="!runId" @click="exportLog">
          导出日志
        </NButton>
      </div>
    </div>

    <div v-if="mode === 'terminal'" ref="scroller" class="font-mono text-xs leading-normal bg-[#0d0f12] text-[#d4d4d4] rounded-lg p-2.5 overflow-auto whitespace-pre-wrap break-all" :class="fill ? 'flex-1 min-h-[200px]' : 'h-[320px]'">
      <div
        v-for="(l, i) in filtered"
        :key="i"
        :class="{
          'text-[#ff7b72]': lineLevels[i] === 'error',
          'text-[#d4a72c]': lineLevels[i] === 'warn',
          'text-[#7ee787]': lineLevels[i] === 'success',
        }"
      >
        <span class="text-[#6b7280] mr-1.5">{{ fmtTs(l.ts) }}</span>
        <template v-for="(seg, si) in lineSegments[i]" :key="si">
          <mark v-if="seg.hit" class="bg-[rgba(52,199,89,0.4)] text-white rounded-[3px] px-[1px]">{{ seg.text }}</mark>
          <template v-else>
            {{ seg.text }}
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

    <div v-else class="overflow-auto bg-bg-elevated border border-line rounded-lg" :class="fill ? 'flex-1 min-h-[200px]' : 'h-[320px]'">
      <table class="font-mono text-xs w-full border-collapse">
        <tr v-for="(l, i) in filtered" :key="i">
          <td class="text-fg-dim whitespace-nowrap w-1">
            {{ fmtTs(l.ts) }}
          </td>
          <td :class="l.stream === 'stderr' ? 'text-danger' : ''">
            {{ l.stream }}
          </td>
          <td>
            <template v-for="(seg, si) in lineSegments[i]" :key="si">
              <mark v-if="seg.hit" class="bg-[rgba(52,199,89,0.4)] text-white rounded-[3px] px-[1px]">{{ seg.text }}</mark>
              <template v-else>
                {{ seg.text }}
              </template>
            </template>
          </td>
        </tr>
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
