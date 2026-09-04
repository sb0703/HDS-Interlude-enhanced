import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAICompatibleNarrator, toTimelinePlanPayload } from '../src/narrator'
import { InterludeService, normalizeTimelinePlan, timelineEntryPromptProjection, timelineRetryDelayMilliseconds } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, ScriptEntry, TimelinePlanRequest } from '../src/types'

const now = new Date('2026-08-31T08:37:00.000Z')

test('timeline director accepts only bounded relative beats and discards malformed output', () => {
  const plan = normalizeTimelinePlan({
    beats: [
      { at: 0.7, kind: 'thought', summary: '短暂想到中午的约定' },
      { at: 0, kind: 'activity', summary: '继续完成随堂练习' },
      { at: 2, kind: 'state', summary: '窗口结束时仍在课堂' },
      { at: 0.3, kind: 'teleport', summary: '无效节点' },
    ],
    carry: ['午间验收仍未发生'],
  })
  assert.deepEqual(plan?.beats.map(beat => beat.at), [0, 0.7, 1])
  assert.equal(plan?.carry?.[0], '午间验收仍未发生')
  assert.equal(normalizeTimelinePlan({ beats: [] }), undefined)
})

test('timeline director tolerates documented aliases and position formats without accepting unknown kinds', () => {
  const aliases = [
    ['action', 'activity'], ['event', 'activity'], ['scene', 'activity'], ['behavior', 'activity'],
    ['活动', 'activity'], ['行动', 'activity'], ['事件', 'activity'], ['场景', 'activity'],
    ['think', 'thought'], ['feeling', 'thought'], ['mood', 'thought'], ['inner', 'thought'],
    ['想法', 'thought'], ['心情', 'thought'], ['思绪', 'thought'],
    ['status', 'state'], ['condition', 'state'], ['状态', 'state'],
  ] as const
  for (const [alias, expected] of aliases) {
    assert.equal(normalizeTimelinePlan({ beats: [{ at: '50%', kind: alias, summary: alias }] })?.beats[0]?.kind, expected)
  }
  const plan = normalizeTimelinePlan({ beats: [
    { at: '0.5', kind: 'activity', summary: '中点' },
    { at: '75', kind: 'state', summary: '四分之三' },
    { at: -1, kind: 'thought', summary: '开头' },
    { at: '100%', kind: 'condition', summary: '结尾' },
    { at: 0.2, kind: 'teleport', summary: '未知类型' },
    { at: 0.9, kind: 'event', summary: '超过四节点后裁剪' },
  ] })
  assert.deepEqual(plan?.beats.map(item => [item.at, item.kind]), [
    [0, 'thought'], [0.5, 'activity'], [0.75, 'state'], [0.9, 'activity'],
  ])
  assert.ok(!plan?.beats.some(item => item.summary === '未知类型'))
})

test('timeline director receives authoritative Shanghai local dates across UTC midnight boundaries', () => {
  const from = new Date('2026-09-03T15:45:00.000Z')
  const localNow = new Date('2026-09-03T16:30:00.000Z')
  const story: InterludeStory = {
    id: 'local-time', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: { ...emptyStorySetting(), timezone: 'Asia/Shanghai' }, state: emptyStoryState(),
    cursorAt: from, createdAt: from, updatedAt: from,
  }
  const payload = toTimelinePlanPayload({ story, participant: null, phase: 'advance', from, now: localNow, scene: null, facts: [], recentEntries: [], dueIntents: [] })
  assert.equal(payload.interval.from, '2026-09-03T15:45:00.000Z')
  assert.equal(payload.interval.now, '2026-09-03T16:30:00.000Z')
  assert.equal(payload.interval.storyTimezone, 'Asia/Shanghai')
  assert.equal(payload.interval.fromLocal, '2026-09-03 23:45:00')
  assert.equal(payload.interval.nowLocal, '2026-09-04 00:30:00')
  assert.equal(payload.interval.fromLocalContext.weekday, 'Thursday')
  assert.equal(payload.interval.nowLocalContext.weekday, 'Friday')
  assert.equal(payload.interval.nowLocalContext.period, 'night')
})

test('timeline retry uses the fixed six-step backoff schedule', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(value => timelineRetryDelayMilliseconds(value) / 60_000), [10, 20, 40, 80, 120, 120, 120])
})

