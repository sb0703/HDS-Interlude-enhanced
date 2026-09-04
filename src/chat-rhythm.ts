import {
  ChatRhythmConfig, ChatRhythmMode, ChatRhythmPrompt, ChatRhythmState,
  RhythmSignature,
} from './types'
import { normalizeMessageSeparators } from './visible-message'

const DEFAULT_CONFIG: ChatRhythmConfig = {
  enabled: true,
  mode: 'balanced',
  historyLimit: 12,
  collapseMinSamples: 5,
  interventionLimit: 6,
  cooldownSamples: 4,
}

export function resolveChatRhythmConfig(value?: Partial<ChatRhythmConfig>): ChatRhythmConfig {
  const mode: ChatRhythmMode = value?.mode === 'gentle' || value?.mode === 'aggressive' ? value.mode : 'balanced'
  const minimum = mode === 'gentle' ? 6 : mode === 'aggressive' ? 4 : 5
  return {
    enabled: value?.enabled !== false,
    mode,
    historyLimit: clampInteger(value?.historyLimit, 5, 20, DEFAULT_CONFIG.historyLimit),
    collapseMinSamples: clampInteger(value?.collapseMinSamples, 3, 10, minimum),
    interventionLimit: clampInteger(value?.interventionLimit, 3, 12, DEFAULT_CONFIG.interventionLimit),
    cooldownSamples: clampInteger(value?.cooldownSamples, 1, 12, DEFAULT_CONFIG.cooldownSamples),
  }
}

export function rhythmShape(length: number): RhythmSignature['shape'][number] {
  if (length < 8) return 's'
  if (length <= 20) return 'm'
  if (length <= 50) return 'l'
  return 'xl'
}

export function rhythmTail(text: string): RhythmSignature['tail'] {
  const value = text.trim()
  if (value.length < 3) return 'word'
  if (/[？?]$/.test(value)) return 'question'
  if (/[！!]$/.test(value)) return 'emphatic'
  return 'statement'
}

export function extractRhythmSignature(content: string, separator = '<sep/>'): RhythmSignature {
  const normalized = normalizeMessageSeparators(content, separator)
  const segments = normalized.split(separator.trim() || '<sep/>').map(item => item.trim()).filter(Boolean)
  const safe = segments.length ? segments : ['']
  return {
    bubbles: Math.max(1, Math.min(4, safe.length)),
    shape: safe.slice(0, 4).map(item => rhythmShape(item.length)),
    tail: rhythmTail(safe.at(-1) ?? ''),
    totalChars: safe.reduce((sum, item) => sum + item.length, 0),
  }
}

export function updateChatRhythm(previous: ChatRhythmState | undefined, signature: RhythmSignature, configValue?: Partial<ChatRhythmConfig>, updatedAt = new Date().toISOString()): ChatRhythmState {
  const config = resolveChatRhythmConfig(configValue)
  const old = previous ?? { recent: [], updatedAt }
  const recent = [signature, ...old.recent].slice(0, config.historyLimit)
  if (!config.enabled) return { recent, updatedAt }

  const cooling = Math.max(0, Math.floor(old.cooldownRemaining ?? 0))
  if (cooling > 0) {
    return {
      recent,
      cooldownRemaining: cooling - 1 || undefined,
      interventionCount: 0,
      updatedAt,
    }
  }

  const reason = collapseReason(recent, config.mode, config.collapseMinSamples)
  if (!reason) return { recent, interventionCount: 0, updatedAt }
  const key = templateKey(signature)
  const continued = old.collapsed && (old.collapsed.templateKey === key || old.collapsed.reason === reason)
  const streak = continued ? old.collapsed!.streak + 1 : 1
  const interventionCount = Math.max(0, old.interventionCount ?? 0) + 1
  if (interventionCount >= config.interventionLimit) {
    return {
      recent: [signature],
      cooldownRemaining: config.cooldownSamples,
      interventionCount: 0,
      updatedAt,
    }
  }
  return {
    recent,
    collapsed: { templateKey: key, reason, streak },
    interventionCount,
    updatedAt,
  }
}

