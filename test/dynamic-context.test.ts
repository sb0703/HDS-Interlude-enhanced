import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService, normalizeScenePresenceDrafts } from '../src/service'
import { normalizeNarrativeReview, toNarrativeReviewPayload } from '../src/narrative-consistency'
import { evaluateAgencyCapacity, normalizeProactiveContact, resolveAgencyConfig } from '../src/agency'
import { emptyStorySetting, emptyStoryState } from '../src/types'
import { applySchedulePreplanProposal, resolveSchedulePreplanConfig } from '../src/schedule-preplan'

const now = new Date('2026-09-03T15:00:00+08:00')
const from = new Date('2026-09-03T14:00:00+08:00')
const zone = 'Asia/Shanghai'
const entry = (id: number, content: string) => ({ id, storyId: 'story', participantId: '', kind: 'script' as const, actor: 'narrator' as const, content, occurredAt: now, createdAt: now, metadata: {} })
const story = () => ({ id: 'story', setting: { ...emptyStorySetting(), timezone: zone }, state: emptyStoryState(), cursorAt: from })
const remoteModel = { providers: [{ id: 'main', enabled: true, endpoint: 'https://example.invalid', apiKey: '', model: 'test' }] }




function presenceHarness(review: unknown, config: any = { model: remoteModel }) {
  const service: any = Object.create(InterludeService.prototype)
  const requests: any[] = []
  service.config = config
  service.compactor = { reviewNarrative: async (request: any) => { requests.push(request); return review } }
  service.reportOperation = () => {}
  const context: any = { compactRequest: { story: story(), from, now, facts: [], entries: [entry(1, '小王还在办公室，小李离开了。')] } }
  const decision = { scene: { presence: [{ name: '小王', status: 'off-scene', basis: '小王已离场', evidenceQuote: '小王还在办公室，小李离开了。', sourceEntryIds: [1] }] } }
  return { service, requests, context, decision }
}

test('presence candidates cannot change memory without independent semantic approval', async () => {
  const reject = { verdict: 'reject', issues: [{ target: 'presence', kind: 'state-conflict', candidateExcerpt: '小王已离场', evidenceRefs: ['history:1'], reason: '离开的是小李，小王仍在办公室', repair: '不要更新小王为离场' }] }
  for (const response of [reject, undefined, { verdict: 'pass' }]) {
    const h = presenceHarness(response)
    assert.deepEqual(await h.service.reviewCompactionPresence(h.context, h.decision), [])
    assert.equal(h.requests.length, 1)
    assert.equal(h.requests[0].presenceUpdates[0].name, '小王')
  }
  const off = presenceHarness({ verdict: 'pass', issues: [] }, { model: { ...remoteModel, consistencyReview: false } })
  assert.deepEqual(await off.service.reviewCompactionPresence(off.context, off.decision), [])
  assert.equal(off.requests.length, 0)
})

test('arbitrary names and phrasing need exact evidence, not arrival/departure keywords', async () => {
  const h = presenceHarness({ verdict: 'pass', issues: [] })
  h.context.compactRequest.entries = [entry(2, 'R-7 is here beside the airlock.')]
  h.decision.scene.presence = [{ name: 'R-7', status: 'present', basis: 'R-7在气闸旁', evidenceQuote: 'R-7 is here beside the airlock.', sourceEntryIds: [2] }]
  assert.equal((await h.service.reviewCompactionPresence(h.context, h.decision))[0]?.name, 'R-7')
  assert.deepEqual(normalizeScenePresenceDrafts([{ ...h.decision.scene.presence[0], evidenceQuote: 'Invented quote' }], h.context.compactRequest.entries, now), [])
})

test('review retains a long event ending and prioritizes cited evidence over recent chatter', () => {
  const h = presenceHarness(undefined)
  const context: any = { ...h.context.compactRequest, recentEntries: [entry(1, '开始。' + '过程。'.repeat(1500) + '已离场，不再在办公室。'), ...Array.from({ length: 30 }, (_, i) => entry(i + 2, '聊天记录'))], participant: null, participants: [] }
  const request: any = { context, candidate: {}, allowedDeliveries: [], alreadyDelivered: [], retrievalHints: [{ similarity: 1, previousId: 1 }], evidenceCharacterBudget: 4000 }
  const payload = toNarrativeReviewPayload(request)
  const history = payload.evidence.find(item => item.ref === 'history:1')?.value as any
  assert.equal(history.truncated, true)
  assert.match(history.content, /已离场，不再在办公室。$/)
  assert.match(history.content, /middle omitted/)
  assert.equal(normalizeNarrativeReview({ verdict: 'pass', issues: [] }, request)?.verdict, 'pass')
})

