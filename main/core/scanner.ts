import type {
  PackageManager,
  PkgScript,
  Project,
  ProjectPackage,
  ProjectType,
} from '../../shared/types'
import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  }
  catch {
    return false
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw) as T
  }
  catch {
    return null
  }
}

/** 按 package.json 原始顺序平铺脚本 */
async function readScripts(pkgPath: string): Promise<PkgScript[]> {
  const pkg = await readJson<{ scripts?: Record<string, string> }>(pkgPath)
  if (!pkg || !pkg.scripts)
    return []
  return Object.entries(pkg.scripts).map(([name, command]) => ({ name, command }))
}

interface RawPkg {
  name?: string
  version?: string
  author?: string | { name?: string }
  description?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
  packageManager?: string
}

/** package.json 的 author 可能是字符串也可能是对象，统一提取为字符串 */
function normalizeAuthor(author: unknown): string | undefined {
  if (!author)
    return undefined
  if (typeof author === 'string')
    return author.trim() || undefined
  if (typeof author === 'object') {
    const name = (author as { name?: unknown }).name
    if (typeof name === 'string' && name.trim())
      return name.trim()
  }
  return undefined
}

/** 把依赖拆分为运行时 / 开发 / peer 三类，分别按包名排序，便于弹窗用颜色区分展示 */
function splitDeps(pkg: RawPkg | null): {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
} {
  const runtime = { ...(pkg?.dependencies || {}) }
  const dev = { ...(pkg?.devDependencies || {}) }
  const peer = {
    ...(pkg?.peerDependencies || {}),
    ...(pkg?.optionalDependencies || {}),
  }
  const out: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  } = {}
  if (Object.keys(runtime).length) {
    const entries = Object.entries(runtime).sort(([a], [b]) => a.localeCompare(b))
    out.dependencies = Object.fromEntries(entries)
  }
  if (Object.keys(dev).length) {
    const entries = Object.entries(dev).sort(([a], [b]) => a.localeCompare(b))
    out.devDependencies = Object.fromEntries(entries)
  }
  if (Object.keys(peer).length) {
    const entries = Object.entries(peer).sort(([a], [b]) => a.localeCompare(b))
    out.peerDependencies = Object.fromEntries(entries)
  }
  return out
}

function detectType(pkg: RawPkg | null, opts: {
  hasTurbo: boolean
  hasPnpmWs: boolean
  hasLerna: boolean
}): ProjectType[] {
  const types: ProjectType[] = []
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const scriptValues = Object.values(pkg?.scripts || {}).map(String)
  if (deps.vite || scriptValues.some(s => s.includes('vite')))
    types.push('vite')
  if (deps.webpack || scriptValues.some(s => s.includes('webpack')))
    types.push('webpack')
  if (deps.turbo || opts.hasTurbo)
    types.push('turborepo')
  if (opts.hasPnpmWs || opts.hasLerna || pkg?.workspaces)
    types.push('monorepo')
  if (deps.react)
    types.push('react')
  if (deps.vue)
    types.push('vue')
  if (types.length === 0)
    types.push('script')
  return types
}

/** 把 glob 模式（支持 * 与 **）转成正则，用于匹配相对目录路径 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('/')
    .map((seg) => {
      if (seg === '**')
        return '.*'
      return seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
    })
    .join('/')
  return new RegExp(`^${escaped}(?:/)?$`)
}

async function expandGlob(root: string, pattern: string, maxDepth = 8): Promise<string[]> {
  const regex = patternToRegex(pattern)
  const results: string[] = []
  const seen = new Set<string>()

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth)
      return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    }
    catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory())
        continue
      if (e.name === 'node_modules' || e.name.startsWith('.'))
        continue
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs)
      if ((regex.test(rel) || regex.test(`${rel}/`)) && !seen.has(abs)) {
        seen.add(abs)
        results.push(abs)
      }
      await walk(abs, depth + 1)
    }
  }

  await walk(root, 0)
  return results
}

async function resolveWorkspaceGlobs(
  root: string,
  rootPkg: RawPkg | null,
  opts: { hasPnpmWs: boolean, hasLerna: boolean },
): Promise<string[]> {
  const patterns: string[] = []

  if (opts.hasPnpmWs) {
    const raw = await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf-8').catch(() => '')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (t.startsWith('- '))
        patterns.push(t.slice(2).trim())
    }
  }
  if (opts.hasLerna) {
    const lerna = await readJson<{ packages?: string[] }>(path.join(root, 'lerna.json'))
    if (lerna?.packages)
      patterns.push(...lerna.packages)
  }
  if (Array.isArray(rootPkg?.workspaces)) {
    patterns.push(...rootPkg!.workspaces)
  }
  else if (rootPkg?.workspaces && Array.isArray((rootPkg.workspaces as { packages?: string[] }).packages)) {
    patterns.push(...(rootPkg.workspaces as { packages: string[] }).packages)
  }

  const dirs = new Set<string>()
  for (const pat of patterns)
    (await expandGlob(root, pat)).forEach(d => dirs.add(d))
  return [...dirs]
}

export interface ScanResult {
  name: string
  type: ProjectType[]
  isMonorepo: boolean
  scripts: PkgScript[]
  packages: ProjectPackage[]
  pm?: PackageManager
  branch?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** 通过 lock 文件推断包管理器；根 package.json 的 `packageManager` 字段作为兜底 */
