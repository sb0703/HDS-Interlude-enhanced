import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeWorkingDetails, recentContinuityContext } from '../src/continuity'
import { systemPrompt, toPromptPayload, toTimelinePlanPayload } from '../src/narrator'
import { InterludeService, isHistoryEntryVisibleToParticipant, timelineEntryPromptProjection } from '../src/service'
import { emptyStorySetting, emptyStoryState, InterludeStory, NarrativeIntent, NarrativeRequest, ScriptEntry, TimelinePlanRequest, WorkingDetail } from '../src/types'

const now = new Date('2026-09-03T07:49:00Z')
const previous = new Date('2026-09-03T07:47:38Z')
const story: InterludeStory = { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: previous, createdAt: previous, updatedAt: previous }
function entry(id: number, kind: string, content: string, metadata = {}, occurredAt = previous): ScriptEntry {
  return { id, storyId: 'story', participantId: 'p1', kind, actor: kind === 'script' ? 'narrator' : 'character', content, metadata, occurredAt, createdAt: occurredAt }
}
const sent = entry(2115, 'character-message', '我四点半有个会。')
const received = entry(2116, 'user-message', '摸鱼到下班')
const planned = entry(2117, 'script', '喝水，看旧消息，觉得对方坦诚，拿手机准备回复。', {
  phase: 'conversation-follow-up', interaction: { seen: true, reply: { mode: 'delayed', content: '真摸鱼去了？', sendAt: now.toISOString() } },
  timelinePlan: { beats: [
    { at: 0, kind: 'state', summary: '仍在办公室' },
    { at: 0.4, kind: 'thought', summary: '看到对方说摸鱼，觉得对方坦诚' },
    { at: 0.7, kind: 'activity', summary: '放下手机喝水' },
    { at: 1, kind: 'activity', summary: '拿起手机准备回复' },
  ] },
})
const due = { id: 8, type: 'delayed-reply', participantId: 'p1', summary: '已安排回复', notBefore: now, payload: { content: '真摸鱼去了？' } } as NarrativeIntent

test('2117 to 2118: old judgements are historical, a prepared reply is not a sent reply', () => {
  const context = recentContinuityContext([sent, received, timelineEntryPromptProjection(planned)], now)
  assert.equal(context.lastNarratedBeat?.summary, '拿起手机准备回复')
  assert.equal(context.alreadyNarrated.length, 3)
  assert.equal(context.alreadyNarrated[0].entryId, 2117)
  assert.deepEqual(context.deliveredMessages.map(item => [item.entryId, item.direction]), [[2115, 'sent'], [2116, 'received']])
  assert.ok(!JSON.stringify(context.deliveredMessages).includes('真摸鱼去了'))
  assert.equal(story.state.continuitySnapshot, undefined, 'history anchoring must not require a memory snapshot')
})

test('director gets the pending reply separately from actual historical delivery', () => {
  const request: TimelinePlanRequest = { story, participant: null, phase: 'intent-due', from: previous, now, scene: null, facts: [], recentEntries: [sent, received, planned], dueIntents: [due] }
  const payload = toTimelinePlanPayload(request)
  assert.equal(payload.dueIntents[0].pendingReplyDraft, '真摸鱼去了？')
  assert.equal(payload.recentContinuity.deliveredMessages.length, 2)
  assert.equal(payload.recentContinuity.lastNarratedBeat?.entryId, 2117)
  const recovery = toTimelinePlanPayload({ ...request, dueIntents: [{ ...due, payload: { streamRecovery: true } }] })
  assert.equal(recovery.dueIntents[0].streamRecovery, true)
  assert.equal(recovery.dueIntents[0].pendingReplyDraft, undefined)
})

test('cache-first keeps the same timeline and continuity constraints as legacy', () => {
  const request: NarrativeRequest = { phase: 'intent-due', story, from: previous, now, participant: null, participants: [], shareParticipantDetails: false, dueIntents: [due], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [planned],
    timelinePlan: { beats: [{ at: 1, kind: 'activity', summary: '发出已经准备好的回复' }] }, timelineCarry: ['会议还没开始'] }
  const legacy = toPromptPayload(request) as any
  const cache = toPromptPayload(request, { cacheFirst: true }) as any
  for (const key of ['timelinePlan', 'timelineCarry', 'recentContinuity']) assert.deepEqual(cache[key], legacy[key])
  assert.equal(cache.timelinePlan.beats[0].summary, '发出已经准备好的回复')
})

test('visible-reply recovery returns the unpublished draft to the model as data', () => {
  const draft = { script: '他看完消息，但上一次输出漏了传输字段。' }
  const request: NarrativeRequest = {
    phase: 'user-message', story, from: previous, now, participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [],
    outputRecovery: true, outputRecoveryDraft: draft,
  }
  const payload = toPromptPayload(request) as any
  assert.equal(payload.outputRecovery, true)
  assert.deepEqual(payload.outputRecoveryDraft, draft)
  const ordinary = toPromptPayload({ ...request, outputRecovery: false }) as any
  assert.equal(ordinary.outputRecoveryDraft, undefined)
})

test('recovery includes the actual detector diagnostics, not a generic duplicate warning', () => {
  const diagnostic = '时间应停在15:49；上一轮已读过消息，只处理本轮回复。'
  const prompt = systemPrompt('intent-due', '', '', '', '', '', false, false, false, false, false, undefined, false, undefined, false, false, true, [], diagnostic)
  assert.ok(prompt.includes(diagnostic))
  assert.match(prompt, /alreadyNarrated/)
})

