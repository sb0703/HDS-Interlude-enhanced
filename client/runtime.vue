<template>
  <k-layout>
    <el-scrollbar class="runtime-scroll">
      <main class="runtime-page">
        <header class="runtime-header">
          <div>
            <p class="eyebrow">HDS INTERLUDE</p>
            <h1>运行监控</h1>
            <p>按角色切换查看实时日志；日志仅保留在当前进程内，重启后会清空。</p>
          </div>
          <button class="refresh-button" :disabled="loading" @click="refresh">
            {{ loading ? '刷新中…' : '刷新' }}
          </button>
        </header>

        <p v-if="error" class="error">{{ error }}</p>
        <section v-if="profiles.length" class="runtime-card">
          <nav class="tabs" aria-label="角色运行日志">
            <button
              v-for="profile in profiles"
              :key="profile.botId"
              class="tab"
              :class="{ active: profile.botId === selectedBotId }"
              @click="selectedBotId = profile.botId"
            >
              <strong>{{ profile.characterName }}</strong>
              <span>QQ {{ maskBotId(profile.botId) }}</span>
            </button>
          </nav>

          <section v-if="selectedProfile" class="log-panel">
            <header class="log-header">
              <strong>{{ selectedProfile.characterName }}</strong>
              <span>QQ {{ selectedProfile.botId }} · {{ selectedProfile.logs.length }} 条本次运行日志</span>
            </header>
            <p v-if="!selectedProfile.logs.length" class="empty">尚未产生 HDSI 运行日志。给该角色发送一条私聊消息后会显示在这里。</p>
            <ol v-else class="log-list">
              <li v-for="(entry, index) in selectedProfile.logs" :key="`${entry.timestamp}-${index}`" :class="`level-${entry.level}`">
                <time>{{ formatTime(entry.timestamp) }}</time>
                <span class="level">{{ levelLabel(entry.level) }}</span>
                <pre>{{ entry.message }}</pre>
              </li>
            </ol>
          </section>
        </section>
        <section v-else class="runtime-card empty">尚未发现已配置的 HDSI 角色实例。</section>
      </main>
    </el-scrollbar>
  </k-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { send } from '@koishijs/client'

interface RuntimeLogEntry {
  timestamp: number
  level: 'error' | 'warn' | 'info' | 'debug'
  message: string
}

interface RuntimeLogProfile {
  botId: string
  characterName: string
  logs: RuntimeLogEntry[]
}

const profiles = ref<RuntimeLogProfile[]>([])
const selectedBotId = ref('')
const loading = ref(false)
const error = ref('')
let timer: number | undefined

const selectedProfile = computed(() => profiles.value.find(profile => profile.botId === selectedBotId.value) ?? profiles.value[0])

function maskBotId(value: string) {
  return value.length < 6 ? value : `${value.slice(0, 3)}***${value.slice(-3)}`
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp))
}

function levelLabel(level: RuntimeLogEntry['level']) {
  return { error: '错误', warn: '警告', info: '信息', debug: '调试' }[level]
}

async function refresh() {
  loading.value = true
  try {
    const result = await send('hds-interlude/runtime-logs') as RuntimeLogProfile[]
    profiles.value = result
    if (!result.some(profile => profile.botId === selectedBotId.value)) selectedBotId.value = result[0]?.botId ?? ''
    error.value = ''
  } catch (reason) {
    error.value = `无法读取运行日志：${reason instanceof Error ? reason.message : String(reason)}`
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await refresh()
  timer = window.setInterval(() => void refresh(), 3_000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<style scoped>
.runtime-scroll { height: 100%; }
.runtime-page { min-height: 100%; padding: 36px 24px 72px; color: var(--fg1); }
.runtime-header { max-width: 1120px; margin: 0 auto 22px; display: flex; justify-content: space-between; gap: 20px; align-items: end; }
.eyebrow { margin: 0 0 8px; color: #f07845; font-weight: 800; letter-spacing: .16em; }
h1 { margin: 0; font-size: 30px; }
.runtime-header p:not(.eyebrow) { margin: 10px 0 0; color: var(--fg2); }
.refresh-button { border: 1px solid var(--k-color-divider, rgba(127,127,127,.25)); border-radius: 8px; padding: 9px 18px; background: transparent; color: var(--fg1); cursor: pointer; }
.runtime-card { max-width: 1120px; margin: 0 auto; overflow: hidden; border: 1px solid var(--k-color-divider, rgba(127,127,127,.25)); border-radius: 14px; background: var(--k-card-bg, rgba(127,127,127,.06)); }
.tabs { display: flex; gap: 1px; padding: 10px 10px 0; border-bottom: 1px solid var(--k-color-divider, rgba(127,127,127,.25)); overflow-x: auto; }
.tab { min-width: 150px; border: 0; border-radius: 9px 9px 0 0; padding: 12px 16px; background: transparent; color: var(--fg2); text-align: left; cursor: pointer; }
.tab strong, .tab span { display: block; }
.tab span { margin-top: 4px; font-size: 12px; opacity: .78; }
.tab.active { background: rgba(240,120,69,.18); color: var(--fg1); }
.log-panel { padding: 18px; }
.log-header { display: flex; justify-content: space-between; gap: 16px; color: var(--fg2); }
.log-header strong { color: var(--fg1); }
.log-list { margin: 16px 0 0; padding: 0; list-style: none; font-family: ui-monospace, Consolas, monospace; }
.log-list li { display: grid; grid-template-columns: 74px 42px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-top: 1px solid var(--k-color-divider, rgba(127,127,127,.18)); }
time { color: var(--fg3, #8a8a8a); }
.level { font-weight: 700; color: #4ba3ff; }
.level-warn .level { color: #e5a640; }.level-error .level { color: #ef6262; }.level-debug .level { color: #9a9a9a; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: var(--fg1); }
.empty { padding: 24px; color: var(--fg2); line-height: 1.7; }
.error { max-width: 1120px; margin: 0 auto 16px; color: #ef6262; }
@media (max-width: 680px) { .runtime-page { padding: 24px 12px 64px; }.runtime-header { align-items: start; flex-direction: column; }.log-list li { grid-template-columns: 66px 42px minmax(0, 1fr); }.log-header { flex-direction: column; gap: 4px; } }
</style>
