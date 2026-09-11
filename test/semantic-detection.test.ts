import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUserReportedTimes, temporalEvidence } from '../src/temporal-evidence'
import { NarrativeReviewRequest, narrativeReviewRepairPrompt, normalizeNarrativeReview, toNarrativeReviewPayload } from '../src/narrative-consistency'
import { rankNarrativeHistory } from '../src/service'
import { OpenAICompatibleNarrator, toPromptPayload } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, ScriptEntry } from '../src/types'

const now = new Date('2026-09-07T01:27:00Z'), from = new Date('2026-09-07T01:02:00Z')
function queuedReviewer(responses: unknown[]) {
  const calls: any[] = []
  const model: any = { providers: [{ enabled: true, endpoint: 'https://example.invalid/chat', model: 'synthetic', useForCompaction: true }] }
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, body: any) => {
    calls.push(body)
    assert.ok(responses.length, 'Unexpected additional model call')
    const response = responses.shift()
    if (response instanceof Error) throw response
    return { choices: [{ message: { content: typeof response === 'string' ? response : JSON.stringify(response) } }] }
  } } } as any, model, true)
  return { narrator, calls }
}

test('review retries a transient HTTP failure once and keeps diagnostics host-only', async () => {
  const r = request(), failures: unknown[] = []
  r.onFailure = detail => failures.push(detail)
  assert.equal('onFailure' in toNarrativeReviewPayload(r), false)
  const { narrator, calls } = queuedReviewer([Object.assign(new Error('private response'), { response: { status: 429 } }), assessment()])
  assert.equal((await narrator.reviewNarrative(r))?.verdict, 'pass')
  assert.equal(calls.length, 2)
  assert.deepEqual(failures, [])
})

test('review does not retry forbidden responses and returns only safe diagnostics', async () => {
  const r = request(), failures: unknown[] = []
  r.onFailure = detail => failures.push(detail)
  const { narrator, calls } = queuedReviewer([Object.assign(new Error('private credentials'), { response: { status: 403 } })])
  assert.equal(await narrator.reviewNarrative(r), undefined)
  assert.equal(calls.length, 1)
  assert.deepEqual(failures, [{ stage: 'review', reason: 'http-403' }])
})

test('time extraction gets one structure repair without exposing candidate context', async () => {
  const source = '下轮钟声之后。', r = request(source)
  const malformed = { reportedTimes: [{ statement: source, relation: 'ambiguous', localTime: null }] }
  const valid = { reportedTimes: [{ statement: source, relation: 'ambiguous' }] }
  const { narrator, calls } = queuedReviewer([assessment('consistent', valid.reportedTimes), malformed, valid])
  assert.deepEqual((await narrator.reviewNarrative(r))?.reportedTimes, valid.reportedTimes)
  assert.equal(calls.length, 3)
  assert.equal(JSON.parse(calls[2].messages[1].content).candidate, undefined)
  assert.match(calls[2].messages.at(-1).content, /reported-times-invalid/)
})

test('repeated invalid extraction remains blocked with the exact failure stage', async () => {
  const source = '下轮钟声之后。', r = request(source), failures: unknown[] = []
  r.onFailure = detail => failures.push(detail)
  const malformed = { reportedTimes: [{ statement: 'invented source', relation: 'ambiguous' }] }
  const { narrator, calls } = queuedReviewer([assessment('consistent', [{ statement: source, relation: 'ambiguous' }]), malformed, malformed])
  assert.equal(await narrator.reviewNarrative(r), undefined)
  assert.equal(calls.length, 3)
  assert.deepEqual(failures, [{ stage: 'reported-times-repair', reason: 'reported-times-invalid' }])
})

test('transport retry budget is shared across review and extraction', async () => {
  const source = '下轮钟声之后。', r = request(source), failures: unknown[] = []
  r.onFailure = detail => failures.push(detail)
  const transient = Object.assign(new Error('private response'), { status: 503 })
  const { narrator, calls } = queuedReviewer([transient, assessment('consistent', [{ statement: source, relation: 'ambiguous' }]), transient])
  assert.equal(await narrator.reviewNarrative(r), undefined)
  assert.equal(calls.length, 3)
  assert.deepEqual(failures, [{ stage: 'reported-times', reason: 'http-503' }])
})

