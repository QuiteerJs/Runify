import type { EnvManager, EnvManagerId, EnvRuntime, EnvSnapshot, NodeDistVersion } from '../../shared/types'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/**
 * 环境探测：找出本机的 Node 版本管理工具（Vite+/nvm/fnm/volta/n/mise/asdf）
 * 和 Node 生态运行时（node/npm/pnpm/yarn/bun/corepack）。
 *
 * 探测全部走用户的登录 shell（$SHELL -l -i -c），这样 .zshrc / .bashrc 里
 * 的 PATH 扩展（volta、fnm、nvm 初始化等）都能生效——Electron 主进程的
 * process.env 往往是精简 PATH，直接 spawn 会找不到用户装的工具。
 * nvm 是 shell 函数不是可执行文件，单独按安装目录探测。
 * 每项探测都是 best-effort：失败一律按「未安装」处理，不抛错。
 */

function userShell(): string {
  return process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh')
}

function probe(script: string, timeoutMs = 8000): Promise<string> {
  const shell = userShell()
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', script]
    : ['-l', '-i', '-c', script]
  return new Promise((resolve) => {
    execFile(shell, args, { timeout: timeoutMs, encoding: 'utf-8' }, (_err, stdout) => {
      // 探测脚本失败（command not found 等）很正常，stdout 有内容照样解析
      resolve(String(stdout ?? ''))
    })
  })
}

const VERSION_RE = /v?\d+\.\d+\.\d+/

function pickVersion(text: string): string | null {
  const m = text.match(VERSION_RE)
  return m ? m[0] : null
}

/** 探测一个可执行工具：是否在 PATH、路径、版本 */
async function probeBinary(cmd: string, versionArgs = '--version'): Promise<{ path: string | null, version: string | null }> {
  // head 取多行：部分工具（如 vp）版本号不在第一行（先输出 banner），
  // pickVersion 会在取回的文本里匹配第一个 semver
  const out = await probe(`command -v ${cmd} >/dev/null 2>&1 || exit 0; p="$(command -v ${cmd} 2>/dev/null)"; [ -n "$p" ] && printf 'PATH:%s\\n' "$p" && ${cmd} ${versionArgs} 2>/dev/null | head -n 8`)
  const pathMatch = out.match(/^PATH:(.+)$/m)
  // command -v 可能返回 shell 别名/函数名（如 "vp"）而非真实路径，过滤掉
  const rawPath = pathMatch?.[1].trim() ?? null
  const realPath = rawPath && rawPath.includes('/') ? rawPath : null
  return {
    path: realPath,
    version: pathMatch ? pickVersion(out.replace(/^PATH:.*$/m, '')) : null,
  }
}

async function detectRuntime(key: EnvRuntime['key']): Promise<EnvRuntime> {
  const { path: p, version } = await probeBinary(key)
  return { key, version, path: p }
}

/** 从「nvm ls / fnm list」这类输出里抓已装版本列表与默认版本标记 */
function parseVersionList(text: string): { versions: string[], defaultVersion: string | null } {
  const versions: string[] = []
  let defaultVersion: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const m = line.match(/\bv?\d+\.\d+\.\d+\b/)
    if (!m)
      continue
    const v = m[0]
    if (!versions.includes(v))
      versions.push(v)
    // 默认标记：fnm 的行尾 default、volta 的 (default)、nvm 的 default -> 行
    if (/\bdefault\b/.test(line) && !defaultVersion)
      defaultVersion = v
  }
  return { versions, defaultVersion }
}

