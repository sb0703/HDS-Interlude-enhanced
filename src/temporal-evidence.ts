import { UserReportedTime } from './types'
import { storyLocalTimeContext } from './time'

/** Complete source and receive-time anchor, without language-specific guesses. */
export function temporalEvidence(content: string, now: Date, timezone: string) {
  return { statement: content, receivedAt: now.toISOString(),
    receivedAtLocal: storyLocalTimeContext(now, timezone), interpretation: 'unresolved' as const }
}

/** Validate semantic extraction, never infer meaning from words or clock forms. */
export function normalizeUserReportedTimes(value: unknown, source: string, now: Date, timezone: string): UserReportedTime[] | undefined {
  if (!Array.isArray(value) || value.length > 32) return undefined
  const current = storyLocalTimeContext(now, timezone).local.slice(0, 16)
  const result: UserReportedTime[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || typeof raw.statement !== 'string'
      || !raw.statement.trim() || !source.includes(raw.statement)) return undefined
    if (!['past', 'current', 'future', 'ambiguous'].includes(raw.relation)) return undefined
    if (raw.relation === 'ambiguous') {
      if (raw.localTime !== undefined) return undefined
      if (raw.alternatives !== undefined && (!Array.isArray(raw.alternatives) || raw.alternatives.length > 8
        || !raw.alternatives.every(validLocalTimestamp))) return undefined
      result.push({ statement: raw.statement, relation: 'ambiguous', ...(raw.alternatives ? { alternatives: raw.alternatives } : {}) })
    } else {
      if (!validLocalTimestamp(raw.localTime) || raw.alternatives !== undefined) return undefined
      result.push({ statement: raw.statement, localTime: raw.localTime,
        relation: raw.localTime < current ? 'past' : raw.localTime > current ? 'future' : 'current' })
    }
  }
  return result
}

function validLocalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return false
  const date = new Date(value.replace(' ', 'T') + ':00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16).replace('T', ' ') === value
}