test('unrecoverable JSON and empty responses retain their repair diagnostics', async () => {
  for (const [response, reason] of [['{broken', 'invalid-json'], ['', 'empty-response']]) {
    const r = request(), failures: unknown[] = []
    r.onFailure = detail => failures.push(detail)
    const { narrator, calls } = queuedReviewer([response, response])
    assert.equal(await narrator.reviewNarrative(r), undefined)
    assert.equal(calls.length, 2)
    assert.deepEqual(failures, [{ stage: 'review-repair', reason }])
  }
})
const zone = 'Asia/Shanghai'
function request(message = ''): NarrativeReviewRequest {
  return { requireSemanticChecks: true, context: {
    story: { id: 'synthetic', platform: 'test', selfId: 'test', userId: '', channelId: '', status: 'active',
      setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: from, createdAt: from, updatedAt: from },
    phase: 'user-message', from, now, userMessage: message, participant: null, participants: [],
    shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], memories: [], recentEntries: [],
  }, candidate: { script: '测试员继续当前工作。' }, allowedDeliveries: [], alreadyDelivered: [] }
}
function assessment(status = 'consistent', times: unknown[] = []) {
  return { verdict: 'pass', issues: [], reportedTimes: times, checks: [
    { kind: 'time', status, evidenceRefs: ['interval', 'current-event'], summary: 'Temporal interpretation supported by source and local interval.' },
    { kind: 'progression', status: 'consistent', evidenceRefs: ['current-state'], summary: 'No grounded replay in supplied state.' },
  ] }
}

test('any language or notation reaches generation and review without lexical filtering', () => {
  for (const source of ['午休结束前交付，不是昨天那份。', 'Quarter past eight tomorrow, not today.', '下轮钟声响起之后再来。', '我6.30开始吃，刚吃完。', '价格6.30元，版本6.30。']) {
    const r = request(source)
    assert.equal(temporalEvidence(source, now, zone).statement, source)
    const generated = toPromptPayload(r.context) as any
    assert.equal(generated.currentEvent.temporalEvidence.statement, source)
    const event = toNarrativeReviewPayload(r).evidence.find(item => item.ref === 'current-event')!.value as any
    assert.equal(event.temporalEvidence.statement, source)
    assert.equal(event.temporalEvidence.interpretation, 'unresolved')
  }
})

test('validated semantic extraction handles arbitrary wording and derives date relation', () => {
  const examples = [
    ['昨天18:30已经结束。', '2026-09-06 18:30', 'past'],
    ['Quarter past eight tomorrow.', '2026-09-08 08:15', 'future'],
    ['下周三再来。', '2026-09-16 09:00', 'future'],
  ]
  for (const [statement, localTime, relation] of examples) {
    const result = normalizeUserReportedTimes([{ statement, localTime, relation: 'current' }], statement, now, zone)!
    assert.equal(result[0].relation, relation)
  }
  const crossing = normalizeUserReportedTimes([{ statement: '昨天23:50', localTime: '2026-12-31 23:50', relation: 'past' }], '昨天23:50', new Date('2027-01-01T00:10:00+08:00'), zone)!
  assert.equal(crossing[0].relation, 'past')
})

test('unclear time stays uncertain and invalid or invented evidence is rejected', () => {
  const statement = '那一轮结束以后吧。'
  const value = [{ statement, relation: 'ambiguous' }]
  assert.deepEqual(normalizeUserReportedTimes(value, statement, now, zone), value)
  for (const bad of [
    [{ statement: 'not in source', relation: 'ambiguous' }],
    [{ statement, relation: 'past', localTime: '2026-02-30 09:00' }],
    [{ statement, relation: 'ambiguous', localTime: '2026-09-07 09:00' }],
    [{ statement, relation: 'ambiguous', alternatives: ['2026-09-07 25:00'] }],
  ]) assert.equal(normalizeUserReportedTimes(bad, statement, now, zone), undefined)
  assert.deepEqual(normalizeUserReportedTimes([], '价格6.30元', now, zone), [])
})

test('live audit cannot pass without both grounded semantic checks', () => {
  const r = request()
  assert.equal(normalizeNarrativeReview({ verdict: 'pass', issues: [] }, r), undefined)
  assert.equal(normalizeNarrativeReview(assessment(), r)?.verdict, 'pass')
  assert.equal(normalizeNarrativeReview(assessment('uncertain'), r)?.checks?.[0].status, 'uncertain')
  const bad = assessment(); bad.checks[0].evidenceRefs = ['history:999']
  assert.equal(normalizeNarrativeReview(bad, r), undefined)
  assert.equal(normalizeNarrativeReview(assessment('conflict'), r), undefined)
})

