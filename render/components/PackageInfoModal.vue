<script setup lang="ts">
import type { Project, ProjectPackage } from '../../shared/types'
import { NButton, NModal, NTag } from 'naive-ui'
import { computed } from 'vue'
import { api } from '../ipc'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: [] }>()

interface Row extends ProjectPackage {
  isRoot: boolean
}

/** 标题：文件名 + 备注 */
const folderName = computed(() => {
  const parts = props.project.path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || props.project.path
})
const modalTitle = computed(() => {
  const note = props.project.note?.trim()
  return note ? `${folderName.value} · ${note}` : folderName.value
})

/** 依赖包列表：包名@版本 */
function depsOf(deps?: Record<string, string>): string[] {
  return deps ? Object.entries(deps).map(([name, ver]) => `${name}@${ver}`) : []
}

/** 根包 + 各子包，按行展示 */
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  if (props.project.scripts.length || !props.project.packages.length) {
    out.push({
      id: '',
      name: props.project.name,
      relativePath: '.',
      absolutePath: props.project.path,
      scripts: props.project.scripts,
      type: props.project.type,
      isRoot: true,
      dependencies: props.project.dependencies,
      devDependencies: props.project.devDependencies,
      peerDependencies: props.project.peerDependencies,
    })
  }
  for (const pkg of props.project.packages)
    out.push({ ...pkg, isRoot: false })
  return out
})

function openFolder(p: Row) {
  api.openFolder(p.absolutePath)
}
</script>

