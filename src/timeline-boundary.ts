/** Immutable row high-water marks. Wall clocks cannot hide older future-dated rows. */
export const TIMELINE_TABLES = ['interlude_script_entry', 'interlude_memory', 'interlude_fact', 'interlude_intent',
  'interlude_state_patch', 'interlude_overlay_snapshot', 'interlude_web_observation', 'interlude_scene', 'interlude_arc'] as const

export interface TimelineBoundary { at: string; cutoffs: Record<string, number> }

export function normalizeTimelineBoundary(value: unknown): TimelineBoundary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as TimelineBoundary
  if (typeof item.at !== 'string' || !Number.isFinite(Date.parse(item.at)) || !item.cutoffs) return undefined
  if (!TIMELINE_TABLES.every(table => Number.isSafeInteger(item.cutoffs[table]) && item.cutoffs[table] >= 0)) return undefined
  return { at: item.at, cutoffs: Object.fromEntries(TIMELINE_TABLES.map(table => [table, item.cutoffs[table]])) }
}

export function timelineBoundaryQuery(table: string, query: unknown, boundary?: TimelineBoundary) {
  const cutoff = boundary?.cutoffs[table]
  return cutoff === undefined ? query : { $and: [query, { id: { $gt: cutoff } }] }
}
