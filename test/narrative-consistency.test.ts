import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../src/index'
import { OpenAICompatibleNarrator, resolveModelRouting, createCompactor, toPromptPayload, toTimelinePlanPayload } from '../src/narrator'
import { bindDueDelayedReplyExecution, groupDueIntents, InterludeService } from '../src/service'
import { authoredActionRecoveryDraft, resolveAuthoredActions, hasUnresolvedAuthoredActions } from '../src/script/authored-actions'
import { NarrativeReviewRequest, isFreshNarrativeStart, narrativeReviewInvalidReason, narrativeReviewPrompt, narrativeReviewRepairPrompt, normalizeNarrativeReview, reviewNeedsReplan, toNarrativeReviewPayload } from '../src/narrative-consistency'
import { narrativeDurationAnchors } from '../src/narrative-duration'
import { emptyStorySetting, emptyStoryState, InterludeStory, NarrativeDecision, NarrativeRequest, TimelinePlan } from '../src/types'

const now = new Date('2026-09-03T09:09:20Z')
const from = new Date('2026-09-03T08:49:20Z')
const pass = { verdict: 'pass', issues: [] }
const friend = { id: 'friend', displayName: '朋友', profile: '', relationship: '', state: {} }
const provider = { label: 'Audit', enabled: true, endpoint: 'https://example.test/chat', model: 'audit-model', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 1000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForMain: true, useForCompaction: true }
const model: any = { providers: [provider], consistencyReview: true, compaction: { responseFormat: 'json-object' }, failover: { enabled: true, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 } }
const story: InterludeStory = { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active', setting: { ...emptyStorySetting(), character: { name: '测试人物甲', profile: '医院管理者，工作安排可以因实际事务调整。' } }, state: emptyStoryState(), cursorAt: from, createdAt: from, updatedAt: from }
const plan: TimelinePlan = { beats: [{ at: 1, kind: 'state', summary: '会议仍在进行，未查看手机' }] }
const context: NarrativeRequest = { story, phase: 'advance', from, now, participant: null, participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [], timelinePlan: plan }
const candidate = { script: '他宣布散会，回到办公室，拿起手机发过去：“会开完了。”' }
const request: NarrativeReviewRequest = { context, candidate, allowedDeliveries: [], alreadyDelivered: [] }
const reject = (excerpt: string, target = 'script', kind = 'state-conflict', ref = 'candidate-plan') => ({ verdict: 'reject', issues: [{ target, kind, candidateExcerpt: excerpt, evidenceRefs: [ref], reason: '与本轮已知事实冲突', repair: '保留已成立状态，只修改矛盾部分。' }] })

test('review schema accepts grounded rejection but never treats malformed output as pass', () => {
  assert.equal(normalizeNarrativeReview(pass, request)?.verdict, 'pass')
  assert.equal(normalizeNarrativeReview(reject('他宣布散会'), request)?.verdict, 'reject')
  for (const value of [undefined, {}, { verdict: 'pass' }, { verdict: 'reject', issues: [] }, { ...pass, issues: [{}] }, reject('不存在的文本'), reject('他宣布散会', 'script', 'state-conflict', 'history:99999')]) {
    assert.equal(normalizeNarrativeReview(value, request), undefined)
  }
})

test('review validation exposes content-free failure reasons and a grounded repair contract', () => {
  assert.equal(narrativeReviewInvalidReason(reject('不存在的文本'), request), 'issue-0-excerpt-not-exact')
  assert.equal(narrativeReviewInvalidReason(reject('他宣布散会', 'script', 'state-conflict', 'history:99999'), request), 'issue-0-evidence-ref')
  const prompt = narrativeReviewRepairPrompt('issue-0-excerpt-not-exact')
  assert.match(prompt, /byte-for-byte contiguous substring/)
  assert.match(prompt, /exactly equal one supplied evidence\[\]\.ref/)
  assert.doesNotMatch(prompt, /测试人物甲|测试人物乙|医院|办公室/)
})

test('review checks recipient and allowed transport without extracting messages for sending', () => {
  const payload = toNarrativeReviewPayload(request)
  const transport = payload.evidence.find(item => item.ref === 'transport')!.value as any
  assert.deepEqual(transport.allowedDeliveries, [])
  assert.equal(payload.candidate.script, candidate.script)
  assert.match(narrativeReviewPrompt(), /recipient and meaning/)
  assert.match(narrativeReviewPrompt(), /Never send, extract or invent a message/)
  assert.equal(normalizeNarrativeReview(reject('发过去：“会开完了。”', 'delivery', 'delivery', 'transport'), request)?.verdict, 'reject')
})

test('review interval makes Shanghai local time authoritative over the UTC transport clock', () => {
  const payload = toNarrativeReviewPayload(request)
  const interval = payload.evidence.find(item => item.ref === 'interval')!.value as any
  assert.equal(interval.now, '2026-09-03T09:09:20.000Z')
  assert.equal(interval.storyTimezone, 'Asia/Shanghai')
  assert.equal(interval.fromLocal, '2026-09-03 16:49:20')
  assert.equal(interval.nowLocal, '2026-09-03 17:09:20')
  assert.equal(interval.nowLocalContext.period, 'afternoon')
  const prompt = narrativeReviewPrompt()
  assert.match(prompt, /interval\.nowLocalContext/)
  assert.match(prompt, /trailing Z.*UTC transport notation/i)
  assert.match(prompt, /MUST NOT be interpreted as the story-local wall clock/)
})

test('roles and worlds come from context, including schedules that are not standard office life', () => {
  for (const [name, profile, world] of [
    ['老师', '下午授课，可以课后继续答疑。', '当代校园'],
    ['夜班司机', '夜里工作，白天休息；会多次往返同一车站。', '城际交通'],
    ['自由职业者', '无固定上下班时间，临时决定外出。', '当代城市'],
    ['探险者', '具有瞬间移动能力。', '存在传送术的虚构世界'],
  ]) {
    const changed = { ...story, setting: { ...story.setting, character: { name, profile }, world } }
    const payload = toNarrativeReviewPayload({ ...request, context: { ...context, story: changed } })
    assert.deepEqual((payload.evidence[0].value as any).character, { name, profile })
    const director = toTimelinePlanPayload({ story: changed, participant: null, phase: 'advance', from, now, scene: null, facts: [], recentEntries: [], dueIntents: [] })
    assert.equal(director.canon.world, world)
  }
  const prompt = narrativeReviewPrompt()
  assert.match(prompt, /Same location, same action, same activity category/)
  assert.match(prompt, /Autonomous new events and spontaneous choices ARE allowed/)
  assert.match(prompt, /If evidence is insufficient or ambiguous/)
  assert.doesNotMatch(prompt, /测试人物甲|测试人物乙|医院|办公室|咖啡|开会/)
})

test('plan errors require replan; prose or delivery errors do not force scene changes', () => {
  const review = normalizeNarrativeReview(reject('会议仍在进行', 'plan'), request)!
  assert.equal(reviewNeedsReplan(review, plan), true)
  assert.equal(reviewNeedsReplan(normalizeNarrativeReview(reject('他宣布散会'), request)!, plan), false)
})

test('review input is bounded to supplied history and does not expose transport credentials or callbacks', () => {
  const entry = { id: 4, storyId: 'story', participantId: '', kind: 'script', actor: 'narrator', content: '既有记录', metadata: {}, createdAt: from, occurredAt: from }
  const payload = toNarrativeReviewPayload({ ...request, context: { ...context, onEarlyReply: async () => true,
    recentEntries: [entry, { ...entry, id: 5, occurredAt: new Date(now.getTime() + 1000), content: 'future-only' }] } })
  const serialized = JSON.stringify(payload)
  assert.ok(serialized.includes('history:4'))
  assert.ok(!serialized.includes('future-only'))
  assert.ok(!serialized.includes('onEarlyReply'))
  assert.ok(!serialized.includes(provider.endpoint))
  const history = payload.evidence.find(item => item.ref === 'history:4')!.value as any
  assert.equal(history.occurredAtLocal, '2026-09-03 16:49:20')
})

test('audit reuses compaction route, supports prompt-only and records usage', async () => {
  const calls: any[] = [], usage: any[] = []
  const http = { post: async (_url: string, body: any) => { calls.push(body); return { choices: [{ message: { content: JSON.stringify(pass) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } } } }
  const narrator = new OpenAICompatibleNarrator({ http } as any, { ...model, compaction: { responseFormat: 'prompt-only' } }, true, item => usage.push(item))
  assert.equal((await narrator.reviewNarrative(request))?.verdict, 'pass')
  assert.equal(calls[0].model, 'audit-model')
  assert.equal(calls[0].temperature, 0.1)
  assert.equal(calls[0].response_format, undefined)
  assert.ok(usage.length > 0)
  const failing = new OpenAICompatibleNarrator({ http: { post: async () => { throw new Error('offline') } } } as any, model, true)
  assert.equal(await failing.reviewNarrative(request), undefined)
})

test('audit repairs one malformed grounded response without weakening fail-closed validation', async () => {
  const calls: any[] = []
  const malformed = reject('不存在的文本')
  const http = { post: async (_url: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: JSON.stringify(calls.length === 1 ? malformed : reject('他宣布散会')) } }] }
  } }
  const narrator = new OpenAICompatibleNarrator({ http } as any, model, true)
  assert.equal((await narrator.reviewNarrative(request))?.verdict, 'reject')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].temperature, 0)
  assert.match(calls[1].messages.at(-1).content, /issue-0-excerpt-not-exact/)

  const stillMalformed = new OpenAICompatibleNarrator({ http: { post: async () => ({ choices: [{ message: { content: JSON.stringify(malformed) } }] }) } } as any, model, true)
  assert.equal(await stillMalformed.reviewNarrative(request), undefined)
})

