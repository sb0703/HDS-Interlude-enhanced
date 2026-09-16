import type { NarrativeDecision } from '../types'

export interface AuthoredAction { id: string; start: number; end: number; content: string }
const resolvedActions = new WeakSet<AuthoredAction[]>()
const deliveredActions = new WeakSet<AuthoredAction[]>()
const recoverySources = new WeakMap<NarrativeDecision, NarrativeDecision>()

/** Host-owned source before markup removal or invalid-reference cleanup. */
export function authoredActionRecoveryDraft(decision: NarrativeDecision): NarrativeDecision {
  return recoverySources.get(decision) ?? decision
}

/** Syntax only: unwrap authored speech, never infer an action from prose.
 * Duplicate ids are not executable references. The original words survive. */
export function readAuthoredActions(script: string) {
  const actions: AuthoredAction[] = []
  let prose = '', cursor = 0
  for (const match of script.matchAll(/<say\s+id\s*=\s*(["'])([\w-]{1,64})\1\s*>([\s\S]*?)<\/say\s*>/gi)) {
    prose += script.slice(cursor, match.index)
    const start = prose.length
    prose += match[3]
    actions.push({ id: match[2], start, end: prose.length, content: match[3] })
    cursor = match.index! + match[0].length
  }
  prose += script.slice(cursor)
  return { prose, actions: actions.filter(action => actions.filter(other => other.id === action.id).length === 1) }
}

/** Resolve the same authored words before any transport normalization. Legacy
 * content remains compatible; a broken explicit reference cannot send another
 * independently authored answer. Delayed drafts retain their existing path. */
export function resolveAuthoredActions(decision: NarrativeDecision, alreadySent = false, separator = '<sep/>'): NarrativeDecision {
  if (typeof decision?.script !== 'string') return decision
  const parsed = readAuthoredActions(decision.script)
  const leading = parsed.prose.length - parsed.prose.trimStart().length
  const prose = parsed.prose.trim()
  const inherited = Array.isArray(decision.authoredActions) && resolvedActions.has(decision.authoredActions) ? decision.authoredActions : []
  alreadySent ||= deliveredActions.has(inherited)
  const actions = (parsed.actions.length ? parsed.actions : inherited).map(action => ({
    ...action, start: action.start - leading, end: action.end - leading,
  })).filter(action => action.start >= 0 && action.end <= prose.length && prose.slice(action.start, action.end) === action.content)
  const privateReply = decision.interaction?.reply
  const onePrivateRecipient = (!decision.groupReply || decision.groupReply.mode === 'none') && !decision.crossConversationActions?.length
  if (!alreadySent && onePrivateRecipient && actions.length === 1 && privateReply?.mode === 'immediate'
    && privateReply.actionId === actions[0].id) {
    const tail = completeLegacyBubbleBlock(prose, actions[0].content, separator)
    if (tail && actions[0].start === prose.length - tail.length) {
      actions[0] = { ...actions[0], content: tail, end: prose.length }
    }
  }
  const resolve = <T extends { mode: string; content?: string; actionId?: string }>(reply: T): T => {
    if (!reply || typeof reply !== 'object') return reply
    if (alreadySent) return { ...reply, actionId: undefined }
    if (!reply.actionId || reply.mode !== 'immediate') return reply
    const action = actions.find(item => item.id === reply.actionId
      && prose.slice(item.start, item.end) === item.content && item.content.trim())
    // Preserve the requested action and its broken reference for recovery.
    // Silence is a valid author choice; a failed reference is not silence.
    return action ? { ...reply, content: action.content } : { ...reply, content: undefined }
  }
  // 引用失配的保守兜底：整份剧本只有一个已授权 say 行动、本回合只有一个私聊
  // 接收者、且回复没有可用 content 时，该行动就是这条回复的本体——模型常照抄
  // 协议示例里的 id 字面量导致引用对不上。零行动、重复 id、伪造继承与已提前
  // 流式发送的情况都不适用，失配引用保留为待修复状态。
  const soleActionReply = (reply: NonNullable<typeof privateReply>) => {
    if (alreadySent || !onePrivateRecipient || reply.mode !== 'immediate' || reply.content || actions.length !== 1) return reply
    const only = actions[0]
    if (!only.content.trim() || prose.slice(only.start, only.end) !== only.content) return reply
    return { ...reply, actionId: only.id, content: only.content }
  }
  // Recover a legacy mirror's missing bubbles only from its explicit terminal
  // transport block, never ordinary narration or another recipient's action.
  const legacyTail = !alreadySent && onePrivateRecipient && !actions.length
    && privateReply?.mode === 'immediate' && !privateReply.actionId && privateReply.content
    ? completeLegacyBubbleBlock(prose, privateReply.content, separator) : undefined
  resolvedActions.add(actions)
  if (alreadySent) deliveredActions.add(actions)
  const resolved: NarrativeDecision = {
    ...decision, script: prose, authoredActions: actions,
    ...(decision.interaction ? { interaction: { ...decision.interaction, reply: resolve(legacyTail
      ? { ...decision.interaction.reply, content: legacyTail } : soleActionReply(decision.interaction.reply)) } } : {}),
    ...(decision.groupReply ? { groupReply: resolve(decision.groupReply) } : {}),
    ...(Array.isArray(decision.crossConversationActions) ? { crossConversationActions: decision.crossConversationActions.map(resolve) } : {}),
  }
  recoverySources.set(resolved, authoredActionRecoveryDraft(decision))
  return resolved
}

export function hasUnresolvedAuthoredActions(decision: NarrativeDecision): boolean {
  const replies = [decision.interaction?.reply, decision.groupReply, ...(decision.crossConversationActions ?? [])]
  return replies.some(reply => reply?.mode === 'immediate' && !!reply.actionId
    && (typeof reply.content !== 'string' || !reply.content.trim()))
}

/** Resolve an explicit multi-bubble mirror only when every authored span
 * matches the original mirror in order. No prose is promoted to a message. */
export function recoverExplicitAuthoredMirror(decision: NarrativeDecision, separator = '<sep/>'): NarrativeDecision | undefined {
  if (!hasUnresolvedAuthoredActions(decision) || !separator) return undefined
  const source = authoredActionRecoveryDraft(decision)
  const reply = source.interaction?.reply
  if (reply?.mode !== 'immediate' || !reply.actionId || typeof reply.content !== 'string'
    || source.groupReply?.mode === 'immediate' || source.crossConversationActions?.length) return undefined
  const parsed = readAuthoredActions(source.script ?? '')
  if (parsed.actions.length < 2 || parsed.actions.some(action => !action.content.trim())) return undefined
  if (parsed.actions.map(action => action.content).join(separator) !== reply.content) return undefined
  return resolveAuthoredActions({ ...source, interaction: { ...source.interaction!, reply: { ...reply, actionId: undefined } } }, false, separator)
}

export function completeLegacyBubbleBlock(prose: string, content: string, separator: string) {
  if (!separator || !content.trim()) return undefined
  const tail = prose.trim().split(/\r?\n\s*\r?\n|\\n\\n/).at(-1)?.trim() ?? ''
  if (!tail.startsWith(content.trim() + separator) || tail.length > 4_000) return undefined
  const parts = tail.split(separator)
  if (parts.length < 2 || parts.some(part => !part.trim() || /[\r\n<>]|\\n/.test(part))) return undefined
  return tail
}