test('continuity is bounded and cannot expose future or excluded participant history', () => {
  const hidden = { ...entry(2119, 'user-message', 'other-private'), participantId: 'p2' }
  const group = entry(2120, 'group-message', 'group-private')
  const future = entry(2121, 'character-message', 'future-message', {}, new Date(now.getTime() + 60_000))
  const visible = [planned, sent, hidden, group, future].filter(item => isHistoryEntryVisibleToParticipant(item, 'p1', false))
  const serialized = JSON.stringify(recentContinuityContext(visible, now))
  assert.ok(!serialized.includes('other-private'))
  assert.ok(!serialized.includes('group-private'))
  assert.ok(!serialized.includes('future-message'))
  const lots = Array.from({ length: 20 }, (_, index) => ({ ...planned, id: index }))
  assert.equal(recentContinuityContext(lots, now).alreadyNarrated.length, 8)
})

test('a later live narrative supersedes the old automatic endpoint', () => {
  const later = entry(2118, 'script', '已经去会议室了。', {}, now)
  const context = recentContinuityContext([planned, later], now)
  assert.equal(context.lastNarratedBeat, null)
  assert.equal(context.alreadyNarrated.length, 3)
})

const details: WorkingDetail[] = [
  { label: '取餐', value: '凭8914取餐', createdAt: previous.toISOString() },
  { label: '文件', value: '尚待确认', createdAt: previous.toISOString(), expiresAt: '2026-09-03T09:00:00Z' },
]
const completed = entry(2122, 'script', '已取到午餐。', {}, now)

test('settled scratchpad details are removed, while omitted unfinished details survive', () => {
  assert.deepEqual(mergeWorkingDetails(details, [{ label: '取餐', status: 'resolved', sourceEntryIds: [2122] }], [completed], now), [details[1]])
  assert.deepEqual(mergeWorkingDetails(details, [], [completed], now), details)
})

test('unbacked, malformed or older compaction cannot resolve a current detail', () => {
  for (const drafts of [
    [{ label: '取餐', status: 'resolved', sourceEntryIds: [9999] }],
    [{ label: '取餐', status: 'resolved', sourceEntryIds: [] }],
    [null, { label: '取餐', status: 'unknown', sourceEntryIds: [2122] }],
  ]) assert.deepEqual(mergeWorkingDetails(details, drafts as any, [completed], now), details)
  const newer = [{ ...details[0], createdAt: now.toISOString() }]
  assert.deepEqual(mergeWorkingDetails(newer, [{ label: '取餐', status: 'resolved', sourceEntryIds: [2117] }], [planned], now), newer)
})

test('active scratchpad updates remain compatible and do not silently erase expiry', () => {
  const result = mergeWorkingDetails(details, [{ label: '文件', value: '还缺签名', sourceEntryIds: [2122] }], [completed], now)
  assert.equal(result[1].expiresAt, details[1].expiresAt)
  assert.equal(result[1].value, '还缺签名')
  assert.deepEqual(mergeWorkingDetails(details, [], [], new Date('2026-09-03T10:00:00Z')), [details[0]])
})

test('compaction persistence removes resolved details and requests a continuity refresh', async () => {
  const updates: any[] = []
  const service = Object.create(InterludeService.prototype) as any
  service.cachedMemoryConfig = { sceneHookCharacters: 120, sceneSummaryCharacters: 500 }
  service.getStory = async () => ({ ...story, state: { ...story.state, workingDetails: details } })
  service.dbSet = async (table: string, query: unknown, changes: unknown) => updates.push({ table, query, changes })
  service.activeArc = async () => null
  await service.persistCompaction(story, { id: 1, hook: '', summary: '' }, { workingDetails: [{ label: '取餐', status: 'resolved', sourceEntryIds: [2122] }] }, [completed], now)
  const storyUpdate = updates.find(item => item.table === 'interlude_story')
  assert.ok(storyUpdate)
  assert.equal(storyUpdate.changes.state.workingDetails.length, 1)
  assert.equal(storyUpdate.changes.state.workingDetails[0].label, '文件')
  assert.equal(storyUpdate.changes.state.continuityDirty, true)
})

test('automatic director uses the same private and background history boundaries as narration', async () => {
  const service = Object.create(InterludeService.prototype) as any
  Object.defineProperties(service, {
    memoryConfig: { value: { enabled: false } },
    schedulePreplanConfig: { value: { enabled: false } },
    sharedStoryConfig: { value: { shareParticipantDetails: false } },
  })
  service.activeScene = async () => null
  service.recentEntriesForPrompt = async () => [sent, planned, entry(2120, 'group-message', '群聊'), { ...entry(2121, 'user-message', '其他私聊'), participantId: 'p2' }, { ...planned, id: 2122, participantId: '' }]
  service.reportOperation = () => undefined
  const calls: TimelinePlanRequest[] = []
  service.compactor = { planTimeline: async (request: TimelinePlanRequest) => { calls.push(request); return { beats: [{ at: 1, kind: 'state', summary: '仍在办公室' }] } } }
  await service.planAutomaticTimeline(story, { id: 'p1' }, 'intent-due', previous, now, [due])
  assert.deepEqual(calls[0].recentEntries.map(item => item.id), [2115, 2117, 2122])
  await service.planAutomaticTimeline(story, null, 'advance', previous, now, [])
  assert.deepEqual(calls[1].recentEntries.map(item => item.id), [2122])
})