export function chatRhythmPrompt(state: ChatRhythmState | undefined, characterName: string): ChatRhythmPrompt | undefined {
  if (!state?.collapsed || (state.cooldownRemaining ?? 0) > 0) return undefined
  const name = characterName.trim() || '主角'
  const reason = state.collapsed.reason
  const stateText = reason === 'tail-repeat'
    ? `${name}最近连续几次可见回复的收尾语气太接近。`
    : reason === 'length-box'
      ? `${name}最近连续几次可见回复的总长度落在过于接近的范围。`
      : `${name}最近连续几次可见回复的气泡数量和长短组合太接近。`
  const level = state.collapsed.streak >= 5 ? 3 : state.collapsed.streak >= 3 ? 2 : 1
  const drift = level === 1
    ? '下一次有可见回复时，让段数、长短和收尾由眼前内容自然决定，不要顺手套用刚才的结构。'
    : level === 2
      ? '下一次有可见回复时，明显避开最近重复的表达节奏，但不要为了变化强行拆段、拉长或缩短。'
      : '下一次有可见回复时，不再沿用最近的气泡数、长度组合或收尾方式；只按当前要表达的信息组织文字。'
  return { state: stateText, drift }
}

export function normalizeChatRhythmState(value: unknown, configValue?: Partial<ChatRhythmConfig>): ChatRhythmState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const config = resolveChatRhythmConfig(configValue)
  const record = value as Record<string, unknown>
  const recent = Array.isArray(record.recent)
    ? record.recent.map(normalizeSignature).filter((item): item is RhythmSignature => !!item).slice(0, config.historyLimit)
    : []
  if (!recent.length && typeof record.updatedAt !== 'string') return undefined
  const collapsedRecord = record.collapsed && typeof record.collapsed === 'object' && !Array.isArray(record.collapsed)
    ? record.collapsed as Record<string, unknown> : undefined
  const reason = collapsedRecord?.reason
  const collapsed = (reason === 'same-structure' || reason === 'tail-repeat' || reason === 'length-box')
    && typeof collapsedRecord?.templateKey === 'string'
    ? { templateKey: collapsedRecord.templateKey, reason: reason as 'same-structure' | 'tail-repeat' | 'length-box', streak: clampInteger(collapsedRecord.streak, 1, 1000, 1) }
    : undefined
  return {
    recent,
    collapsed,
    interventionCount: clampInteger(record.interventionCount, 0, config.interventionLimit, 0) || undefined,
    cooldownRemaining: clampInteger(record.cooldownRemaining, 0, config.cooldownSamples, 0) || undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  }
}

function collapseReason(recent: RhythmSignature[], mode: ChatRhythmMode, minSamples: number): 'same-structure' | 'tail-repeat' | 'length-box' | undefined {
  if (recent.length < minSamples) return undefined
  const latest = recent[0]
  const strict = recent.slice(0, 3).every(item => sameSignature(item, latest))
  const lengthInertia = recent.slice(0, 4).every(item => item.bubbles === latest.bubbles && item.shape.join(',') === latest.shape.join(','))
  if (mode === 'gentle') return strict || lengthInertia ? 'same-structure' : undefined
  const tailRepeat = recent.slice(0, 3).filter(item => item.tail === latest.tail && Math.abs(item.totalChars - latest.totalChars) < 4).length >= 2
  const totals = recent.slice(0, 5).map(item => item.totalChars)
  const lengthBox = Math.max(...totals) - Math.min(...totals) <= 6
  if (strict || lengthInertia) return 'same-structure'
  if (tailRepeat) return 'tail-repeat'
  if (lengthBox) return 'length-box'
  return undefined
}

function sameSignature(left: RhythmSignature, right: RhythmSignature) {
  return left.bubbles === right.bubbles && left.tail === right.tail && left.shape.join(',') === right.shape.join(',')
}

function templateKey(signature: RhythmSignature) {
  return `${signature.bubbles}x[${signature.shape.join(',')}]+${signature.tail}`
}

function normalizeSignature(value: unknown): RhythmSignature | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const shape = Array.isArray(record.shape)
    ? record.shape.filter((item): item is RhythmSignature['shape'][number] => item === 's' || item === 'm' || item === 'l' || item === 'xl').slice(0, 4)
    : []
  const tail = record.tail
  if (!shape.length || (tail !== 'question' && tail !== 'emphatic' && tail !== 'statement' && tail !== 'word')) return undefined
  return {
    bubbles: clampInteger(record.bubbles, 1, 4, 1),
    shape,
    tail,
    totalChars: clampInteger(record.totalChars, 0, 100_000, 0),
  }
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(minimum, Math.min(maximum, numeric))
}
