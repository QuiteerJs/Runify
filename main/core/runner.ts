import type { WebContents } from 'electron'
import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type {
  EnvVar,
  Project,
  RunifyEvent,
  RunInfo,
  RunRequest,
} from '../../shared/types'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { IPC } from '../../shared/types'
import { detectPort } from './port'

/** 环境管理等独立命令的合成工程 id：不与真实工程冲突，卡片/统计也不会扫到 */
export const ENV_PROJECT_ID = '__env__'

interface RunContext {
  info: RunInfo
  child: ChildProcess
  webContents: WebContents
  killed: boolean
}

const runs = new Map<string, RunContext>()

export function getRun(runId: string): RunContext | undefined {
  return runs.get(runId)
}

export function getAllRuns(): RunInfo[] {
  return [...runs.values()].map(r => r.info)
}

function emit(wc: WebContents, ev: RunifyEvent): void {
  if (!wc.isDestroyed())
    wc.send(IPC.event, ev)
}

function buildEnv(env: EnvVar[]): NodeJS.ProcessEnv {
  const record: NodeJS.ProcessEnv = { ...process.env }
  for (const e of env) {
    if (e.enabled && e.key)
      record[e.key] = e.value
  }
  return record
}

function detectPm(cwd: string): string {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml')))
    return 'pnpm'
  if (existsSync(path.join(cwd, 'yarn.lock')))
    return 'yarn'
  if (existsSync(path.join(cwd, 'bun.lockb')))
    return 'bun'
  return 'npm'
}

function makeRunId(): string {
  return `run_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/** 探测运行时实际使用的 node 版本（best-effort，失败返回 null） */
function detectNodeVersion(): string | null {
  try {
    return execFileSync('node', ['--version'], { encoding: 'utf-8' }).trim() || null
  }
  catch {
    return null
  }
}

/**
 * 进程事件接线（日志流 / 端口探测 / 退出处理），startRun 与 startAdhocRun 共用。
 */
function wireRun(
  child: ChildProcess,
  ctx: RunContext,
  info: RunInfo,
  webContents: WebContents,
  logLimit: number,
): void {
  const onChunk = (stream: 'stdout' | 'stderr') => (chunk: Buffer): void => {
    const text = chunk.toString()
    const ts = Date.now()
    info.logs.push({ ts, stream, text })
    // 滑动窗口：超出上限时淘汰最旧的日志
    if (info.logs.length > logLimit)
      info.logs.splice(0, info.logs.length - logLimit)

    if (!info.port) {
      const port = detectPort(text)
      if (port) {
        info.port = port
        emit(webContents, { kind: 'status', runId: info.runId, status: 'running', port })
      }
    }
    emit(webContents, { kind: 'log', runId: info.runId, stream, text, ts })
  }

  child.stdout?.on('data', onChunk('stdout'))
  child.stderr?.on('data', onChunk('stderr'))

  child.on('error', (err) => {
    const text = `spawn error: ${err.message}`
    info.logs.push({ ts: Date.now(), stream: 'stderr', text })
    emit(webContents, { kind: 'log', runId: info.runId, stream: 'stderr', text, ts: Date.now() })
  })

  child.on('exit', (code, signal) => {
    const endedAt = Date.now()
    info.exitCode = code
    info.exitSignal = signal ?? null
    info.endedAt = endedAt
    info.status = ctx.killed ? 'stopped' : (code === 0 ? 'stopped' : 'error')
    emit(webContents, {
      kind: 'exit',
      runId: info.runId,
      code,
      signal: signal ?? null,
      endedAt,
    })
    // 延迟清理，保证退出信息 / 日志在渲染端兜底可读
    setTimeout(() => runs.delete(info.runId), 60_000)
  })
}

/**
 * 启动一次脚本运行。
 * cwd 由 packageId 决定（子包目录或工程根目录），最终 env / shell 已由渲染端组装好。
 */
export function startRun(
  req: RunRequest,
  project: Project,
  webContents: WebContents,
  logLimit: number,
): RunInfo {
  const pkg = req.packageId
    ? project.packages.find(p => p.id === req.packageId)
    : undefined
  const cwd = pkg?.absolutePath || project.path

  // 优先使用导入时识别的包管理器（与卡片/详情页展示一致）；找不到再按 cwd 的 lock 文件兜底
  const pm = project.pm ?? detectPm(cwd)
  const command = `${pm} run ${req.script}${req.params ? ` ${req.params}` : ''}`
  const env = buildEnv(req.env)

  const child = spawn(req.shell || '/bin/zsh', ['-c', command], {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const runId = makeRunId()
  const info: RunInfo = {
    runId,
    projectId: req.projectId,
    packageId: req.packageId,
    script: req.script,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    port: null,
    exitCode: null,
    exitSignal: null,
    nodeVersion: detectNodeVersion(),
    logs: [],
  }

  const ctx: RunContext = { info, child, webContents, killed: false }
  runs.set(runId, ctx)
  wireRun(child, ctx, info, webContents, logLimit)

  return info
}

/**
 * 启动一条与环境管理相关的独立命令（安装版本管理工具 / 安装 node 版本 / 切默认版本等）。
 * 与工程运行共用同一 runs 表和事件流，渲染层用 runId 直接接入现有控制台。
 * 走用户登录 shell（-l -i -c），让 .zshrc 里的 nvm / fnm 初始化生效。
 */
export function startAdhocRun(
  command: string,
  webContents: WebContents,
  logLimit: number,
): RunInfo {
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh')
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', command]
    : ['-l', '-i', '-c', command]

  const child = spawn(shell, args, {
    cwd: os.homedir(),
    env: process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const runId = makeRunId()
  const info: RunInfo = {
    runId,
    projectId: ENV_PROJECT_ID,
    packageId: null,
    script: command,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    port: null,
    exitCode: null,
    exitSignal: null,
    nodeVersion: detectNodeVersion(),
    logs: [],
  }

  const ctx: RunContext = { info, child, webContents, killed: false }
  runs.set(runId, ctx)
  wireRun(child, ctx, info, webContents, logLimit)

  return info
}

/** 停止运行：向整个进程组发送 SIGTERM，保留退出信息 */
export function stopRun(runId: string): boolean {
  const ctx = runs.get(runId)
  if (!ctx || !ctx.child.pid)
    return false
  ctx.killed = true
  try {
    process.kill(-ctx.child.pid, 'SIGTERM')
  }
  catch {
    // 进程可能已退出
  }
  return true
}
