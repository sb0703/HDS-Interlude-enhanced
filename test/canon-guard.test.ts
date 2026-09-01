import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from 'koishi'
import { OpenAICompatibleNarrator, type ModelConfig } from '../src/narrator'
import { emptyStorySetting, emptyStoryState, type NarrativeRequest } from '../src/types'

test('Canon guard rejects an unpublished conflict and reviews the rewritten draft', async () => {
  const requests: Array<Record<string, unknown>> = []
  const responses = [
    { script: '周一十一点二十，他已经下班回家。', interaction: { seen: true, reply: { mode: 'immediate', content: '下班了' } } },
    { compliant: false, conflicts: ['工作日应在18:30下班，11:20下班没有既存例外原因'] },
    { script: '周一十一点二十，他仍在办公室完成上午工作。', interaction: { seen: true, reply: { mode: 'immediate', content: '还在上班' } } },
    { compliant: true, conflicts: [] },
  ]
  const ctx = {
    http: {
      post: async (_endpoint: string, body: Record<string, unknown>) => {
        requests.push(body)
        const content = responses.shift()
        if (!content) throw new Error('Unexpected extra model request.')
        return { choices: [{ message: { content: JSON.stringify(content) } }] }
      },
    },
  } as unknown as Context
  const config: ModelConfig = {
    providers: [{
      id: 'main', label: 'main', enabled: true, endpoint: 'https://example.com/chat', apiKey: '', model: 'test-model',
      temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 60_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForMain: true,
    }],
    failover: { enabled: false, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
    fixedPrompt: '', stylePrompt: '',
    canonGuard: { enabled: true, maxRewriteAttempts: 1, maxTokens: 768, timeout: 30_000 },
  }
  const now = new Date('2026-08-31T03:20:00.000Z')
  const setting = emptyStorySetting()
  setting.character = { name: '沈既明', profile: '典型工作日：09:00至12:00工作，12:00午饭，13:00至18:00工作，18:30正常下班。' }
  setting.timezone = 'Asia/Shanghai'
  const request: NarrativeRequest = {
    phase: 'user-message',
    story: { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active', setting, state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now },
    from: now, now, userMessage: '你下班了吗？', participant: null, participants: [], shareParticipantDetails: false,
    dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [], facts: [], overlaySnapshots: [], webContext: [],
  }

  const decision = await new OpenAICompatibleNarrator(ctx, config, true).decide(request)

  assert.equal(decision.script, '周一十一点二十，他仍在办公室完成上午工作。')
  assert.equal(requests.length, 4)
  const rewrittenMessages = requests[2].messages as Array<{ role: string, content: string }>
  assert.match(rewrittenMessages[0].content, /CANON RECOVERY/)
  assert.match(rewrittenMessages[0].content, /18:30/)
})

test('Canon guard throws before publication when the rewrite still conflicts', async () => {
  const responses = [
    { script: '十一点二十已经下班。' },
    { compliant: false, conflicts: ['违反18:30下班日程'] },
  ]
  const ctx = { http: { post: async () => ({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }) } } as unknown as Context
  const config: ModelConfig = {
    providers: [{ id: 'main', label: 'main', enabled: true, endpoint: 'https://example.com/chat', apiKey: '', model: 'test-model', temperature: 0.8, topP: 1, maxTokens: 4096, timeout: 60_000, responseFormat: 'json-object', extraHeaders: '', extraBody: '', useForMain: true }],
    failover: { enabled: false, strategy: 'priority', maxAttemptsPerProvider: 1, cooldownMinutes: 5 },
    fixedPrompt: '', stylePrompt: '', canonGuard: { enabled: true, maxRewriteAttempts: 0, maxTokens: 768, timeout: 30_000 },
  }
  const now = new Date('2026-08-31T03:20:00.000Z')
  const setting = emptyStorySetting()
  setting.character.profile = '工作日18:30下班。'
  const request: NarrativeRequest = {
    phase: 'advance', story: { id: 'story', platform: 'onebot', selfId: 'bot', userId: '', channelId: '', status: 'active', setting, state: emptyStoryState(), cursorAt: now, createdAt: now, updatedAt: now },
    from: now, now, participant: null, participants: [], shareParticipantDetails: false, dueIntents: [], activeConsequences: [], supersededIntents: [], recentEntries: [], memories: [], facts: [],
  }

  await assert.rejects(new OpenAICompatibleNarrator(ctx, config, true).decide(request), /Canon guard rejected/)
})
