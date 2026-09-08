import assert from 'node:assert/strict'
import test from 'node:test'
import { InterludeService } from '../src/service'
import { TIMELINE_TABLES, normalizeTimelineBoundary, timelineBoundaryQuery } from '../src/timeline-boundary'
import { emptyStorySetting, emptyStoryState } from '../src/types'

const boundary = { at: '2026-09-08T02:00:00Z', cutoffs: Object.fromEntries(TIMELINE_TABLES.map(table => [table, 10])) }

test('recovery query retains original filters and uses IDs instead of event clocks', () => {
  const original = { storyId: 's', id: { $in: [4, 11] }, status: 'pending' }
  assert.deepEqual(timelineBoundaryQuery('interlude_intent', original, boundary), { $and: [original, { id: { $gt: 10 } }] })
  assert.equal(timelineBoundaryQuery('interlude_intent', original), original)
  assert.deepEqual(normalizeTimelineBoundary(JSON.parse(JSON.stringify(boundary))), boundary)
  assert.equal(normalizeTimelineBoundary({ at: boundary.at, cutoffs: {} }), undefined)
})

test('reloaded service excludes archived rows before SQL limit but keeps administrative history', async () => {
  const service: any = Object.create(InterludeService.prototype)
  service.config = { runtime: { contextEntryLimit: 1 } }
  const entries = [{ id: 1, occurredAt: new Date('2099-01-01') }, { id: 11, occurredAt: new Date('2020-01-01') }]
  service.dbGet = async (table: string, query: any, options: any) => {
    if (table === 'interlude_story') return [{ state: JSON.parse(JSON.stringify({ timelineBoundary: boundary })) }]
    assert.equal(table, 'interlude_script_entry')
    const scoped = query.$and ? entries.filter(row => row.id > query.$and[1].id.$gt) : entries
    return scoped.slice(0, options.limit)
  }
  assert.deepEqual((await service.recentTimelineEntries('s', 1)).map((row: any) => row.id), [11])
  assert.deepEqual((await service.recentEntries('s', 1)).map((row: any) => row.id), [1])
})

test('memory and schedule results started before recovery cannot write into the new timeline', async () => {
  const service: any = Object.create(InterludeService.prototype)
  const before: any = { id: 's', state: emptyStoryState(), setting: { character: { profile: '' }, timezone: 'UTC' } }
  service.getStory = async () => ({ ...before, state: { ...before.state, timelineBoundary: boundary } })
  service.persistCompaction = async () => { assert.fail('obsolete memory must not write') }
  await assert.rejects(service.applyCompaction(before, { current: before, sceneCompactionDue: true }, {}, new Date(), 0), /rebased/)
  service.getSchedulePreplan = async () => undefined
  service.reportOperation = () => {}
  assert.equal(await service.persistSchedulePreplanReview(before, {}, {}, new Date()), false)
})

test('rebase persists an archive boundary and starts fresh scenes without deleting source rows', async () => {
  const service: any = Object.create(InterludeService.prototype)
  const oldDate = new Date('2026-09-07T00:00:00Z')
  const tables: Record<string, any[]> = Object.fromEntries(TIMELINE_TABLES.map(table => [table, [{ id: 1, storyId: 's', status: 'active', occurredAt: new Date('2099-01-01'), updatedAt: oldDate }]]))
  tables.interlude_story = [{ id: 's', setting: emptyStorySetting(), state: emptyStoryState(), cursorAt: oldDate }]
  const matches = (row: any, query: any): boolean => Object.entries(query).every(([key, value]: [string, any]) =>
    key === '$and' ? value.every((part: any) => matches(row, part)) : value && typeof value === 'object' && '$gt' in value ? row[key] > value.$gt : row[key] === value)
  service.dbGet = async (table: string, query: any, options: any = {}) => {
    const rows = (tables[table] ?? []).filter(row => matches(row, query))
    for (const [key, order] of Object.entries(options.sort ?? {})) rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (order === 'desc' ? -1 : 1))
    return structuredClone(rows.slice(0, options.limit ?? rows.length))
  }
  service.dbSet = async (table: string, query: any, patch: any) => { for (const row of tables[table] ?? []) if (matches(row, query)) Object.assign(row, structuredClone(patch)) }
  service.dbCreate = async (table: string, draft: any) => {
    const row = { ...draft, id: Math.max(0, ...tables[table].map(item => item.id)) + 1 }
    tables[table].push(row)
    return row
  }
  service.getStory = async () => structuredClone(tables.interlude_story[0])
  service.serial = async (_id: string, work: any) => work()
  service.invalidateBufferedNarratives = () => {}
  service.historyVectors = new Map([['s', new Map([[1, {}]])]])
  service.historyVectorsReady = new Set(['s'])
  service.compactionBackoff = new Map()
  service.participants = async () => []
  service.getSchedulePreplan = async () => undefined
  service.appendEntry = async (_id: string, draft: any) => service.dbCreate('interlude_script_entry', { ...draft, storyId: 's' })
  await service.rebaseTimeline(await service.getStory())
  const reloaded = await service.getStory()
  assert.ok(normalizeTimelineBoundary(reloaded.state.timelineBoundary))
  assert.equal((await service.activeScene('s')).id, 2)
  assert.equal((await service.activeArc('s')).id, 2)
  assert.deepEqual(await service.dbGetTimeline('interlude_fact', { storyId: 's' }), [])
  assert.deepEqual(await service.dbGetTimeline('interlude_intent', { storyId: 's' }), [])
  assert.equal(tables.interlude_script_entry[0].occurredAt.getUTCFullYear(), 2099)
  assert.equal(tables.interlude_fact.length, 1)
  assert.equal(service.historyVectors.has('s'), false)
})