function harness(drafts: NarrativeDecision[], reviews: unknown[], plans: TimelinePlan[] = [plan]) {
  const service = Object.create(InterludeService.prototype) as any
  const logs: string[] = [], generations: any[][] = [], audits: NarrativeReviewRequest[] = [], replans: unknown[] = []
  const friend = { id: 'friend', displayName: '朋友', profile: '', relationship: '', state: {} }
  service.config = { model, runtime: { allowProactiveMessages: true, contextEntryLimit: 24, maxScriptCharacters: 10000, maxMessageCharacters: 2000 }, logging: {} }
  Object.defineProperties(service, { agencyConfig: { value: { enabled: false } }, browserConfig: { value: { enabled: false } }, sharedStoryConfig: { value: { allowCrossConversationMessages: true, maxCrossConversationActions: 2 } } })
  service.modelRouting = resolveModelRouting(model)
  service.participants = async () => [friend]
  service.canHandleParticipant = () => true
  service.mainModelLabel = () => 'test'
  service.reportOperation = (...args: any[]) => logs.push(args.map(String).join(' '))
  service.report = (...args: any[]) => logs.push(args.map(String).join(' '))
  service.planAutomaticTimeline = async (...args: any[]) => { replans.push(args.at(-1)); return plans[Math.min(replans.length - 1, plans.length - 1)] }
  service.decide = async (...args: any[]) => {
    generations.push(args)
    args[22]?.({ ...context, participants: [friend], contextualReview: true, phase: args[2], participant: args[1], dueIntents: args[6], timelinePlan: args[18] })
    return drafts[Math.min(generations.length - 1, drafts.length - 1)]
  }
  service.compactor = { reviewNarrative: async (req: NarrativeReviewRequest) => { audits.push(req); const result: any = reviews[Math.min(audits.length - 1, reviews.length - 1)];
      if (!result?.verdict || !Array.isArray(result.issues)) return result;
      return { ...result, reportedTimes: [], checks: (req.requireDeliveryCheck ? ['time', 'progression', 'delivery'] : ['time', 'progression']).map(kind => ({
        kind, status: result.issues.some((issue: any) => (kind === 'delivery' ? ['delivery'] : kind === 'time' ? ['time'] : ['event-replay', 'state-conflict', 'causality']).includes(issue.kind)) ? 'conflict' : 'consistent',
        evidenceRefs: [kind === 'delivery' ? 'transport' : 'interval'], summary: 'Fixture contextual assessment',
      })) } } }
  service.dbSet = async () => { throw new Error('review must never write') }
  return { service, logs, generations, audits, replans,
    run: (phase = 'advance', participant: unknown = null, dueIntents: any[] = []) => service.tryDecide(story, participant, phase, from, now, undefined, dueIntents) }
}

