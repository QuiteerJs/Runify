import type {
  LogEntry,
  Project,
  ProjectStatus,
  RunifyEvent,
  RunInfo,
  RunRequest,
} from '../../shared/types'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../ipc'
import { useSettings } from './settings'

export const useProjects = defineStore('projects', () => {
  const settings = useSettings()

  const projects = ref<Project[]>([])
  const runs = ref<Record<string, RunInfo>>({})
  const logs = ref<Record<string, LogEntry[]>>({})

  function targetKey(projectId: string, packageId: string | null): string {
    return packageId ? `${projectId}::${packageId}` : projectId
  }

  function sortProjects(): void {
    projects.value = [...projects.value].sort((a, b) => b.importTime - a.importTime)
  }

  async function load(): Promise<void> {
    projects.value = await api.getProjects()
    sortProjects()
  }

  function latestRunId(projectId: string, packageId: string | null): string | null {
    const key = targetKey(projectId, packageId)
    let best: RunInfo | null = null
    for (const r of Object.values(runs.value)) {
      if (targetKey(r.projectId, r.packageId) === key) {
        if (!best || r.startedAt > best.startedAt)
          best = r
      }
    }
    return best ? best.runId : null
  }

  /**
   * 该项目（或子包）的全部运行记录，按开始时间倒序（最新在前）。
   * 一个项目可以并发跑多条命令，因此这里返回数组而不是单条。
   */
  function runsOf(projectId: string, packageId: string | null): RunInfo[] {
    const key = targetKey(projectId, packageId)
    return Object.values(runs.value)
      .filter(r => targetKey(r.projectId, r.packageId) === key)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  /**
   * 聚合状态：只看「最新一条」会把并发任务吞掉（先跑 dev 再跑 build，
   * build 结束后卡片会错误地显示 idle/stopped，而 dev 其实还在跑）。
   * 优先级：running > error > 最新一条的状态 > idle
   */
  function aggregateStatus(projectId: string, packageId: string | null): ProjectStatus {
    const list = runsOf(projectId, packageId)
    if (list.length === 0)
      return 'idle'
    if (list.some(r => r.status === 'running'))
      return 'running'
    if (list.some(r => r.status === 'error'))
      return 'error'
    return list[0].status
  }

  function statusOf(projectId: string, packageId: string | null): ProjectStatus {
    const id = latestRunId(projectId, packageId)
    if (!id)
      return 'idle'
    return runs.value[id]?.status ?? 'idle'
  }

  /**
   * 指定脚本的全部运行记录（按开始时间倒序）。
   * 同一脚本可并发多实例（比如同时开两个 dev），按脚本名过滤而不是只按包。
   */
  function runsOfScript(projectId: string, packageId: string | null, scriptName: string): RunInfo[] {
    return runsOf(projectId, packageId).filter(r => r.script === scriptName)
  }

  /** 指定脚本当前运行中实例的 runId（多实例时取最新启动的一条） */
  function activeRunIdOfScript(projectId: string, packageId: string | null, scriptName: string): string | null {
    const hit = runsOfScript(projectId, packageId, scriptName).find(r => r.status === 'running')
    return hit ? hit.runId : null
  }

  function activeRunId(projectId: string, packageId: string | null): string | null {
    const id = latestRunId(projectId, packageId)
    if (id && runs.value[id]?.status === 'running')
      return id
    return null
  }

  function registerRun(info: RunInfo): void {
    runs.value[info.runId] = info
    logs.value[info.runId] = [...info.logs]
  }

  function handleEvent(ev: RunifyEvent): void {
    if (ev.kind === 'log') {
      if (!logs.value[ev.runId])
        logs.value[ev.runId] = []
      logs.value[ev.runId].push({ ts: ev.ts, stream: ev.stream, text: ev.text })
      const limit = settings.settings.logLimit
      if (logs.value[ev.runId].length > limit)
        logs.value[ev.runId].splice(0, logs.value[ev.runId].length - limit)
      if (runs.value[ev.runId])
        runs.value[ev.runId].logs.push({ ts: ev.ts, stream: ev.stream, text: ev.text })
    }
    else if (ev.kind === 'status') {
      if (runs.value[ev.runId]) {
        runs.value[ev.runId].port = ev.port
        runs.value[ev.runId].status = ev.status
      }
    }
    else if (ev.kind === 'exit') {
      if (runs.value[ev.runId]) {
        runs.value[ev.runId].status = ev.code === 0 ? 'stopped' : 'error'
        runs.value[ev.runId].exitCode = ev.code
        runs.value[ev.runId].exitSignal = ev.signal
        runs.value[ev.runId].endedAt = ev.endedAt
      }
    }
  }

  async function run(req: RunRequest): Promise<RunInfo> {
    const info = await api.run(req)
    registerRun(info)
    return info
  }

  async function stop(runId: string): Promise<boolean> {
    return api.stop(runId)
  }

  async function importProject(path: string): Promise<Project> {
    const p = await api.importProject(path)
    projects.value.push(p)
    sortProjects()
    return p
  }

  async function removeProject(projectId: string): Promise<void> {
    await api.removeProject(projectId)
    projects.value = projects.value.filter(p => p.id !== projectId)
  }

  async function refreshProject(projectId: string): Promise<Project | null> {
    const p = await api.refreshProject(projectId)
    if (p) {
      const idx = projects.value.findIndex(x => x.id === projectId)
      if (idx >= 0)
        projects.value[idx] = p
    }
    return p
  }

  async function updateProject(projectId: string, patch: Partial<Project>): Promise<void> {
    // reactive proxy 无法通过 IPC 结构化克隆（会报 An object could not be cloned），
    // 这里先序列化成纯对象再传
    const plain = JSON.parse(JSON.stringify(patch)) as Partial<Project>
    await api.updateProject(projectId, plain)
    const idx = projects.value.findIndex(x => x.id === projectId)
    if (idx >= 0)
      projects.value[idx] = { ...projects.value[idx], ...plain }
  }

  return {
    projects,
    runs,
    logs,
    load,
    sortProjects,
    targetKey,
    statusOf,
    aggregateStatus,
    runsOf,
    runsOfScript,
    activeRunId,
    activeRunIdOfScript,
    latestRunId,
    handleEvent,
    registerRun,
    run,
    stop,
    importProject,
    removeProject,
    refreshProject,
    updateProject,
  }
})
