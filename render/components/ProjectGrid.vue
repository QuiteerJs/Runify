<script setup lang="ts">
import type { Project } from '../../shared/types'
import ProjectCard from './ProjectCard.vue'

defineProps<{ projects: Project[] }>()
const emit = defineEmits<{
  open: [projectId: string, packageId: string | null]
  run: [project: Project]
  remove: [project: Project]
  info: [project: Project]
  contextMenu: [e: MouseEvent, project: Project, packageId: string | null]
}>()
</script>

<template>
  <!--
    响应式工程网格：UnoCSS 原生 CSS Grid 实现。
    - `auto-fill` + `minmax(280px, 1fr)`：窗口宽度自适应列数，最少 280px 一张卡。
    - `gap-5`：卡片之间均匀留白（横向/纵向均 20px）。
    - 直接用 div 作 grid item，避免 NaiveUI NGrid 的间距不渲染、columns 解析复杂。
  -->
  <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 w-full min-w-0 box-border">
    <ProjectCard
      v-for="p in projects"
      :key="p.id"
      :project="p"
      @open="(id, pk) => emit('open', id, pk)"
      @run="(pr) => emit('run', pr)"
      @remove="(pr) => emit('remove', pr)"
      @info="(pr) => emit('info', pr)"
      @context-menu="(e, pr, pk) => emit('contextMenu', e, pr, pk)"
    />
  </div>
</template>
