import type { EnvVar, Project, RunRequest } from '../shared/types'

export function mergeEnv(...lists: EnvVar[][]): EnvVar[] {
  const map = new Map<string, EnvVar>()
  for (const list of lists) {
    for (const e of list) {
      if (e.key)
        map.set(e.key, e)
    }
  }
  return [...map.values()]
}

export function buildRunRequest(opts: {
  project: Project
  packageId: string | null
  script: string
  shell: string
  params: string
  extraEnv?: EnvVar[]
  defaultShell: string
}): RunRequest {
  const shell = opts.shell || opts.project.shell || opts.defaultShell || '/bin/zsh'
  const env = mergeEnv(opts.project.env, opts.extraEnv || [])
  return {
    projectId: opts.project.id,
    packageId: opts.packageId,
    script: opts.script,
    shell,
    env,
    params: opts.params,
  }
}

/** 选一个默认脚本：优先 dev / start / serve，否则取第一个 */
export function pickDefaultScript(scripts: { name: string }[]): string | null {
  if (scripts.length === 0)
    return null
  const preferred = ['dev', 'start', 'serve', 'develop']
  for (const p of preferred) {
    const hit = scripts.find(s => s.name === p)
    if (hit)
      return hit.name
  }
  return scripts[0].name
}
