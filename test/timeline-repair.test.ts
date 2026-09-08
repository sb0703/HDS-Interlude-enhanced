import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService, timelineEntryPromptProjection } from '../src/service'
import { toNarrativeReviewPayload } from '../src/narrative-consistency'
import { applySchedulePreplanProposal, resolveSchedulePreplanConfig, schedulePreplanReviewDue } from '../src/schedule-preplan'
import { emptyStorySetting, emptyStoryState, ScriptEntry } from '../src/types'

const from = new Date('2026-09-07T01:02:29Z')
const now = new Date('2026-09-07T01:27:29Z')
const config = resolveSchedulePreplanConfig()
const story = { id: 'test', platform: 'test', selfId: 'test', userId: '', channelId: '', status: 'active' as const,
  setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: from, createdAt: from, updatedAt: from }

test('live history and review retain departures completed beyond the old plan', () => {
  const entry: ScriptEntry = { id: 2455, storyId: 'test', participantId: '', kind: 'script', actor: 'narrator',
    content: '车已经驶出地库，汇入地面道路。', occurredAt: from, createdAt: from,
    metadata: { timelinePlan: { beats: [{ at: 1, kind: 'state', summary: '发动车子，准备出发' }] } } }
  const projected = timelineEntryPromptProjection(entry, true)
  const payload = toNarrativeReviewPayload({ context: { story, phase: 'advance', from, now, participant: null,
    participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [],
    memories: [], recentEntries: [projected] }, candidate: { script: '从车位倒出来。' }, allowedDeliveries: [], alreadyDelivered: [] })
  const history = payload.evidence.find(item => item.ref === 'history:2455')!.value as { content: string }
  assert.equal(projected.metadata.timelinePlan, entry.metadata.timelinePlan)
  assert.match(history.content, /已经驶出地库/)
  assert.equal(entry.content, '车已经驶出地库，汇入地面道路。')
})


test('failed daily schedule review preserves prior date and remains retryable', () => {
  const old = applySchedulePreplanProposal(undefined, { outcome: 'replace', reason: 'No routine', regimes: [], exceptions: [] }, [], '2026-09-06', 'Asia/Shanghai', config, from)!
  const before = structuredClone(old)
  assert.equal(applySchedulePreplanProposal(old, {}, [], '2026-09-07', 'Asia/Shanghai', config, now), undefined)
  assert.deepEqual(old, before)
  assert.equal(schedulePreplanReviewDue(old, now, 'Asia/Shanghai', config), true)
  assert.equal(applySchedulePreplanProposal(old, { outcome: 'replace', reason: 'Malformed', regimes: [{}] }, [], '2026-09-07', 'Asia/Shanghai', config, now), undefined)
})

test('daily persistence accepts profile-derived routine and never saves failed first-use output', async () => {
  const service = Object.create(InterludeService.prototype) as any
  const saved: any[] = []
  Object.defineProperty(service, 'schedulePreplanConfig', { value: config })
  service.getSchedulePreplan = async () => undefined
  service.getStory = async () => story
  service.saveSchedulePreplan = async (value: unknown) => saved.push(value)
  service.reportOperation = () => {}
  const review = { current: undefined, evidenceEntries: [{ id: 1 }], localDate: '2026-09-07' }
  assert.equal(await service.persistSchedulePreplanReview(story, review, undefined, now), false)
  assert.equal(saved.length, 0)
  const proposal = { outcome: 'replace', reason: 'Current author profile routine', sourceEntryIds: [], regimes: [
    { id: 'work', label: 'Work', from: '2026-09-07', weekly: { monday: [
      { id: 'office', start: '09:00', end: '12:00', label: 'Office', kind: 'fixed', sourceEntryIds: [] },
    ] }, sourceEntryIds: [] },
  ], exceptions: [] }
  assert.equal(await service.persistSchedulePreplanReview(story, review, proposal, now), true)
  assert.equal(saved[0].regimes[0].weekly.monday[0].start, '09:00')
})