test('contextual contradiction requires matching issue with an exact candidate quote', () => {
  const r = request(); r.candidate.script = '他现在要求上午九点之前请交付结果。'
  const result: any = assessment('conflict'); result.verdict = 'reject'
  result.issues = [{ target: 'script', kind: 'time', candidateExcerpt: r.candidate.script,
    evidenceRefs: ['interval'], reason: 'The new deadline precedes the interval.', repair: 'Use a supported future deadline.' }]
  assert.equal(normalizeNarrativeReview(result, r)?.verdict, 'reject')
  result.issues[0].candidateExcerpt = 'a fabricated excerpt'
  assert.equal(normalizeNarrativeReview(result, r), undefined)
})

test('retrieval never classifies progress or excludes old or differently worded events', () => {
  const entries: ScriptEntry[] = [
    { id: 1, storyId: 's', participantId: '', kind: 'script', actor: 'narrator', content: '申请被驳回。', occurredAt: new Date('2020-01-01'), createdAt: from, metadata: {} },
    { id: 2, storyId: 's', participantId: '', kind: 'script', actor: 'narrator', content: '他没有离开。', occurredAt: now, createdAt: now, metadata: {} },
  ]
  const ranked = rankNarrativeHistory('船长批准了新航线。', entries)
  assert.deepEqual(ranked.map(item => item.previousId).sort(), [1, 2])
  assert.ok(ranked.every(item => Object.keys(item).sort().join(',') === 'previousId,similarity'))
})

test('real review adapter validates extracted times and requests schema recovery for missing checks', async () => {
  const source = '过了午夜的那一刻。', r = request(source), calls: any[] = []
  const valid = assessment('consistent', [{ statement: source, relation: 'past', localTime: '2026-09-07 00:00' }])
  const model: any = { providers: [{ enabled: true, endpoint: 'https://example.invalid/chat', model: 'synthetic', useForMain: true, useForCompaction: true }], consistencyReview: true }
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: JSON.stringify(calls.length === 1 ? { verdict: 'pass', issues: [] } : valid) } }] }
  } } } as any, model, true)
  const result = await narrator.reviewNarrative(r)
  assert.equal(calls.length, 3)
  assert.equal(result?.reportedTimes?.[0].localTime, '2026-09-07 00:00')
  assert.match(calls[1].messages.at(-1).content, /semantic-checks-missing/)
})

test('time verification uses original input and can remove invented receive-time precision', async () => {
  const source = '我们终于成功了！', r = request(source), calls: any[] = []
  const hallucinated = assessment('consistent', [{ statement: source, relation: 'current', localTime: '2026-09-07 09:27' }])
  const model: any = { providers: [{ enabled: true, endpoint: 'https://example.invalid/chat', model: 'synthetic', useForCompaction: true }] }
  const narrator = new OpenAICompatibleNarrator({ http: { post: async (_url: string, body: any) => {
    calls.push(body)
    return { choices: [{ message: { content: JSON.stringify(calls.length === 1 ? hallucinated : { reportedTimes: [] }) } }] }
  } } } as any, model, true)
  const review = await narrator.reviewNarrative(r)
  assert.deepEqual(review?.reportedTimes, [])
  assert.equal(calls.length, 2)
  const verificationInput = JSON.parse(calls[1].messages[1].content)
  assert.equal(verificationInput.userMessage, source)
  assert.equal(verificationInput.candidate, undefined)
  assert.equal(verificationInput.reportedTimes, undefined)
})

test('reference catalog and repair use the exact per-request evidence set', () => {
  const r = request()
  const payload = toNarrativeReviewPayload(r)
  assert.deepEqual(payload.allowedEvidenceRefs, payload.evidence.map(item => item.ref))
  assert.ok(narrativeReviewRepairPrompt('semantic-progression-evidence-ref-invalid', r).includes(JSON.stringify(payload.allowedEvidenceRefs)))
  const invalid = assessment()
  invalid.checks[1].evidenceRefs = ['history:999']
  assert.equal(normalizeNarrativeReview(invalid, r), undefined)
})

test('emotional expression is reviewed as structured context, with exact candidate attribution', () => {
  const r = request('我没有生气，很感谢你的帮助。')
  r.candidate.nativeFace = { semantic: 'angry', willingness: 1 }
  const payload = toNarrativeReviewPayload(r)
  assert.equal(payload.candidate.nativeFace?.semantic, 'angry')
  const result: any = assessment()
  result.verdict = 'reject'
  // Emotion need not contradict the independent time/progression checks.
  result.issues = [{ target: 'expression', kind: 'state-conflict', candidateExcerpt: 'angry', evidenceRefs: ['current-event'], reason: 'Expression contradicts the intended gratitude.', repair: 'Omit the contradictory expression.' }]
  assert.equal(normalizeNarrativeReview(result, r)?.verdict, 'reject')
  result.issues[0].candidateExcerpt = 'sad'
  assert.equal(normalizeNarrativeReview(result, r), undefined)
})
