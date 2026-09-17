import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService, storyBelongsToConfiguredBot } from '../src/service'
import { decodeStoryState, encodeStoryState } from '../src/story-state'
import { storyStateForPrompt } from '../src/narrator'
import { emptyStoryState } from '../src/types'
import { TIMELINE_TABLES } from '../src/timeline-boundary'

const proto = InterludeService.prototype as any
const boundary = { at: '2026-09-14T00:00:00Z', cutoffs: Object.fromEntries(TIMELINE_TABLES.map(table => [table, 10])) }

test('configured bot ownership applies even when the user allowlist gate is off', async () => {
  for (const enabled of [false, undefined]) {
    const config: any = { onebot: { enabled, botAccounts: [{ qq: '2' }] } }
    const own = { id: 'character:onebot:2', platform: 'onebot', selfId: '2' }
    const other = { id: 'character:onebot:1', platform: 'onebot', selfId: '1' }
    assert.equal(storyBelongsToConfiguredBot(own, config.onebot), true)
    assert.equal(storyBelongsToConfiguredBot(other, config.onebot), false)
    const host: any = { config, canHandleStory: proto.canHandleStory,
      dbGet: async () => [other, own], dbSet: async () => assert.fail('another bot must not be archived') }
    assert.equal((await proto.getCanonicalStory.call(host)).id, own.id)
    assert.equal(proto.canHandleSession.call(host, { ...other, userId: 'user' }), false)
    assert.equal(proto.canHandleParticipant.call(host, { ...other, userId: 'user' }), false)
    assert.equal(proto.canHandleSession.call(host, { ...own, userId: 'user' }), true)
  }
})

test('V2 canonical and paused selection never archive or adopt another bot story', async () => {
  const rows = [{ id: 'character:other', selfId: 'other' }, { id: 'character:mine', selfId: 'mine' }]
  const host = { dbGet: async () => rows, canHandleStory: (story: any) => story.selfId === 'mine',
    dbSet: async () => assert.fail('another bot must not be archived') }
  assert.equal((await proto.getCanonicalStory.call(host, 'character:other')).id, 'character:mine')
  assert.equal((await proto.getPausedStory.call(host, 'character:other')).id, 'character:mine')
})

test('V2 codec preserves recovery boundaries and retries while prompt excludes host controls', () => {
  for (const legacy of [{ timelineBoundary: boundary }, { extensions: { timelineBoundary: boundary } }]) {
    const state = decodeStoryState(encodeStoryState(decodeStoryState({ ...emptyStoryState(), ...legacy,
      scheduleProfileFingerprint: 'profile-v1', automation: { timelineDirectorFailures: 6, timelineRetryAt: boundary.at },
      futureState: { retained: true },
    })))
    assert.deepEqual(state.timelineBoundary, boundary)
    assert.equal(state.scheduleProfileFingerprint, 'profile-v1')
    assert.equal(state.automation.timelineDirectorFailures, 6)
    assert.deepEqual(state.extensions?.futureState, { retained: true })
    const prompt = JSON.stringify(storyStateForPrompt({ ...state, extensions: { ...state.extensions, historyBackfill: { cursor: 10 }, urge: {} } }))
    assert.doesNotMatch(prompt, /timelineBoundary|timelineRetryAt|timelineDirectorFailures|historyBackfill|profile-v1|"urge"/)
    assert.match(prompt, /futureState/)
  }
})

test('V2 embedding completing after rebase cannot write archived vectors or cursor', async () => {
  let state = emptyStoryState()
  let release!: (value: number[]) => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const host = { config: { model: { embedding: { enabled: true, semanticHistory: true, backfillBatchSize: 1 } } },
    historyBackfills: new Set(), historyBackoff: new Map(), historyVectors: new Map(),
    embedder: { identity: () => 'synthetic' }, getStory: async () => ({ id: 's', state }),
    dbGetTimeline: async () => [{ id: 1, kind: 'script', content: '历史原文', metadata: {} }],
    embedText: () => { started(); return new Promise<number[]>(resolve => { release = resolve }) },
    serial: async (_id: string, run: () => any) => run(), dbSet: async () => assert.fail('stale task wrote after rebase'),
  }
  const pending = proto.backfillHistoryEmbeddings.call(host, 's')
  await entered
  state = { ...emptyStoryState(), timelineBoundary: boundary }
  release([1, 0])
  await pending
  assert.equal(host.historyBackfills.size, 0)
})

test('V2 failed obsolete cache load cannot invalidate the new timeline cache', async () => {
  let rejectOld!: (reason: Error) => void
  let reads = 0
  const host = { historyVectors: new Map(), historyVectorsReady: new Set(), historyVectorLoads: new Map(), automaticRecallCache: new Map(),
    dbGetTimeline: () => ++reads === 1 ? new Promise((_resolve, reject) => { rejectOld = reject }) : Promise.resolve([]),
    reportStandaloneOperation: () => {},
  }
  const old = proto.ensureHistoryVectors.call(host, 's')
  proto.invalidateHistoryVectors.call(host, 's')
  await proto.ensureHistoryVectors.call(host, 's')
  rejectOld(new Error('old query failed'))
  await old
  assert.equal(host.historyVectorsReady.has('s'), true)
  assert.equal(host.historyVectors.get('s').size, 0)
})