test('live review uses the host time after generation while automatic review keeps its planned endpoint', async () => {
  const draft: NarrativeDecision = { script: '她发出去：“你好。”', interaction: { seen: true, reply: { mode: 'immediate', content: '你好。' } } }
  const started = new Date()
  const live = harness([draft], [pass])
  const result = await live.run('user-message', friend)
  assert.equal(result.succeeded, true, live.logs.join('\n'))
  assert.ok(live.audits[0].context.now >= started)
  assert.ok(result.effectiveNow >= started)
  const automatic = harness([{ script: '她继续眼前的工作。' }], [pass])
  await automatic.run('advance')
  assert.equal(automatic.audits[0].context.now.getTime(), now.getTime())
})

test('broken authored reference is repaired once before review and persistence', async () => {
  const broken = resolveAuthoredActions({ script: '他写好一条消息。', interaction: { seen: true, reply: { mode: 'immediate', actionId: 'missing', content: '不能猜测发送' } } })
  assert.equal(hasUnresolvedAuthoredActions(broken), true)
  const repaired = resolveAuthoredActions({ script: '他发来<say id="fixed">你好。</say>', interaction: { seen: true, reply: { mode: 'immediate', actionId: 'fixed' } } })
  const h = harness([broken, repaired], [pass])
  const result = await h.run('user-message', friend)
  assert.equal(result.succeeded, true, h.logs.join('\n'))
  assert.equal(h.generations.length, 2)
  assert.equal(h.generations[1][12], true)
  assert.equal(h.generations[1][23], authoredActionRecoveryDraft(broken))
  assert.equal(h.generations[1][23].interaction.reply.content, '不能猜测发送')
  assert.equal(h.audits.length, 1)
  assert.equal(h.audits[0].requireDeliveryCheck, true)
  assert.equal(result.decision.interaction?.reply.content, '你好。')
  const failing = harness([broken], [pass])
  assert.equal((await failing.run('user-message', friend)).succeeded, false)
  assert.equal(failing.generations.length, 2)
  assert.equal(failing.audits.length, 0)
  await assert.rejects(failing.service.persistDecision(story, friend, broken, from, now, true, 'user-message'), /Unresolved authored action/)
})

