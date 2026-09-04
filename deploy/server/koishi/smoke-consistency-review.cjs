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
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout || 120000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  },
}

const logger = {
  warn(format, ...args) {
    console.error(`WARN ${String(format).replace(/%s/g, () => String(args.shift()))}`)
  },
  debug(format, ...args) {
    console.error(`DEBUG ${String(format).replace(/%s/g, () => String(args.shift()))}`)
  },
}
const smokeContext = { http, logger: () => logger }

const now = new Date('2026-09-04T08:00:00.000Z')
const from = new Date('2026-09-04T07:40:00.000Z')
const plan = { beats: [{ at: 1, kind: 'state', summary: '讨论仍在进行，尚未结束' }] }
const setting = plugin.emptyStorySetting()
setting.character = { name: '测试角色', profile: '做事谨慎，以既有事实为准。' }
const story = {
  id: 'review-smoke', platform: 'test', selfId: 'test', userId: '', channelId: '', status: 'active',
  setting, state: plugin.emptyStoryState(), cursorAt: from, createdAt: from, updatedAt: from,
}
const context = {
  story, phase: 'advance', from, now, participant: null, participants: [], shareParticipantDetails: false,
  dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [], timelinePlan: plan,
}
const request = {
  context,
  candidate: { script: '讨论还没有结束，他却当场宣布讨论已经结束，随后离开。' },
  allowedDeliveries: [],
  alreadyDelivered: [],
}

async function main() {
  const group = config?.plugins?.['group:hdsi'] || {}
  const instances = Object.entries(group).filter(([key, value]) => key.startsWith('hds-interlude:') && value?.model)
  let failed = false
  for (const [key, instance] of instances) {
    const resolved = plugin.Config(instance)
    const narrator = new plugin.OpenAICompatibleNarrator(smokeContext, resolved.model, false)
    const review = await narrator.reviewNarrative(request)
    const result = { instance: key, verdict: review?.verdict || 'unavailable', issueCount: review?.issues?.length ?? 0 }
    console.log(JSON.stringify(result))
    if (!review) failed = true
  }
  if (!instances.length || failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
