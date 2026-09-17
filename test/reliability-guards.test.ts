import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService, isNonRetryableNarrativeRefusal } from '../src/service'
import {
  emptyStorySetting, emptyStoryState, InterludeScene, InterludeStory, ScriptEntry,
} from '../src/types'

const now = new Date('2026-09-04T04:00:00.000Z')
const story: InterludeStory = {
  id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active',
  setting: { ...emptyStorySetting(), timezone: 'Asia/Shanghai' }, state: emptyStoryState(),
  cursorAt: now, createdAt: now, updatedAt: now,
}
const scene: InterludeScene = {
  id: 9, storyId: story.id, status: 'active', startedAt: new Date(now.getTime() - 60_000), endedAt: null,
  hook: '', summary: '', entryCount: 2, lastEntryId: 10, createdAt: now, updatedAt: now,
}
const entry = (id: number, content = `条目${id}`): ScriptEntry => ({
  id, storyId: story.id, participantId: '', kind: 'script', actor: 'narrator', content,
  metadata: {}, occurredAt: now, createdAt: now,
})

test('definite upstream refusals stop narrative retries while transient failures remain retryable', () => {
  assert.equal(isNonRetryableNarrativeRefusal(new Error('Narrative consistency review unavailable (review/http-403); refusing to commit.')), true)
  assert.equal(isNonRetryableNarrativeRefusal(new Error('Timeline director upstream refusal (http-403).')), true)
  assert.equal(isNonRetryableNarrativeRefusal(new Error('All narrative providers failed. relay (attempt 1): Forbidden')), true)
  assert.equal(isNonRetryableNarrativeRefusal(new Error('Narrative provider returned an empty response.')), false)
  assert.equal(isNonRetryableNarrativeRefusal(new Error('Narrative consistency guard rejected the candidate; no script commit.')), false)
})

function compactionHarness(entries: ScriptEntry[]) {
  const service = Object.create(InterludeService.prototype) as any
  service.compactionBackoff = new Map()
  Object.defineProperties(service, {
    memoryConfig: { value: {
      enabled: true, overlayCompressionEnabled: false, compactionEntryLimit: 20,
      compactionCharacterLimit: 20_000, sceneEntryThreshold: 1, sceneCharacterThreshold: 1,
      maxFactsPerStory: 20,
    } },
    sharedStoryConfig: { value: { shareParticipantDetails: true } },
  })
  service.ensureContinuity = async () => undefined
  service.compactOverlayUnlocked = async () => false
  service.activeScene = async () => scene
  service.dbGet = async (table: string) => table === 'interlude_script_entry' ? entries : []
  service.getStory = async () => story
  service.participants = async () => []
  service.facts = async () => []
  service.activeArc = async () => null
  service.reportOperation = () => undefined
  return service
}

test('compaction fingerprint cools only the same scene range and manual force bypasses it', async () => {
  const service = compactionHarness([entry(11), entry(12)])
  const fingerprint = service.compactionFingerprint(scene, [entry(11), entry(12)], 8)
  service.compactionBackoff.set(story.id, { fingerprint, until: now.getTime() + 2 * 60 * 60_000 })
  assert.equal((await service.prepareCompaction(story, now, false))?.phase, 'skip')
  assert.equal((await service.prepareCompaction(story, now, true))?.phase, 'run')

  const withNewEntry = compactionHarness([entry(11), entry(12), entry(13)])
  withNewEntry.compactionBackoff.set(story.id, { fingerprint, until: now.getTime() + 2 * 60 * 60_000 })
  assert.equal((await withNewEntry.prepareCompaction(story, now, false))?.phase, 'run')
})

test('compaction checkpoint succeeds only after the expected entry or scene closure', async () => {
  const service = Object.create(InterludeService.prototype) as any
  const context = { scene, sceneEntries: [entry(11), entry(12)] }
  service.dbGet = async () => [{ ...scene, lastEntryId: 11 }]
  assert.equal(await service.compactionCheckpointAdvanced(context), false)
  service.dbGet = async () => [{ ...scene, lastEntryId: 12 }]
  assert.equal(await service.compactionCheckpointAdvanced(context), true)
  service.dbGet = async () => [{ ...scene, status: 'closed', lastEntryId: 0 }]
  assert.equal(await service.compactionCheckpointAdvanced(context), true)
})

test('manual compaction persists completed schedule review even when scene compression fails', async () => {
  const service = Object.create(InterludeService.prototype) as any
  let persisted = 0
  service.schedulePreplanBackoff = new Map()
  service.compactionBackoff = new Map()
  service.prepareSchedulePreplanReview = async () => ({ needsModel: true, request: { localDate: '2026-09-04' } })
  service.prepareCompaction = async () => ({ phase: 'run', fingerprint: 'fp', sceneEntries: [entry(12)], chars: 4, sceneCompactionDue: true, compactRequest: {}, current: story, scene })
  service.requestSchedulePreplan = async () => ({ outcome: 'keep' })
  service.persistSchedulePreplanReview = async () => { persisted++; return true }
  service.compactor = { compact: async () => { throw new Error('compression unavailable') } }
  service.noteCompactionFailure = () => undefined
  service.report = () => undefined
  service.reportOperation = () => undefined
  assert.equal(await service.compactUnlocked(story, now, true), false)
  assert.equal(persisted, 1)
})

test('content-policy compaction cooldown applies across changing entry fingerprints', () => {
  const service = Object.create(InterludeService.prototype) as any
  service.compactionBackoff = new Map()
  service.reportStandaloneOperation = () => undefined
  service.noteCompactionFailure('story', 'first', new Error('Compaction request blocked by provider content policy (PROHIBITED_CONTENT).'))
  assert.equal(service.compactionIsBackedOff('story', 'later'), true)
})