test('a reset story marks its first turn as source-free; later completed originals end that marker', () => {
  assert.equal(isFreshNarrativeStart(context), true)
  const reviewer = toNarrativeReviewPayload(request)
  const currentEvent = reviewer.evidence.find(item => item.ref === 'current-event')!.value as any
  assert.equal(currentEvent.freshStart, true)
  assert.equal((toPromptPayload(context) as any).authoringWindow.freshStart, true)
  const recorded = { ...context, story: { ...story, state: { ...story.state, narrativeUpdateCount: 1 } } }
  assert.equal(isFreshNarrativeStart(recorded), false)
  assert.equal((toPromptPayload(recorded) as any).authoringWindow.freshStart, false)
  assert.match(narrativeReviewPrompt(), /典型作息只是可能性/)
})

test('narrow script clock audit anchors completed scenes to the host local interval', async () => {
  const script = '他看了眼钟，已经六点四十，到家后又过了两小时。'
  const calls: any[] = []
  const compactor = createCompactor({ http: { post: async (_url: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: JSON.stringify({ verdict: 'reject', excerpt: '已经六点四十，到家后又过了两小时', reason: 'completed later than endpoint' }) } }] }
  } } } as any, model, true)
  const audit = await compactor.auditNarrativeTime!(context, script)
  assert.equal(audit.verdict, 'reject')
  const payload = JSON.parse(calls[0].messages[1].content)
  assert.equal(payload.interval.nowLocal, '2026-09-03 17:09:20')
  assert.equal(payload.interval.elapsedMinutes, 20)
  assert.equal(payload.script, script)
  const ungrounded = createCompactor({ http: { post: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'reject', excerpt: '不存在的句子' }) } }] }) } } as any, model, true)
  assert.equal((await ungrounded.auditNarrativeTime!(context, script)).verdict, 'uncertain')
})