function timelineService(result: unknown | (() => unknown)) {
  const service = Object.create(InterludeService.prototype) as any
  let calls = 0
  service.config = { timelineDirector: { enabled: true }, runtime: { memoryLimit: 20 } }
  Object.defineProperties(service, {
    memoryConfig: { value: { enabled: false } },
    schedulePreplanConfig: { value: { enabled: false } },
    sharedStoryConfig: { value: { shareParticipantDetails: false } },
  })
  service.activeScene = async () => null
  service.recentEntriesForPrompt = async () => []
  service.reportOperation = () => undefined
  service.dbSet = async () => undefined
  service.compactor = { planTimeline: async () => {
    calls++
    return typeof result === 'function' ? (result as () => unknown)() : result
  } }
  return { service, calls: () => calls }
}

test('timeline retry survives reload, changes cursor cleanly and manual probing clears the fuse state', async () => {
  const from = new Date('2026-09-04T00:00:00.000Z')
  const failedAt = new Date('2026-09-04T00:20:00.000Z')
  const retryStory: InterludeStory = {
    id: 'retry', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
    setting: { ...emptyStorySetting(), timezone: 'Asia/Shanghai' }, state: emptyStoryState(),
    cursorAt: from, createdAt: from, updatedAt: from,
  }
  const first = timelineService(undefined)
  assert.equal(await first.service.planAutomaticTimeline(retryStory, null, 'advance', from, failedAt, []), undefined)
  assert.equal(retryStory.state.automation.timelineDirectorFailures, 1)
  assert.equal(retryStory.state.automation.timelineRetryAt, '2026-09-04T00:30:00.000Z')

  const reloaded = { ...retryStory, state: structuredClone(retryStory.state) }
  const gated = timelineService({ beats: [{ at: 1, kind: 'state', summary: '继续当前小事' }] })
  await gated.service.planAutomaticTimeline(reloaded, null, 'advance', from, new Date('2026-09-04T00:21:00.000Z'), [])
  assert.equal(gated.calls(), 0)

  const changedCursor = new Date('2026-09-04T00:01:00.000Z')
  assert.ok(await gated.service.planAutomaticTimeline(reloaded, null, 'advance', changedCursor, new Date('2026-09-04T00:22:00.000Z'), []))
  assert.equal(gated.calls(), 1)
  assert.equal(reloaded.state.automation.timelineDirectorFailures, undefined)

  const manualStory = { ...retryStory, state: structuredClone(retryStory.state) }
  const manual = timelineService({ beats: [{ at: '100%', kind: 'status', summary: '手动探测成功' }] })
  assert.ok(await manual.service.planAutomaticTimeline(manualStory, null, 'advance', from, new Date('2026-09-04T00:21:00.000Z'), [], undefined, true))
  assert.equal(manual.calls(), 1)
  assert.equal(manualStory.state.automation.timelineRetryAt, undefined)
})

test('automatic script entries project to their host timeline ledger on later turns', () => {
  const entry: ScriptEntry = {
    id: 1, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator',
    content: '八点十六分到八点三十七分之间，她在课堂上，随后却被错误写到了中午。',
    occurredAt: now, createdAt: now,
    metadata: { timelinePlan: { beats: [{ at: 0, kind: 'activity', summary: '完成课堂练习' }, { at: 1, kind: 'state', summary: '仍在课堂' }] } },
  }
  const projected = timelineEntryPromptProjection(entry)
  assert.notEqual(projected.content, entry.content)
  assert.match(projected.content, /Host timeline ledger/)
  assert.doesNotMatch(projected.content, /中午/)
})

test('timeline director reuses the compaction route and requests a small JSON ledger', async () => {
  const calls: any[] = []
  const ctx = { http: { post: async (_url: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: '{"beats":[{"at":0,"kind":"activity","summary":"继续课堂练习"}]}' } }] }
  } } }
  const narrator = new OpenAICompatibleNarrator(ctx as any, {
    providers: [{ label: 'Compact', enabled: true, endpoint: 'https://example.test/chat', model: 'compact-model', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 10_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForCompaction: true }],
    compaction: { enabled: true, providerId: '', model: '', temperature: 0.3, topP: 1, maxTokens: 2048, timeout: 10_000, responseFormat: 'json-object', fixedPrompt: '', stylePrompt: '' },
    failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
  } as any, true)
  const story: InterludeStory = { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now }
  const request: TimelinePlanRequest = { story, participant: null, phase: 'advance', from: new Date(now.getTime() - 20 * 60_000), now, scene: null, facts: [], recentEntries: [], dueIntents: [], schedulePreplan: null }
  const plan = await narrator.planTimeline(request)
  assert.equal(plan?.beats[0]?.summary, '继续课堂练习')
  assert.equal(calls[0].temperature, 0.3)
  assert.equal(calls[0].max_tokens, 480)
  assert.equal(calls[0].response_format.type, 'json_object')
  assert.match(JSON.stringify(calls[0]), /storyTimezone/)
  assert.match(JSON.stringify(calls[0]), /fromLocalContext/)
})
