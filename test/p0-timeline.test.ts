import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { toCompactionPayload } from '../src/narrator'
import { schedulePreplanWindow, nextSchedulePreplanTransition } from '../src/schedule-preplan'
import { emptyStorySetting, emptyStoryState } from '../src/types'

const now = new Date('2026-09-07T01:27:00Z')
const from = new Date('2026-09-06T15:30:00Z')
const story: any = { id: 'synthetic', setting: { ...emptyStorySetting(), timezone: 'Asia/Shanghai' }, state: emptyStoryState() }
const source: any = { id: 1, kind: 'script', participantId: '', actor: 'narrator', content: '已完成交接，明天再来。', occurredAt: from, metadata: {} }
const request: any = { story, from, now, entries: [source], facts: [], participants: [], scene: null, arc: null }
const proposal = { facts: [{ scope: 'event', content: '已完成交接。', sourceEntryIds: [1] }] }
const checks = ['time', 'progression'].map(kind => ({ kind, status: 'consistent', evidenceRefs: ['interval', 'history:1'], summary: 'Evidence supports the memory.' }))

test('compaction receives source-local calendar anchors across midnight', () => {
  const payload = toCompactionPayload(request)
  assert.equal(payload.interval.nowLocal.date, '2026-09-07')
  assert.equal(payload.entries[0].occurredAtLocal.date, '2026-09-06')
  assert.equal(payload.entries[0].occurredAtLocal.local, '2026-09-06 23:30:00')
})

test('compaction omits full roleplay canon and mutable setting overlays', () => {
  const sensitive: any = {
    ...request,
    story: {
      ...story,
      setting: { ...story.setting, character: { name: '周', profile: 'private full canon' }, world: 'private world', supportingCast: 'private cast' },
      state: { ...story.state, settingOverlay: { characterProfile: 'private overlay', perspective: 'private perspective', characterTraits: ['evidence-backed trait'] } },
    },
  }
  const payload = toCompactionPayload(sensitive)
  assert.equal(payload.setting.character.name, '周')
  assert.equal(payload.setting.character.profile, '')
  assert.equal(payload.setting.world, '')
  assert.equal('settingOverlay' in payload.evolvingState, false)
  assert.equal('recentContinuity' in payload, false)
})

test('memory audit blocks unsupported, uncertain and unavailable proposals before persistence', async () => {
  const service: any = Object.create(InterludeService.prototype)
  service.config = { model: { providers: [{ enabled: true, endpoint: 'https://example.invalid', model: 'test' }] } }
  const requests: any[] = []
  let response: any = { verdict: 'pass', issues: [], checks, reportedTimes: [] }
  service.compactor = { reviewNarrative: async (value: any) => { requests.push(value); return response } }
  await service.reviewCompactionMemory({ compactRequest: request }, proposal)
  assert.equal(requests[0].memoryAudit, true)
  assert.equal(requests[0].context.recentEntries[0].content, source.content)
  await assert.rejects(service.reviewCompactionMemory({ compactRequest: request }, { facts: [{ ...proposal.facts[0], sourceEntryIds: [999] }] }), /source entries/)
  for (const invalid of [undefined, { verdict: 'pass', issues: [] }, { verdict: 'pass', issues: [], checks: checks.map(check => ({ ...check, status: 'uncertain' })), reportedTimes: [] }]) {
    response = invalid
    await assert.rejects(service.reviewCompactionMemory({ compactRequest: request }, proposal), /retaining original/)
  }
})

function schedule(): any {
  return { storyId: 'synthetic', timezone: 'Asia/Shanghai', revision: 1, materializedDays: [], exceptions: [], regimes: [{
    id: 'night', from: '2026-09-01', weekly: { sunday: [{ id: 'shift', label: '值班', start: '22:00', end: '06:00', kind: 'fixed' }] },
  }] }
}

test('overnight schedule survives today-only materialization and retains next boundary', () => {
  const at = new Date('2026-09-06T17:00:00Z')
  const record = schedule()
  record.materializedDays = [{ date: '2026-09-07', blocks: [] }]
  const window = schedulePreplanWindow(record, at, 'Asia/Shanghai')!
  assert.equal(window.blocks[0].date, '2026-09-06')
  assert.equal(window.blocks[0].id, 'shift')
  assert.equal(nextSchedulePreplanTransition(record, at, 'Asia/Shanghai')?.toISOString(), '2026-09-06T22:00:00.000Z')
})

test('elapsed plans stay separate from upcoming blocks and are never completion evidence', () => {
  const window = schedulePreplanWindow(schedule(), now, 'Asia/Shanghai', 12, undefined, from)!
  assert.deepEqual(window.blocks, [])
  assert.equal(window.recentBlocks?.[0].id, 'shift')
  assert.equal(window.plannedNotObserved, true)
  assert.equal(nextSchedulePreplanTransition(schedule(), now, 'Asia/Shanghai'), undefined)
})

test('scene anchor derives from persisted ending instead of proposed completion', async () => {
  const service: any = Object.create(InterludeService.prototype)
  Object.defineProperty(service, 'memoryConfig', { value: { sceneSummaryCharacters: 1000, sceneHookCharacters: 1000 } })
  service.activeScene = async () => ({ id: 1 })
  let patch: any
  service.dbSet = async (_table: string, _where: any, value: any) => { patch = value }
  await service.persistTimelineSceneAnchor('synthetic', { activity: { value: '准备交接', quote: '尚未交接，准备稍后办理。' } }, 42, now)
  assert.match(patch.hook, /尚未交接/)
  assert.equal(patch.summary, undefined, 'only the background editor may advance scene summaries')
})