test('host duration boundary rejects a broad and narrow false pass on a meeting interrupted before its start', async () => {
  const start = new Date('2026-09-15T08:15:55Z')
  const end = new Date('2026-09-15T08:17:50Z')
  const prior: any = { id: 10, storyId: story.id, participantId: friend.id, kind: 'script', actor: 'narrator',
    occurredAt: start, createdAt: start, content: '电梯到了五楼，碰头还有几分钟。',
    metadata: { narrativeAuthority: 'original-v2', lifeHandoff: { place: { value: '会议室门口', quote: '电梯到了五楼' },
      activity: { value: '准备参加四点半碰头', quote: '碰头还有几分钟' } } } }
  const script = '他进了会议室。会开得不算长，二十来分钟，把要点定了。散会后回到办公室。'
  assert.equal(narrativeDurationAnchors(script)[0].minimumMinutes, 20)
  const calls: any[] = []
  const compactor = createCompactor({ http: { post: async (_url: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: JSON.stringify({ verdict: 'pass', durationAssessments: [{ anchorId: 1, relation: 'completed' }] }) } }] }
  } } } as any, model, true)
  const audit = await compactor.auditNarrativeTime!({ ...context, from: start, now: end, recentEntries: [prior] }, script)
  assert.equal(audit.verdict, 'reject')
  assert.equal(audit.excerpt, '二十来分钟')
  const payload = JSON.parse(calls[0].messages[1].content)
  assert.equal(payload.interval.elapsedMinutes, 1.9)
  assert.match(payload.previousHandoff.activity.value, /四点半/)
  assert.equal(payload.durationAnchors[0].minimumMinutes, 20)

  const future = '他说二十分钟后再继续开会。'
  const planned = createCompactor({ http: { post: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'pass', durationAssessments: [{ anchorId: 1, relation: 'planned' }] }) } }] }) } } as any, model, true)
  assert.equal((await planned.auditNarrativeTime!({ ...context, from: start, now: end }, future)).verdict, 'pass')
})

test('ambiguous duration blocks only when its completed reading exceeds the host interval', async () => {
  const response = { verdict: 'pass', durationAssessments: [{ anchorId: 1, relation: 'ambiguous' }] }
  const compactor = createCompactor({ http: { post: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) } } as any, model, true)
  const end = new Date('2026-09-15T08:20:00Z')
  const within = await compactor.auditNarrativeTime!({ ...context, from: new Date('2026-09-15T08:00:00Z'), now: end }, '她等了十分钟。')
  assert.equal(within.verdict, 'pass')
  const beyond = await compactor.auditNarrativeTime!({ ...context, from: new Date('2026-09-15T08:15:00Z'), now: end }, '她等了十分钟。')
  assert.equal(beyond.verdict, 'uncertain')
  assert.equal(beyond.reason, 'duration-relation-ambiguous')
})

test('narrative retry arms an exact due-intent wake instead of waiting for the background sweep', async () => {
  const service: any = Object.create(InterludeService.prototype)
  service.config = { runtime: { narrativeRetryDelaySeconds: 10, narrativeRetryMaxAttempts: 6 } }
  service.dbGetTimeline = async () => []
  service.dbSet = async () => undefined
  service.reportStandalone = () => undefined
  let intent: any
  let wake: any
  service.appendIntent = async (storyId: string, draft: any, _now: Date, participantId: string) => { intent = { storyId, participantId, ...draft } }
  service.scheduleDueIntentWake = (storyId: string, notBefore: Date) => { wake = { storyId, notBefore } }
  const at = new Date('2026-09-16T08:29:38.000Z')
  assert.equal(await service.scheduleNarrativeRetry('story', 'participant', at), true)
  assert.equal(intent.notBefore, '2026-09-16T08:29:48.000Z')
  assert.equal(wake.storyId, 'story')
  assert.equal(wake.notBefore.toISOString(), intent.notBefore)
})

