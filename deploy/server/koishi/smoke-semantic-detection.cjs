// Synthetic-only live model probe. Never reads the database or sends Bot messages.
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.HDS_ROOT
if (!root) throw new Error('Set HDS_ROOT to the deployment directory before running synthetic probes.')
const app = path.join(root, '.local-hdsi/koishi-app')
process.env.NODE_PATH = path.join(app, 'node_modules')
require('node:module').Module._initPaths()
const plugin = require(process.env.HDS_PLUGIN_PATH || path.join(app, 'node_modules/koishi-plugin-hds-interlude'))
const yaml = require(path.join(app, 'node_modules/js-yaml'))
const models = []
function walk(group) {
  for (const [key, value] of Object.entries(group || {})) {
    const selectedKey = process.env.HDS_INCLUDE_DISABLED === '1' ? key.replace(/^~/, '') : key
    if (selectedKey.startsWith('hds-interlude:')) models.push(plugin.Config(value).model)
    if (selectedKey.startsWith('group:')) walk(value)
  }
}
walk(yaml.load(fs.readFileSync(path.join(app, 'koishi.yml'), 'utf8')).plugins)
const http = { async post(url, body, options = {}) {
  const response = await fetch(url, { method: 'POST', headers: options.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) })
  if (!response.ok) {
    console.log(JSON.stringify({ providerHttpStatus: response.status }))
    throw new Error(`HTTP ${response.status}`)
  }
  const result = await response.json()
  if (process.env.HDS_DEBUG === '1') console.log(JSON.stringify({ syntheticResponse: result.choices?.[0]?.message?.content }))
  return result
} }
const cases = [
  { name: 'expression-contradiction', expected: 'reject', expectedEmptyTimes: true, userMessage: '请诚恳道谢，没有讽刺或生气。', script: '他真诚地感谢对方的帮助，心情愉快，毫无怒意。', nativeFace: { semantic: 'angry', willingness: 1 } },
  { name: 'expression-contextual', expected: 'pass', expectedEmptyTimes: true, userMessage: '我们终于成功了！', script: 'He beams with delight at their success.', nativeFace: { semantic: 'smile', willingness: 0.8 } },
  { name: 'memory-wrong-calendar', expected: 'reject', memoryAudit: true, history: '2026年9月7日上午，交接已经完成。', script: JSON.stringify({ facts: [{ content: '2026年9月7日星期日完成交接。', sourceEntryIds: [1] }] }) },
  { name: 'memory-false-completion', expected: 'reject', memoryAudit: true, history: '尚未交接，准备稍后办理。', script: JSON.stringify({ facts: [{ content: '交接已经完成。', sourceEntryIds: [1] }] }) },
  { name: 'memory-supported', expected: 'pass', memoryAudit: true, history: '2026年9月7日上午，交接已经完成。', script: JSON.stringify({ facts: [{ content: '2026年9月7日完成交接。', sourceEntryIds: [1] }] }) },
  { name: 'deadline-paraphrase', expected: 'reject', script: '上午九点二十分，他首次提出今天的要求：“上午九点之前请交付结果。”' },
  { name: 'event-replay', expected: 'reject', history: '测试员已将封存箱交给接收员，签收手续已办完，箱子留在接收员处。',
    script: '没有取回箱子或发生新交接，他再次首次将同一个封存箱交给同一接收员并办理签收。' },
  { name: 'negation', expected: 'pass', history: '测试员留在原地等待，交接尚未开始。', script: '他没有离开，也没有完成交接，仍在原地等待。' },
  { name: 'reported-relative-time', expected: 'pass', userMessage: 'Yesterday at half past eleven at night, I finished the inspection.',
    script: '测试员记下对方报告的历史情况，没有将它当作刚刚发生的事件。', expectedLocal: '2026-09-06 23:30' },
]
async function run(model, route) {
  const reviewer = new plugin.OpenAICompatibleNarrator({ http, logger: () => ({
    warn(_message, reason) { console.log(JSON.stringify({ route, diagnostic: String(reason || 'review-warning') })) },
    debug(_message, error) { console.log(JSON.stringify({ route, diagnostic: error?.name || 'review-unavailable' })) },
  }) }, model, false)
  for (const item of cases) {
    if (process.env.HDS_CASES && !process.env.HDS_CASES.split(',').includes(item.name)) continue
    const from = new Date('2026-09-07T01:02:00Z'), now = new Date('2026-09-07T01:27:00Z')
    const setting = plugin.emptyStorySetting()
    setting.character = { name: '虚构测试员', profile: '完全虚构的测试角色，只受当前测试证据约束。' }
    setting.timezone = 'Asia/Shanghai'
    const story = { id: 'synthetic', platform: 'test', selfId: 'test', userId: '', channelId: '', status: 'active', setting,
      state: plugin.emptyStoryState(), cursorAt: from, createdAt: from, updatedAt: from }
    const recentEntries = item.history ? [{ id: 1, storyId: 'synthetic', participantId: '', kind: 'script', actor: 'narrator',
      content: item.history, occurredAt: from, createdAt: from, metadata: {} }] : []
    const context = { story, phase: item.userMessage ? 'user-message' : 'advance', from, now, userMessage: item.userMessage,
      participant: null, participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries }
    const result = await reviewer.reviewNarrative({ context, candidate: { script: item.script, nativeFace: item.nativeFace }, allowedDeliveries: [], alreadyDelivered: [], requireSemanticChecks: true, memoryAudit: item.memoryAudit })
    const ok = result?.verdict === item.expected && (!item.expectedEmptyTimes || result.reportedTimes?.length === 0) && (!item.expectedLocal || result.reportedTimes?.some(time => time.localTime === item.expectedLocal))
    console.log(JSON.stringify({ route, case: item.name, ok, verdict: result?.verdict || 'unavailable', checks: result?.checks?.map(check => ({ kind: check.kind, status: check.status })), reportedTimes: result?.reportedTimes }))
    if (!ok) process.exitCode = 1
  }
}
if (!models.length) throw new Error('No configured routes')
Promise.all(models.map((model, index) => run(model, index + 1))).catch(() => { console.error('Synthetic probe failed'); process.exitCode = 1 })
