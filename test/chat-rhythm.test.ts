import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatRhythmPrompt, extractRhythmSignature, resolveChatRhythmConfig, updateChatRhythm,
} from '../src/chat-rhythm'
import { ChatRhythmState } from '../src/types'

test('ChatRhythm defaults are balanced and signatures retain shape without message text', () => {
  assert.deepEqual(resolveChatRhythmConfig(), {
    enabled: true, mode: 'balanced', historyLimit: 12, collapseMinSamples: 5,
    interventionLimit: 6, cooldownSamples: 4,
  })
  const signature = extractRhythmSignature('好<SEP >晚点再说？')
  assert.deepEqual(signature, {
    bubbles: 2, shape: ['s', 's'], tail: 'question', totalChars: 6,
  })
  assert.equal('content' in signature, false)
})

test('Balanced mode detects structure, length inertia and repeated ending rhythm', () => {
  const config = resolveChatRhythmConfig()
  let state: ChatRhythmState | undefined
  for (let index = 0; index < 5; index++) {
    state = updateChatRhythm(state, extractRhythmSignature('今天先到这<sep/>晚点再聊。'), config, `2026-09-04T00:0${index}:00.000Z`)
  }
  assert.equal(state?.collapsed?.reason, 'same-structure')
  assert.equal(state?.collapsed?.streak, 1)

  const varied = [
    '简短一句。',
    '这一次内容稍微长一点，但仍然落在接近的字数范围。',
    '换一种说法，结尾还是普通陈述。',
    '内容不同，句子长度也继续有变化。',
    '最后一条仍然用平常的陈述收尾。',
  ]
  let variedState: ChatRhythmState | undefined
  for (const [index, content] of varied.entries()) {
    variedState = updateChatRhythm(variedState, extractRhythmSignature(content), config, `2026-09-04T01:0${index}:00.000Z`)
  }
  assert.ok(['tail-repeat', 'length-box', 'same-structure'].includes(variedState?.collapsed?.reason ?? ''))
})

test('ChatRhythm prompt has three bounded levels and no gender or fixed-scene template', () => {
  const promptFor = (streak: number) => chatRhythmPrompt({
    recent: [], collapsed: { templateKey: '1x[m]+statement', reason: 'same-structure', streak },
    interventionCount: 1, updatedAt: '2026-09-04T00:00:00.000Z',
  }, '角色甲')!
  const levels = [promptFor(1), promptFor(3), promptFor(5)]
  assert.match(levels[0].drift, /自然决定/)
  assert.match(levels[1].drift, /明显避开/)
  assert.match(levels[2].drift, /不再沿用/)
  const combined = JSON.stringify(levels)
  assert.doesNotMatch(combined, /\b(?:he|she)\b|他|她|办公室|学校|恋爱|一条长消息|三段消息/i)
})

test('ChatRhythm stops intervening after six detections and observes four complete replies', () => {
  const config = resolveChatRhythmConfig()
  let state: ChatRhythmState | undefined
  let minute = 0
  while ((state?.cooldownRemaining ?? 0) === 0 && minute < 20) {
    state = updateChatRhythm(state, extractRhythmSignature('固定节奏。'), config, `2026-09-04T02:${String(minute).padStart(2, '0')}:00.000Z`)
    minute++
  }
  assert.equal(state?.cooldownRemaining, 4)
  assert.equal(chatRhythmPrompt(state, '角色甲'), undefined)
  for (const expected of [3, 2, 1, 0]) {
    state = updateChatRhythm(state, extractRhythmSignature(`观察回复${expected}。`), config, `2026-09-04T03:0${expected}:00.000Z`)
    assert.equal(state?.cooldownRemaining ?? 0, expected)
  }
})
