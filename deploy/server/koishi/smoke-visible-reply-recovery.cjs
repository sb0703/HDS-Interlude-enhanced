const fs = require('node:fs')
const path = require('node:path')

const root = process.env.HDS_ROOT || '/opt/hds-interlude'
const appDir = path.join(root, '.local-hdsi/koishi-app')
const plugin = require(path.join(appDir, 'node_modules/koishi-plugin-hds-interlude'))
const yaml = require(path.join(appDir, 'node_modules/js-yaml'))
const config = yaml.load(fs.readFileSync(path.join(appDir, 'koishi.yml'), 'utf8'))

const http = {
  async post(url, body, options = {}) {
    const response = await fetch(url, {
      method: 'POST', headers: options.headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout || 120000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  },
}

const logger = { warn() {}, debug() {} }
const smokeContext = { http, logger: () => logger }
const now = new Date('2026-09-04T09:00:00.000Z')
const from = new Date('2026-09-04T08:59:30.000Z')
const setting = plugin.emptyStorySetting()
setting.character = { name: '测试角色', profile: '说话简短、直接，按已知事实回应。' }
const story = {
  id: 'visible-reply-recovery-smoke', platform: 'test', selfId: 'test', userId: 'test-user', channelId: 'private:test-user', status: 'active',
  setting, state: plugin.emptyStoryState(), cursorAt: from, createdAt: from, updatedAt: now,
}
const participant = {
  id: 'test-user', storyId: story.id, platform: 'test', userId: 'test-user', channelId: story.channelId,
  displayName: '测试用户', profile: '', relationship: '普通对话', state: plugin.emptyParticipantState(), createdAt: from, updatedAt: now,
}
const request = {
  story, phase: 'user-message', from, now, userMessage: '请简短回复收到。', participant, participants: [],
  shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [],
  outputRecovery: true,
  outputRecoveryDraft: { script: '测试角色看到这条消息，准备简短确认。' },
}

function validInteraction(value) {
  if (!value || typeof value.seen !== 'boolean' || !value.reply) return false
  if (value.reply.mode === 'none') return true
  return (value.reply.mode === 'immediate' || value.reply.mode === 'delayed')
    && typeof value.reply.content === 'string' && value.reply.content.trim().length > 0
}

async function main() {
  const group = config?.plugins?.['group:hdsi'] || {}
  const instances = Object.entries(group).filter(([key, value]) => key.startsWith('hds-interlude:') && value?.model)
  let failed = false
  for (const [key, instance] of instances) {
    const resolved = plugin.Config(instance)
    const model = { ...resolved.model, mainPrompt: '继续简短、现实的日常对话。', fixedPrompt: '', formatPrompt: '', stylePrompt: '使用简洁现代汉语。' }
    const narrator = new plugin.OpenAICompatibleNarrator(smokeContext, model, true)
    const decision = await narrator.decide(request)
    const ok = typeof decision.script === 'string' && decision.script.trim().length > 0 && validInteraction(decision.interaction)
    console.log(JSON.stringify({ instance: key, ok, replyMode: decision.interaction?.reply?.mode || 'missing', topLevelKeys: Object.keys(decision).sort() }))
    if (!ok) failed = true
  }
  if (!instances.length || failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