async function detectManager(id: EnvManagerId, name: string): Promise<EnvManager> {
  const base: EnvManager = {
    id,
    name,
    installed: false,
    version: null,
    path: null,
    nodeVersions: [],
    defaultVersion: null,
  }

  // nvm 是 shell 函数：按安装目录探测，再 source 后取版本与列表
  if (id === 'nvm') {
    const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm')
    const script = path.join(nvmDir, 'nvm.sh')
    if (!existsSync(script))
      return base
    const versionOut = await probe(`. "${script}" >/dev/null 2>&1 && nvm --version`)
    const listOut = await probe(`. "${script}" >/dev/null 2>&1 && nvm ls --no-colors`)
    const version = pickVersion(versionOut)
    const { versions, defaultVersion } = parseVersionList(listOut)
    return {
      ...base,
      installed: !!version,
      version,
      path: script,
      nodeVersions: versions,
      defaultVersion,
    }
  }

  // Vite+（vp）：vp env 自带 Node 版本管理，list/default 均有专用子命令
  if (id === 'vitep') {
    const { path: p, version } = await probeBinary('vp')
    // vp 常以 shell 别名/函数安装，command -v 拿不到真实路径，版本探到即算已安装
    if (!p && !version)
      return base
    const listOut = await probe('vp env list 2>/dev/null')
    const { versions } = parseVersionList(listOut)
    const defaultOut = await probe('vp env default 2>/dev/null')
    return {
      ...base,
      installed: true,
      version,
      path: p,
      nodeVersions: versions,
      defaultVersion: pickVersion(defaultOut),
    }
  }

  const meta: Record<Exclude<EnvManagerId, 'nvm' | 'vitep'>, { name: string, listCmd: string }> = {
    fnm: { name, listCmd: 'fnm list' },
    volta: { name, listCmd: 'volta list node' },
    n: { name, listCmd: 'n ls' },
    mise: { name, listCmd: 'mise ls node 2>/dev/null' },
    asdf: { name, listCmd: 'asdf list nodejs 2>/dev/null' },
  }
  const { path: p, version } = await probeBinary(id)
  if (!p)
    return base
  const listOut = await probe(meta[id].listCmd)
  const { versions, defaultVersion } = parseVersionList(listOut)
  return {
    ...base,
    installed: true,
    version,
    path: p,
    nodeVersions: versions,
    // 工具管理的 node 不在时，把 PATH 里的 node 版本当作激活版本兜底
    defaultVersion: defaultVersion ?? null,
  }
}

export async function detectEnv(): Promise<EnvSnapshot> {
  const runtimeKeys: EnvRuntime['key'][] = ['node', 'npm', 'pnpm', 'yarn', 'bun', 'corepack']
  const [runtimes, managers] = await Promise.all([
    Promise.all(runtimeKeys.map(detectRuntime)),
    Promise.all([
      detectManager('vitep', 'Vite+'),
      detectManager('nvm', 'nvm'),
      detectManager('fnm', 'fnm'),
      detectManager('volta', 'Volta'),
      detectManager('n', 'n'),
      detectManager('mise', 'mise'),
      detectManager('asdf', 'asdf'),
    ]),
  ])
  return {
    shell: userShell(),
    platform: process.platform,
    runtimes,
    managers,
  }
}

/** 官方 dist index 里的一条版本信息（结构见 shared/types.ts 的 NodeDistVersion） */

let distCache: { at: number, data: NodeDistVersion[] } | null = null
const DIST_TTL = 60 * 60 * 1000

/**
 * 拉取官方源可安装的 Node 版本列表（nodejs.org/dist/index.json，按新到旧排序）。
 * 供「安装指定版本」下拉使用；网络失败返回空数组，渲染端回退为已装版本 + 手动输入。
 */
export async function fetchNodeDistVersions(): Promise<NodeDistVersion[]> {
  if (distCache && Date.now() - distCache.at < DIST_TTL)
    return distCache.data
  try {
    const res = await fetch('https://nodejs.org/dist/index.json', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`)
    const raw = (await res.json()) as { version: string, lts: string | false }[]
    // 全量返回（约 600+ 条，新到旧）；渲染端做懒加载 + 模糊搜索，不在主进程截断
    const data = raw.map(x => ({
      version: x.version.replace(/^v/, ''),
      lts: x.lts ?? false,
    }))
    distCache = { at: Date.now(), data }
    return data
  }
  catch {
    // 离线 / 超时：不缓存失败结果，下次再试
    return []
  }
}