test('contextual contact still enforces device availability, cooldown and explicit justification', () => {
  const config = resolveAgencyConfig({ minimumProactiveIntervalMinutes: 30 })
  const window: any = { activityLoad: 'occupied', deviceAccess: 'limited', privacy: 'shared', validUntil: '2026-09-03T16:00:00+08:00', basis: '有短暂空档', sourceEntryIds: [1], updatedAt: now.toISOString() }
  const candidate: any = { participantId: 'friend', origin: 'relationship-follow-up', disclosure: 'personal', motive: '确认安排', sourceEntryIds: [1], outcome: 'send-now', capacityReason: '已暂停手头工作，可以用自己的手机发一句确认，不透露私密细节。' }
  assert.equal(evaluateAgencyCapacity(window, candidate, now, config).allowed, true)
  assert.equal(evaluateAgencyCapacity(window, { ...candidate, capacityReason: '' }, now, config).allowed, false)
  assert.equal(evaluateAgencyCapacity(window, candidate, now, { ...config, capacityPolicy: 'conservative' }).allowed, false)
  assert.equal(evaluateAgencyCapacity({ ...window, deviceAccess: 'unavailable' }, candidate, now, config).allowed, false)
  assert.equal(evaluateAgencyCapacity(window, candidate, now, config, now.toISOString()).reason, 'minimum-proactive-interval')
  assert.equal(normalizeProactiveContact(candidate, now, config, new Set(['friend']), new Set([1]))?.capacityReason, candidate.capacityReason)
  const service: any = Object.create(InterludeService.prototype)
  service.config = { agency: config, model: { ...remoteModel, consistencyReview: false } }
  assert.equal(service.agencyConfig.capacityPolicy, 'conservative')
})

function scheduleHarness() {
  const service: any = Object.create(InterludeService.prototype)
  const currentStory: any = story()
  currentStory.setting.character.profile = '夜班角色。周二与周六22:00到次日06:00值班。'
  let record: any
  const requests: any[] = []
  service.config = { model: remoteModel }
  Object.defineProperty(service, 'schedulePreplanConfig', { value: resolveSchedulePreplanConfig() })
  service.schedulePreplanBackoff = new Map()
  service.getSchedulePreplan = async () => record
  service.getStory = async () => currentStory
  service.schedulePreplanEvidence = async () => []
  service.saveSchedulePreplan = async (next: any) => { record = next }
  service.dbSet = async (_table: string, _query: any, update: any) => { currentStory.state = update.state }
  service.reportOperation = () => {}
  service.requestSchedulePreplan = async (_story: any, request: any) => {
    requests.push(request)
    return { outcome: 'replace', reason: '按当前设定', regimes: [{ id: 'night', label: '夜班', from: '2026-09-03', weekly: { tuesday: [{ id: 'shift', start: '22:00', end: '06:00', label: '值班', kind: 'routine' }], saturday: [{ id: 'shift', start: '22:00', end: '06:00', label: '值班', kind: 'routine' }] } }] }
  }
  return { service, currentStory, requests, record: () => record }
}

test('schedule sync accepts any profile format and refreshes only after its source changes', async () => {
  const h = scheduleHarness()
  const first = await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now)
  assert.deepEqual(Object.keys(first.regimes[0].weekly), ['tuesday', 'saturday'])
  assert.equal(h.requests[0].characterProfile, h.currentStory.setting.character.profile)
  await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now)
  assert.equal(h.requests.length, 1)
  h.currentStory.setting.character.profile = '新日程：仅周六夜班。'
  await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now)
  assert.equal(h.requests.length, 2)
  assert.equal(h.record().revision, 2)
})

test('failed schedule refresh does not expose or destroy an obsolete plan, and retries are bounded', async () => {
  const h = scheduleHarness()
  await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now)
  const old = h.record()
  h.currentStory.setting.character.profile = '调整后的日程'
  h.service.requestSchedulePreplan = async () => undefined
  assert.equal(await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now), undefined)
  assert.equal(h.record(), old)
  assert.equal(await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now), undefined)
})

test('profile-derived schedules do not need fabricated historical entry ids', async () => {
  const h = scheduleHarness()
  h.service.schedulePreplanEvidence = async () => [entry(99, '今天普通聊天，没有提及排班。')]
  const plan = await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now)
  assert.equal(plan?.regimes[0]?.id, 'night')
  assert.deepEqual(plan?.regimes[0]?.sourceEntryIds, [])
})

test('a profile changed during model review cannot receive the old result', async () => {
  const h = scheduleHarness()
  h.service.requestSchedulePreplan = async () => {
    h.currentStory.setting.character.profile = '审核过程中修改后的新设定'
    return { outcome: 'replace', reason: '旧设定结果', regimes: [] }
  }
  assert.equal(await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now), undefined)
  assert.equal(h.record(), undefined)
})

test('an older background schedule revision cannot overwrite the refreshed profile plan', async () => {
  const h = scheduleHarness()
  await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now)
  const old = h.record()
  h.currentStory.setting.character.profile = '新的周末排班'
  await h.service.ensureConfiguredSchedulePreplan(h.currentStory, now)
  assert.equal(await h.service.persistSchedulePreplanReview(h.currentStory, { current: old, evidenceEntries: [], localDate: '2026-09-03' }, { outcome: 'replace', reason: '旧后台结果', regimes: [] }, now), false)
  assert.equal(h.record().revision, 2)
})

test('explicit empty recurring plan retains dated exceptions', () => {
  const result = applySchedulePreplanProposal(undefined, { outcome: 'replace', reason: '无固定作息，保留预约', regimes: [], exceptions: [{ date: '2026-09-04', mode: 'replace', reason: '已有预约', blocks: [{ id: 'visit', start: '10:00', end: '11:00', label: '预约', kind: 'fixed' }] }] }, [], '2026-09-03', zone, resolveSchedulePreplanConfig(), now)
  assert.equal(result?.exceptions.length, 1)
  assert.equal(result?.materializedDays.find(day => day.date === '2026-09-04')?.blocks[0].id, 'visit')
})