test('service restart restores the earliest durable due-intent wake', async () => {
  const service: any = Object.create(InterludeService.prototype)
  const first = { id: 1, storyId: 'story', type: 'narrative-retry', status: 'pending', notBefore: new Date('2026-09-16T08:29:48.000Z'), payload: {} }
  const later = { ...first, id: 2, notBefore: new Date('2026-09-16T08:30:48.000Z') }
  service.getCanonicalStory = async () => ({ id: 'story' })
  service.canHandleStory = () => true
  service.dbGetTimeline = async () => [first, later]
  let wake: any
  service.scheduleDueIntentWake = (storyId: string, notBefore: Date) => { wake = { storyId, notBefore } }
  await service.restoreDueIntentWake()
  assert.equal(wake.storyId, 'story')
  assert.equal(wake.notBefore.toISOString(), first.notBefore.toISOString())
})

test('a broad false pass cannot commit an out-of-window script', async () => {
  const future = { script: '他在午后十二点四十二已经走到晚上六点四十，到家后睡到夜里。' }
  const corrected = { script: '十二点四十二，他仍在处理眼前事务。' }
  const h = harness([future, corrected], [pass, pass])
  let calls = 0
  h.service.compactor.auditNarrativeTime = async (_request: NarrativeRequest, script: string) => {
    calls++
    return script === future.script ? { verdict: 'reject', excerpt: '已经走到晚上六点四十', reason: 'outside host window' } : { verdict: 'pass' }
  }
  const result = await h.run()
  assert.equal(result.succeeded, true, h.logs.join('\n'))
  assert.equal(result.decision.script, corrected.script)
  assert.equal(calls, 2)
  assert.match(h.generations[1][21], /Host interval time audit reject/)

  const failing = harness([future], [pass, pass])
  failing.service.compactor.auditNarrativeTime = async () => ({ verdict: 'reject', excerpt: '已经走到晚上六点四十' })
  assert.equal((await failing.run()).succeeded, false)
  assert.equal(failing.generations.length, 2)
})

test('exact multi-bubble mirror repairs locally without another model request', async () => {
  const raw = resolveAuthoredActions({ script: '他回复<say id="one">你好。</say>，又补充<say id="two">请稍等。</say>。',
    interaction: { seen: true, reply: { mode: 'immediate', actionId: 'missing', content: '你好。<sep/>请稍等。' } } })
  const h = harness([raw], [pass])
  const result = await h.run('user-message', friend)
  assert.equal(result.succeeded, true, h.logs.join('\n'))
  assert.equal(h.generations.length, 1)
  assert.equal(h.audits.length, 1)
  assert.equal(result.decision.interaction?.reply.content, '你好。<sep/>请稍等。')
})

test('prose claims of sending with none transport require semantic rejection and rewrite', async () => {
  const contradiction = { script: '他向当前聊天对象发出了“稍后联系”。', interaction: { seen: true, reply: { mode: 'none' as const } } }
  const corrected = { script: '他暂未回复，继续手头的事情。', interaction: { seen: true, reply: { mode: 'none' as const } } }
  const h = harness([contradiction, corrected], [reject(contradiction.script, 'script', 'delivery', 'transport'), pass])
  const result = await h.run('user-message', friend)
  assert.equal(result.succeeded, true, h.logs.join('\n'))
  assert.equal(h.generations.length, 2)
  assert.deepEqual(h.audits[0].allowedDeliveries, [])
  assert.match(h.generations[1][21], /script\/delivery/)
  assert.equal(result.decision.script, corrected.script)
  assert.equal(result.decision.interaction?.reply.mode, 'none')
})

