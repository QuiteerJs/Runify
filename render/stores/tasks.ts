import type { TaskPlan } from '../../shared/types'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../ipc'

export const useTasks = defineStore('tasks', () => {
  const plans = ref<TaskPlan[]>([])

  async function load(): Promise<void> {
    plans.value = await api.getTasks()
  }

  async function save(): Promise<void> {
    await api.saveTasks(plans.value)
  }

  function find(id: string): TaskPlan | undefined {
    return plans.value.find(p => p.id === id)
  }

  function upsert(plan: TaskPlan): void {
    const idx = plans.value.findIndex(p => p.id === plan.id)
    if (idx >= 0)
      plans.value[idx] = plan
    else
      plans.value.push(plan)
  }

  function remove(id: string): void {
    plans.value = plans.value.filter(p => p.id !== id)
  }

  return { plans, load, save, find, upsert, remove }
})
