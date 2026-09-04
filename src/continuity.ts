import { ScriptEntry, TimelineBeat, WorkingDetail, WorkingDetailDraft } from './types'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Built only from the caller's privacy-filtered history. A stored window is
 * evidence of past narration, not a fresh trigger or proof of message delivery. */
export function recentContinuityContext(entries: ScriptEntry[], now: Date) {
  const history = entries.filter(entry => entry.occurredAt <= now)
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id)
  const windows = history.filter(entry => entry.kind === 'script' && record(entry.metadata?.timelinePlan)).slice(-3)
  const narratedBeats = windows.flatMap(entry => {
    const plan = entry.metadata.timelinePlan as Record<string, unknown>
    if (!Array.isArray(plan.beats)) return []
    return plan.beats.filter((beat): beat is TimelineBeat => record(beat)
      && ['state', 'activity', 'thought'].includes(String(beat.kind))
      && typeof beat.at === 'number' && Number.isFinite(beat.at) && beat.at >= 0 && beat.at <= 1
      && typeof beat.summary === 'string' && !!beat.summary.trim())
      .sort((left, right) => left.at - right.at).slice(0, 4)
      .map(beat => ({ entryId: entry.id, participantId: entry.participantId, windowEndedAt: entry.occurredAt.toISOString(), kind: beat.kind, summary: beat.summary.trim().slice(0, 180) }))
  })
  const lastBeat = narratedBeats.at(-1)
  const latestScript = history.filter(entry => entry.kind === 'script').at(-1)
  return {
    // A later live script without a ledger may have changed the scene again.
    lastNarratedBeat: lastBeat?.entryId === latestScript?.id ? lastBeat ?? null : null,
    alreadyNarrated: narratedBeats.filter(beat => beat.kind !== 'state').slice(-8),
    // Never infer sent messages from interaction.reply or a draft in prose.
    deliveredMessages: history.filter(entry => ['user-message', 'character-message', 'group-message', 'character-group-message'].includes(entry.kind))
      .slice(-4).map(entry => ({ entryId: entry.id, participantId: entry.participantId, kind: entry.kind,
        direction: entry.kind === 'user-message' || entry.kind === 'group-message' ? 'received' : 'sent',
        occurredAt: entry.occurredAt.toISOString(), content: entry.content.slice(0, 240) })),
  }
}

/** Explicit resolution removes a scratchpad item; omission still preserves it.
 * Evidence must come from this compaction batch, never a fabricated entry id. */
export function mergeWorkingDetails(existing: WorkingDetail[], drafts: WorkingDetailDraft[], entries: ScriptEntry[], now: Date): WorkingDetail[] {
  const byLabel = new Map(existing.map(item => [item.label, item]))
  const evidence = new Map(entries.filter(entry => entry.occurredAt <= now).map(entry => [entry.id, entry]))
  for (const draft of drafts) {
    if (!record(draft) || typeof draft.label !== 'string') continue
    const label = draft.label.slice(0, 80).trim()
    const sourceEntryIds = Array.isArray(draft.sourceEntryIds)
      ? [...new Set(draft.sourceEntryIds.filter(id => Number.isSafeInteger(id) && evidence.has(id)))].slice(0, 8) : []
    if (!label || !sourceEntryIds.length) continue
    const current = byLabel.get(label)
    // Background compression must not replace a newer scratchpad observation.
    if (current && sourceEntryIds.every(id => evidence.get(id)!.occurredAt.getTime() < new Date(current.createdAt).getTime())) continue
    if (draft.status === 'resolved') {
      byLabel.delete(label)
      continue
    }
    if (draft.status !== undefined && draft.status !== 'active') continue
    const value = typeof draft.value === 'string' ? draft.value.slice(0, 300).trim() : ''
    if (!value) continue
    const expiresAt = typeof draft.expiresAt === 'string' && Number.isFinite(Date.parse(draft.expiresAt))
      ? draft.expiresAt : current?.expiresAt
    byLabel.set(label, { label, value, ...(expiresAt ? { expiresAt } : {}), createdAt: now.toISOString(), sourceEntryIds })
  }
  return [...byLabel.values()].filter(item => !item.expiresAt || new Date(item.expiresAt) > now).slice(-10)
}
