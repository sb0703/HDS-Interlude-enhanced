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

const smokeContext = { http, logger: () => ({ warn() {}, debug() {} }) }
const from = new Date('2026-09-04T08:59:00.000Z')
const now = new Date('2026-09-04T09:00:00.000Z')
const setting = plugin.emptyStorySetting()
setting.timezone = 'Asia/Shanghai'
setting.character = { name: '测试角色', profile: '使用当前上海本地时间。' }
const story = {
  id: 'local-time-review-smoke', platform: 'test', selfId: 'test', userId: '', channelId: '', status: 'active',
  setting, state: plugin.emptyStoryState(), cursorAt: from, createdAt: from, updatedAt: now,
}
const context = {
  story, phase: 'advance', from, now, participant: null, participants: [], shareParticipantDetails: false,
  dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [],
}
const request = {
  context,
  candidate: { script: '现在是下午五点，距离傍晚六点半还有约一个半小时。' },
  allowedDeliveries: [], alreadyDelivered: [],
}

async function main() {
  const group = config?.plugins?.['group:hdsi'] || {}
  const instances = Object.entries(group).filter(([key, value]) => key.startsWith('hds-interlude:') && value?.model)
  let failed = false
  for (const [key, instance] of instances) {
    const resolved = plugin.Config(instance)
    const reviewer = new plugin.OpenAICompatibleNarrator(smokeContext, resolved.model, true)
    const review = await reviewer.reviewNarrative(request)
    const ok = review?.verdict === 'pass'
    console.log(JSON.stringify({ instance: key, ok, verdict: review?.verdict || 'unavailable', issueCount: review?.issues?.length ?? 0 }))
    if (!ok) failed = true
  }
  if (!instances.length || failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