async function detectPm(root: string, rootPkg?: RawPkg | null): Promise<PackageManager | undefined> {
  if (await exists(path.join(root, 'pnpm-lock.yaml')))
    return 'pnpm'
  if (await exists(path.join(root, 'yarn.lock')))
    return 'yarn'
  if (await exists(path.join(root, 'bun.lockb')))
    return 'bun'
  if (await exists(path.join(root, 'package-lock.json')))
    return 'npm'
  // 兜底：package.json 的 packageManager 字段，例如 "pnpm@9.0.0"
  const pmField = rootPkg?.packageManager
  if (typeof pmField === 'string') {
    if (pmField.startsWith('pnpm'))
      return 'pnpm'
    if (pmField.startsWith('yarn'))
      return 'yarn'
    if (pmField.startsWith('bun'))
      return 'bun'
    if (pmField.startsWith('npm'))
      return 'npm'
  }
  return undefined
}

/** 探测当前 git 分支（best-effort，失败返回 undefined） */
function detectBranch(root: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }, (err, stdout) => {
      if (err)
        return resolve(undefined)
      const b = stdout.trim()
      resolve(b || undefined)
    })
  })
}

/** 扫描一个工程目录：识别类型、解析根脚本、解析 monorepo 子包 */
export async function scanProject(projectPath: string): Promise<ScanResult> {
  const rootPkgPath = path.join(projectPath, 'package.json')
  const rootPkg = await readJson<RawPkg>(rootPkgPath)
  const name = rootPkg?.name || path.basename(projectPath)

  const hasTurbo = await exists(path.join(projectPath, 'turbo.json'))
  const hasPnpmWs = await exists(path.join(projectPath, 'pnpm-workspace.yaml'))
  const hasLerna = await exists(path.join(projectPath, 'lerna.json'))
  const hasYarnWs = !!rootPkg?.workspaces

  const scripts = await readScripts(rootPkgPath)
  const type = detectType(rootPkg, { hasTurbo, hasPnpmWs, hasLerna: hasLerna || hasYarnWs })
  const isMonorepo = hasPnpmWs || hasYarnWs || hasLerna || hasTurbo

  const packages: ProjectPackage[] = []
  if (isMonorepo) {
    const dirs = await resolveWorkspaceGlobs(projectPath, rootPkg, { hasPnpmWs, hasLerna })
    for (const absDir of dirs) {
      if (path.resolve(absDir) === path.resolve(projectPath))
        continue
      const pkgPath = path.join(absDir, 'package.json')
      if (!existsSync(pkgPath))
        continue
      const subPkg = await readJson<RawPkg>(pkgPath)
      packages.push({
        id: path.relative(projectPath, absDir),
        name: subPkg?.name || path.basename(absDir),
        relativePath: path.relative(projectPath, absDir),
        absolutePath: absDir,
        scripts: await readScripts(pkgPath),
        type: detectType(subPkg, { hasTurbo: false, hasPnpmWs: false, hasLerna: false }),
        version: subPkg?.version,
        author: normalizeAuthor(subPkg?.author),
        description: subPkg?.description,
        ...splitDeps(subPkg),
      })
    }
  }

  const pm = await detectPm(projectPath, rootPkg)
  const branch = await detectBranch(projectPath)
  return { name, type, isMonorepo, scripts, packages, pm, branch, ...splitDeps(rootPkg) }
}

/** 把工程目录 + 扫描结果组装为可持久化的 Project */
export function buildProject(projectPath: string, scan: ScanResult): Project {
  return {
    id: uid(),
    name: scan.name,
    path: projectPath,
    importTime: Date.now(),
    type: scan.type,
    isMonorepo: scan.isMonorepo,
    scripts: scan.scripts,
    packages: scan.packages,
    env: [],
    shell: '',
    pm: scan.pm,
    branch: scan.branch,
    note: '',
    dependencies: scan.dependencies,
    devDependencies: scan.devDependencies,
    peerDependencies: scan.peerDependencies,
  }
}

const ENV_LINE = /^([\w.-]+)\s*=(.*)$/

/** 解析 .env 文本内容为键值对 */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#'))
      continue
    const m = t.match(ENV_LINE)
    if (!m)
      continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\'')))
      v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

export async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await fs.readFile(filePath, 'utf-8'))
  }
  catch {
    return {}
  }
}