<template>
  <NModal
    :show="true"
    :title="modalTitle"
    preset="card"
    style="width: 760px; max-width: 94vw"
    @update:show="v => !v && emit('close')"
  >
    <div class="pim flex flex-col gap-3">
      <div class="border border-line rounded-lg p-2.5 px-3 bg-bg-elevated">
        <div class="text-xs text-fg-dim break-all font-mono" :title="project.path">
          {{ project.path }}
        </div>
        <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
          <NTag v-for="t in project.type" :key="t" size="small" :bordered="false">
            {{ t }}
          </NTag>
          <span v-if="project.pm" class="text-xs text-fg-dim"><i class="i-carbon-package" /> {{ project.pm }}</span>
          <span v-if="project.branch" class="text-xs text-fg-dim"><i class="i-carbon-branch" /> {{ project.branch }}</span>
          <span class="text-xs text-fg-dim">子包 {{ project.packages.length }}</span>
        </div>
      </div>

      <div class="flex flex-wrap gap-3.5 text-[11px] text-fg-dim p-2 px-2.5 border border-line rounded-lg bg-bg-elevated">
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block flex-none bg-[#2080f0]" /><b>依赖（运行时）</b> = dependencies</span>
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block flex-none bg-[#f0a020]" /><b>devDependencies</b> = 开发依赖</span>
        <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block flex-none bg-[#909399]" /><b>peer / 可选</b> = peerDependencies + optional</span>
      </div>

      <div class="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
        <div v-if="!rows.length" class="p-5 text-center text-fg-dim">
          未检测到包信息
        </div>
        <div v-for="p in rows" :key="p.isRoot ? 'root' : p.id" class="border border-line rounded-lg p-2.5 px-3">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span v-if="p.isRoot" class="flex-none text-[10px] bg-accent text-white rounded px-1.5 py-px">根</span>
              <span class="text-[14px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{{ p.name }}</span>
              <NTag v-if="p.version" size="small" :bordered="false" type="info">
                v{{ p.version }}
              </NTag>
            </div>
            <div class="flex-none flex items-center gap-2">
              <span class="text-xs text-fg-dim">脚本 {{ p.scripts.length }} · 依赖 {{ depsOf(p.dependencies).length }} · dev {{ depsOf(p.devDependencies).length }}<template v-if="depsOf(p.peerDependencies).length"> · peer {{ depsOf(p.peerDependencies).length }}</template></span>
              <NButton size="tiny" tertiary @click="openFolder(p)">
                打开目录
              </NButton>
            </div>
          </div>

          <div class="text-xs text-fg-dim mt-1.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono" :title="p.absolutePath">
            <i class="i-carbon-folder" /> {{ p.isRoot ? '根目录' : p.relativePath }}
          </div>

          <div v-if="p.author" class="text-xs text-fg mt-1">
            <i class="i-carbon-user" /> {{ p.author }}
          </div>
          <div v-if="p.description" class="text-xs text-fg-dim mt-1 line-clamp-2 break-words">
            {{ p.description }}
          </div>

          <div v-if="p.type.length" class="flex flex-wrap items-center gap-1.5 mt-1.5">
            <NTag v-for="t in p.type" :key="t" size="small" :bordered="false">
              {{ t }}
            </NTag>
          </div>

          <!-- 依赖包：运行时 / 开发 两类用颜色区分展示（包名@版本） -->
          <div v-if="depsOf(p.dependencies).length || depsOf(p.devDependencies).length || depsOf(p.peerDependencies).length" class="mt-2">
            <div class="flex flex-wrap gap-3.5 text-[11px] text-fg-dim mb-1">
              <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block flex-none bg-[#2080f0]" />依赖（运行时）{{ depsOf(p.dependencies).length }}</span>
              <span class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block flex-none bg-[#f0a020]" />dev{{ depsOf(p.devDependencies).length }}</span>
              <span v-if="depsOf(p.peerDependencies).length" class="inline-flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-[3px] inline-block flex-none bg-[#909399]" />peer/可选{{ depsOf(p.peerDependencies).length }}</span>
            </div>
            <div v-if="depsOf(p.dependencies).length" class="pim__deps-group flex flex-col gap-1.5">
              <div class="flex flex-wrap gap-1">
                <NTag
                  v-for="d in depsOf(p.dependencies)"
                  :key="`r-${d}`"
                  size="small"
                  type="info"
                  :bordered="false"
                  class="pim__dep max-w-[220px]"
                >
                  {{ d }}
                </NTag>
              </div>
            </div>
            <div v-if="depsOf(p.devDependencies).length" class="pim__deps-group flex flex-col gap-1.5">
              <div class="flex flex-wrap gap-1">
                <NTag
                  v-for="d in depsOf(p.devDependencies)"
                  :key="`d-${d}`"
                  size="small"
                  type="warning"
                  :bordered="false"
                  class="pim__dep max-w-[220px]"
                >
                  {{ d }}
                </NTag>
              </div>
            </div>
            <div v-if="depsOf(p.peerDependencies).length" class="pim__deps-group flex flex-col gap-1.5">
              <div class="flex flex-wrap gap-1">
                <NTag
                  v-for="d in depsOf(p.peerDependencies)"
                  :key="`p-${d}`"
                  size="small"
                  type="default"
                  :bordered="false"
                  class="pim__dep max-w-[220px]"
                >
                  {{ d }}
                </NTag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
/* 弹窗内细滚动条：scoped 下伪元素需 :deep 穿透，无法用 UnoCSS 工具类表达，保留 */
.pim {
  scrollbar-width: thin;
  scrollbar-color: var(--text-dim) transparent;
}
.pim :deep(::-webkit-scrollbar) {
  width: 2px;
  height: 2px;
}
.pim :deep(::-webkit-scrollbar-track) {
  background: transparent;
}
.pim :deep(::-webkit-scrollbar-thumb) {
  background: var(--text-dim);
  border-radius: 999px;
}
.pim :deep(::-webkit-scrollbar-thumb:hover) {
  background: var(--accent);
}
.pim :deep(::-webkit-scrollbar-corner) {
  background: transparent;
}
/* 依赖分组之间的间距：相邻兄弟选择器无法用 shortcut 表达 */
.pim__deps-group + .pim__deps-group {
  margin-top: 6px;
}
/* naive-ui Tag 内容省略 */
.pim__dep :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