test('delivery assessment must be explicit, transport-grounded and consistent to pass', () => {
  const req = { ...request, requireSemanticChecks: true, requireDeliveryCheck: true }
  const checks: any[] = ['time', 'progression', 'delivery'].map(kind => ({ kind, status: 'consistent', evidenceRefs: [kind === 'delivery' ? 'transport' : 'interval'], summary: '合成证据核验' }))
  const response = { ...pass, checks, reportedTimes: [] }
  assert.equal(normalizeNarrativeReview(response, req)?.verdict, 'pass')
  assert.equal(normalizeNarrativeReview({ ...response, checks: checks.slice(0, 2) }, req), undefined)
  assert.equal(normalizeNarrativeReview({ ...response, checks: [{ ...checks[0], status: 'uncertain' }, ...checks.slice(1)] }, req), undefined)
  for (const status of ['uncertain', 'conflict']) assert.equal(normalizeNarrativeReview({ ...response, checks: [...checks.slice(0, 2), { ...checks[2], status }] }, req), undefined)
  assert.equal(normalizeNarrativeReview({ ...response, checks: [...checks.slice(0, 2), { ...checks[2], evidenceRefs: ['interval'] }] }, req), undefined)
  assert.equal(toNarrativeReviewPayload(req).requireDeliveryCheck, true)
  assert.match(narrativeReviewPrompt(), /沙盒中的当前参与者也是真实投递对象/)
  assert.match(narrativeReviewPrompt(), /几十分钟的窗口不能完成一夜或一整天/)
  assert.match(narrativeReviewPrompt(), /\"kind\":\"delivery\"/)
  assert.equal(normalizeNarrativeReview({ ...response, checks: checks.slice(0, 2) }, { ...req, memoryAudit: true, requireDeliveryCheck: false })?.verdict, 'pass')
})

test('Zhou regression: contradictory send is rewritten once, never extracted or delivered', async () => {
  const h = harness([candidate, { script: '他继续听取汇报，没有查看手机。' }], [reject('他宣布散会'), pass])
  const result = await h.run()
  assert.equal(result.succeeded, true, h.logs.join("\n"))
  assert.equal(h.generations.length, 2)
  assert.equal(h.audits.length, 2)
  assert.equal(h.replans.length, 1)
  assert.equal(h.audits[0].allowedDeliveries.length, 0)
  assert.match(h.generations[1][21], /需修正片段/)
  assert.equal(result.decision.interaction, undefined)
})

test('Shen regression: a rejected event plan is replanned before rewriting prose', async () => {
  const firstPlan: TimelinePlan = { beats: [{ at: 1, kind: 'activity', summary: '重新开始刚才已结束的讨论' }] }
  const corrected: TimelinePlan = { beats: [{ at: 1, kind: 'activity', summary: '核对各方对纪要的反馈' }] }
  const h = harness([{ script: '他又宣布同一场讨论开始。' }, { script: '他查看反馈，修正纪要中的一处数字。' }], [reject('重新开始刚才已结束的讨论', 'plan', 'event-replay', 'current-state'), pass], [firstPlan, corrected])
  const result = await h.run()
  assert.equal(result.succeeded, true, h.logs.join("\n"))
  assert.equal(h.replans.length, 2)
  assert.equal(h.generations[1][18], corrected)
  assert.equal(result.timelinePlan, corrected)
})

test('six timeline failures use conservative fallback and still pass through unified review', async () => {
  const h = harness([{ script: '他把手边的小事收尾，没有制造新的外部结果。' }], [pass])
  h.service.planAutomaticTimeline = async () => undefined
  h.service.timelineDirectorFailures = () => 6
  const result = await h.run()
  assert.equal(result.succeeded, true, h.logs.join("\n"))
  assert.deepEqual(h.generations[0][19], { mode: 'conservative', failureCount: 6 })
  assert.equal(h.audits.length, 1)
})

test('review failures or repeated contradictions stop without a repetition fallback commit', async () => {
  for (const reviews of [[undefined], [{ verdict: 'pass' }], [reject('他宣布散会'), reject('他宣布散会')]]) {
    const h = harness([candidate], reviews)
    const result = await h.run()
    assert.equal(result.succeeded, false)
    assert.deepEqual(result.decision, {})
    assert.notEqual(result.failureReason, 'repetition', 'legacy fallback must not advance a rejected plan')
    assert.ok(h.generations.length <= 2)
  }
})

test('high text similarity alone cannot reject a contextually valid recurrence', async () => {
  const h = harness([{ script: '司机再次回到始发站，接上下一班乘客。' }], [pass])
  const result = await h.run()
  assert.equal(result.succeeded, true, h.logs.join("\n"))
  assert.equal(h.generations.length, 1)
  assert.equal(h.audits[0].requireSemanticChecks, true)
})

test('audit receives normalized, authorized messages, not arbitrary targets or delayed drafts', async () => {
  const h = harness([{ script: '他把这次的进展告诉朋友。', crossConversationActions: [
    { participantId: 'friend', mode: 'immediate', content: '进展', willingness: 1, reason: '本轮进展' },
    { participantId: 'hidden-stranger', mode: 'immediate', content: '秘密', willingness: 1 },
  ] }], [pass])
  await h.run()
  assert.deepEqual(h.audits[0].allowedDeliveries, [{ target: 'friend', content: '进展', bubbles: ['进展'] }])
  const delayed = harness([{ script: '他决定稍后回复。', interaction: { seen: true, reply: { mode: 'delayed', content: '晚点说', sendAt: '2026-09-03T10:00:00Z' } } }], [pass])
  await delayed.run('intent-due', { id: 'friend', state: {} })
  assert.deepEqual(delayed.audits[0].allowedDeliveries, [])
})

test('due delayed reply keeps its exact host-owned payload through generation and audit', async () => {
  const due: any = { id: 31, storyId: story.id, participantId: friend.id, type: 'delayed-reply', summary: 'queued reply',
    notBefore: now, status: 'pending', payload: { interaction: true, userInitiated: true, content: '第一条<sep/>第二条' }, createdAt: from, updatedAt: from }
  const h = harness([{ script: '他按原计划把已经写好的消息发了出去。', interaction: { seen: false, reply: { mode: 'none' } } }], [pass])
  const result = await h.run('intent-due', friend, [due])
  assert.equal(result.succeeded, true, h.logs.join('\n'))
  assert.deepEqual(result.decision.interaction, { seen: false, reply: { mode: 'immediate', content: '第一条<sep/>第二条' } })
  assert.deepEqual(h.audits[0].allowedDeliveries, [{ target: friend.id, content: '第一条<sep/>第二条', bubbles: ['第一条', '第二条'] }])
  assert.deepEqual(groupDueIntents([due, { ...due, id: 32 }]).map(batch => batch.map(item => item.id)), [[31], [32]])
  assert.deepEqual(bindDueDelayedReplyExecution({}, 'intent-due', friend.id, [{ ...due, payload: { ...due.payload, userInitiated: false } }]),
    { interaction: { seen: false, reply: { mode: 'immediate', content: '第一条<sep/>第二条' } } })
  assert.deepEqual(bindDueDelayedReplyExecution({}, 'advance', friend.id, [due]), {})
})

test('unified review is enabled by default and explicit opt-out makes no audit call', async () => {
  assert.equal((Config.dict.model as any).dict.consistencyReview.meta.default, true)
  const h = harness([{ script: '他继续做自己的事情。' }], [pass])
  h.service.config = { ...h.service.config, model: { ...model, consistencyReview: false } }
  assert.equal((await h.run()).succeeded, true)
  assert.equal(h.audits.length, 0)
})

test('disabling memory compression does not disable an explicitly enabled audit', async () => {
  let calls = 0
  const reviewer = createCompactor({ http: { post: async () => { calls++; return { choices: [{ message: { content: JSON.stringify(pass) } }] } } } } as any,
    { ...model, compaction: { ...model.compaction, enabled: false } }, true)
  assert.equal((await reviewer.reviewNarrative!(request))?.verdict, 'pass')
  assert.equal(calls, 1)
  assert.equal(await reviewer.planTimeline!({ story, participant: null, phase: 'advance', from, now, scene: null, facts: [], recentEntries: [], dueIntents: [] }), undefined)
  assert.equal(calls, 1, 'disabled background tasks must not issue requests')
})

test('reviewed live turns do not send the experimental early bubble before the audit', async () => {
  const h = harness([{ script: '他回复了这条消息。', interaction: { seen: true, reply: { mode: 'immediate', content: '收到' } } }], [pass])
  let delivered = 0
  const result = await h.service.tryDecide(story, { id: 'friend', state: {} }, 'user-message', from, now, '在吗', [], [], undefined, [], [], undefined, [], [], undefined, undefined, async () => { delivered++; return true })
  assert.equal(result.succeeded, true, h.logs.join("\n"))
  assert.equal(delivered, 0)
  assert.equal(h.generations[0][20], undefined)
})
