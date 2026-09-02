<script setup lang="ts">
import type { EnvVar } from '../../shared/types'
import { NButton, NInput, NSwitch } from 'naive-ui'

const props = defineProps<{ modelValue: EnvVar[] }>()
const emit = defineEmits<{
  'update:modelValue': [v: EnvVar[]]
}>()

function update(v: EnvVar[]) {
  emit('update:modelValue', v)
}
function add() {
  update([...props.modelValue, { key: '', value: '', enabled: true }])
}
function remove(i: number) {
  update(props.modelValue.filter((_, idx) => idx !== i))
}
function setField(i: number, field: keyof EnvVar, val: string | boolean) {
  update(
    props.modelValue.map((e, idx) =>
      idx === i ? { ...e, [field]: val } : e,
    ),
  )
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div v-for="(e, i) in modelValue" :key="i" class="flex items-center gap-1.5">
      <NSwitch
        :value="e.enabled"
        @update:value="v => setField(i, 'enabled', v)"
      />
      <NInput
        :value="e.key"
        placeholder="KEY"
        @update:value="v => setField(i, 'key', v)"
      />
      <NInput
        :value="e.value"
        placeholder="value"
        @update:value="v => setField(i, 'value', v)"
      />
      <NButton text type="error" @click="remove(i)">
        <i class="i-carbon-close" />
      </NButton>
    </div>
    <NButton size="small" @click="add">
      + 添加变量
    </NButton>
  </div>
</template>
