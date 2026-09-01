import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from 'koishi'
import { Config, inject, RESET_CONFIRMATION_PHRASE, resolveBotScopedTarget, reusable, sharedCommandContext, version } from '../src/index'
import { hasRequiredNarrativeScript, interludeLoggerName, normalizeGroupVisibleReply, resolveBlindModeConfig, storyBelongsToConfiguredBot, visibleReplyMode } from '../src/service'
import { configuredProviders, ZHIPU_FIRST_VISIBLE_TOKEN_TIMEOUT } from '../src/narrator'
import { HDS_INTERLUDE_VERSION } from '../src/meta'

test('Console sections follow the documented setup order', () => {
  assert.deepEqual(Object.keys(Config.dict), [
    'blindMode', 'storyDefaults', 'model', 'onebot', 'runtime', 'schedulePreplan', 'sharedStory', 'chatActions',
    'stickers', 'agency', 'memory', 'alterSystem', 'browser', 'logging',
  ])
})

test('Console reset entry is optional and requires an explicit destructive confirmation phrase', () => {
  assert.ok(inject.optional.includes('console'))
  assert.equal(RESET_CONFIRMATION_PHRASE, '重置全部故事')
})

test('multiple HDSI instances only own their configured OneBot stories', () => {
  const onebot = {
    enabled: true,
    botAccounts: [{ qq: '10001', label: '角色甲', enabled: true }],
    userAccounts: [],
    ignoreSelfMessages: true,
  }
  assert.equal(storyBelongsToConfiguredBot({ platform: 'onebot', selfId: '10001' }, onebot), true)
  assert.equal(storyBelongsToConfiguredBot({ platform: 'onebot', selfId: '10002' }, onebot), false)
  assert.equal(storyBelongsToConfiguredBot({ platform: 'sandbox', selfId: 'bot' }, onebot), false)
})

test('HDSI declares itself reusable for isolated multi-character deployments', () => {
  assert.equal(reusable, true)
})

test('shared command names resolve to the HDSI instance owned by the receiving bot', () => {
  const fallback = { character: 'fallback' }
  const targets = new Map([
    ['90000000001', { character: '沈既明' }],
    ['90000000002', { character: '周旭川' }],
  ])
  assert.equal(resolveBotScopedTarget(targets, '90000000001', fallback).character, '沈既明')
  assert.equal(resolveBotScopedTarget(targets, ' 90000000002 ', fallback).character, '周旭川')
  assert.equal(resolveBotScopedTarget(targets, 'unknown', fallback), fallback)
})

test('reusable HDSI instances register shared commands on the unfiltered root context', () => {
  const root = new Context()
  const botScoped = root.self('90000000002')
  assert.equal(sharedCommandContext(botScoped), root)
})

test('each HDSI instance emits logs under its own bot account category', () => {
  assert.equal(interludeLoggerName({
    onebot: { enabled: true, botAccounts: [{ qq: '90000000002', label: '周', enabled: true }], userAccounts: [] },
    storyDefaults: { characterName: '周旭川' },
  } as any), 'hds-interlude.onebot.90000000002')
  assert.equal(interludeLoggerName({
    onebot: { enabled: true, botAccounts: [], userAccounts: [] },
    storyDefaults: { characterName: '未配置角色' },
  } as any), 'hds-interlude.character.未配置角色')
})

test('chat actions are opt-in and platform-scoped', () => {
  const actions = Config.dict.chatActions.dict
  assert.equal(actions.enabled.meta.default, false)
  assert.deepEqual(actions.platforms.meta.default, ['qq'])
  assert.equal(actions.quoteReply.meta.default, true)
  assert.equal(actions.messageReactions.meta.default, true)
  assert.equal(actions.nativeFaces.meta.default, true)
  assert.equal(actions.expressionThreshold.meta.default, 0.7)
})

test('local sticker library is opt-in and requires an explicitly assigned visual provider', () => {
  const stickers = Config.dict.stickers.dict
  assert.equal(stickers.enabled.meta.default, false)
  assert.equal(stickers.directory.meta.default, 'data/hds-interlude/stickers')
  assert.equal(stickers.catalogLimit.meta.default, 40)
  assert.equal(stickers.descriptionResponseFormat.meta.default, 'json-object')
})

test('Blind Mode is the first Console section and defaults to a minimal ten-minute heartbeat', () => {
  const blindMode = Config.dict.blindMode.dict
  assert.equal(blindMode.enabled.meta.default, false)
  assert.equal(blindMode.healthReportMinutes.meta.default, 10)
  assert.deepEqual(resolveBlindModeConfig(), { enabled: false, healthReportMinutes: 10 })
  assert.deepEqual(resolveBlindModeConfig({ enabled: true, healthReportMinutes: 2 }), { enabled: true, healthReportMinutes: 2 })
})

test('ignored compatibility switches stay out of the active Console', () => {
  assert.equal('enabled' in Config.dict.sharedStory.dict, false)
  assert.equal('pauseAfterConversationMinutes' in Config.dict.runtime.dict, false)
  assert.equal('staleNarrativeRequestWindowSeconds' in Config.dict.runtime.dict, false)
  assert.equal(Config.dict.runtime.dict.userMessageDebounceSeconds.meta.default, 2)
})

test('runtime and plugin exports share one version constant', () => {
  assert.equal(version, HDS_INTERLUDE_VERSION)
  assert.equal(version, '0.1.4')
})

test('layered colored logs are the Console default and remain optional', () => {
  const logging = Config.dict.logging.dict
  assert.equal(logging.format.meta.default, 'layered')
  assert.equal(logging.colors.meta.default, true)
  assert.equal(logging.colorTheme.meta.default, 'dark')
  assert.equal(logging.kaomoji.meta.default, true)
})

test('model Console centralizes connections and task assignment without exposing IDs', () => {
  const model = Config.dict.model.dict
  assert.deepEqual(Object.keys(model).slice(0, 3), ['vision', 'imageGeneration', 'providers'])
  assert.equal(model.imageGeneration.dict.enabled.meta.default, false)
  assert.equal(model.imageGeneration.dict.mode.meta.default, 'openai-images')
  assert.equal(model.imageGeneration.dict.model.meta.default, 'cogview-3-flash')
  assert.equal('mode' in model, false)
  assert.equal('zhipu' in model, false)
  assert.equal('models' in model, false)
  assert.equal('mainModelId' in model, false)
  assert.equal(model.mainResponseFormat.meta.default, 'json-object')
  assert.equal(model.mainStreamingMode.meta.default, 'off')
  assert.equal(model.vision.dict.mode.meta.default, 'native')
  assert.equal(model.vision.dict.detail.meta.default, 'auto')
  assert.equal(configuredProviders({ providers: [{ label: 'Vision', enabled: true, endpoint: 'https://example.test', model: 'vision', useForVision: true }] } as any)[0].useForVision, true)
})

test('Zhipu official provider mode supplies its fixed endpoint and stream-capable task roles', () => {
  const providers = configuredProviders({ mode: 'openai-compatible', providers: [{
    label: 'Zhipu', enabled: true, mode: 'zhipu-official', apiKey: 'test',
    model: 'glm-5.3-flash', reasoningEffort: 'high', useForMain: true,
  }] } as any)
  assert.equal(providers.length, 1)
  assert.equal(providers[0].endpoint, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
  assert.equal(providers[0].model, 'glm-5.3-flash')
  assert.equal(providers[0].zhipuOfficial, true)
  assert.equal(providers[0].useForEmbedding, false)
  assert.equal(ZHIPU_FIRST_VISIBLE_TOKEN_TIMEOUT, 45_000)
})

test('official provider presets resolve independent Chat Completions endpoints', () => {
  const providers = configuredProviders({ mode: 'openai-compatible', providers: [
    { label: 'OpenAI', enabled: true, mode: 'openai-official', apiKey: 'x', model: 'gpt-5-mini' },
    { label: 'DeepSeek', enabled: true, mode: 'deepseek-official', apiKey: 'x', model: 'deepseek-chat' },
    { label: 'Moonshot', enabled: true, mode: 'moonshot-official', apiKey: 'x', model: 'kimi-k2.5' },
    { label: 'DashScope', enabled: true, mode: 'dashscope-official', apiKey: 'x', model: 'qwen-plus', dashscopeRegion: 'singapore' },
    { label: 'SiliconFlow', enabled: true, mode: 'siliconflow-official', apiKey: 'x', model: 'Qwen/Qwen3-8B' },
    { label: 'OpenRouter', enabled: true, mode: 'openrouter', apiKey: 'x', model: 'openai/gpt-5-mini' },
    { label: 'Gemini', enabled: true, mode: 'gemini-openai', apiKey: 'x', model: 'gemini-2.5-flash' },
  ] } as any)
  assert.deepEqual(providers.map(item => item.endpoint), [
    'https://api.openai.com/v1/chat/completions',
    'https://api.deepseek.com/v1/chat/completions',
    'https://api.moonshot.cn/v1/chat/completions',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    'https://api.siliconflow.cn/v1/chat/completions',
    'https://openrouter.ai/api/v1/chat/completions',
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  ])
})

test('DeepSeek official provider exposes independent thinking controls', () => {
  const [provider] = configuredProviders({ mode: 'openai-compatible', providers: [{
    label: 'DeepSeek', enabled: true, mode: 'deepseek-official', apiKey: 'x', model: 'deepseek-chat', useForMain: true,
  }] } as any)
  assert.equal(provider.deepseekOfficial, true)
  assert.equal(provider.deepseekThinking, 'disabled')
  assert.equal(provider.deepseekReasoningEffort, 'low')
})

test('Agency Window exposes only the four bounded scheduling controls', () => {
  const agency = Config.dict.agency.dict
  assert.deepEqual(Object.keys(agency), [
    'enabled', 'maxWindowMinutes', 'minimumProactiveIntervalMinutes', 'maxCandidateHours',
  ])
  assert.equal(agency.enabled.meta.default, true)
  assert.equal(agency.maxWindowMinutes.meta.default, 240)
})

test('Schedule Preplan is lightweight, enabled by default and reuses the compaction provider', () => {
  const schedule = Config.dict.schedulePreplan.dict
  assert.deepEqual(Object.keys(schedule), ['enabled', 'horizonDays', 'variationLevel', 'candidateActivationProbability', 'candidateRevealMinutes', 'reviewAfterLocalHour', 'anchorAutoAdvance'])
  assert.equal(schedule.enabled.meta.default, true)
  assert.equal(schedule.horizonDays.meta.default, 14)
  assert.equal(schedule.variationLevel.meta.default, 'stable')
  assert.equal('modelId' in schedule, false)
  assert.equal('providerId' in schedule, false)
})

test('real model turns require non-empty narrative prose before they can succeed', () => {
  assert.equal(hasRequiredNarrativeScript({ script: '主角收起手机，继续往前走。' }), true)
  assert.equal(hasRequiredNarrativeScript({ script: '   \n' }), false)
  assert.equal(hasRequiredNarrativeScript({ interaction: { seen: true, reply: { mode: 'none' } } }), false)
})

test('memory compaction defaults leave a slightly wider short-conversation buffer', () => {
  const memory = Config.dict.memory.dict
  assert.equal(memory.sceneEntryThreshold.meta.default, 16)
  assert.equal(memory.sceneCharacterThreshold.meta.default, 10_000)
})

test('recent context combines a fifty-entry floor with a one-hour raw-message window', () => {
  const runtime = Config.dict.runtime.dict
  assert.equal(runtime.contextEntryLimit.meta.default, 50)
  assert.equal(runtime.contextTimeWindowMinutes.meta.default, 60)
})

test('Console exposes a separate, optional protagonist perspective layer', () => {
  assert.equal(Config.dict.storyDefaults.dict.perspective.meta.default, '')
})

test('SnowLuma voice transcription remains an opt-in OneBot capability', () => {
  const voice = Config.dict.onebot.dict.voiceTranscription.dict
  assert.equal(voice.enabled.meta.default, false)
  assert.equal(voice.timeoutMs.meta.default, 20_000)
})

test('group willingness is opt-in and remains scoped to each group rule', () => {
  const willingness = Config.dict.onebot.dict.groupChats.inner.dict.willingness.dict
  assert.equal(willingness.enabled.meta.default, false)
  assert.equal(willingness.decayHalfLifeSeconds.meta.default, 180)
  assert.equal(willingness.threshold.meta.default, 0.24)
})

test('group transport accepts its explicit field and the legacy immediate interaction fallback', () => {
  assert.equal(normalizeGroupVisibleReply({ mode: 'immediate', content: '群内回复' }, undefined, 100), '群内回复')
  assert.equal(normalizeGroupVisibleReply(undefined, { seen: true, reply: { mode: 'immediate', content: '兼容回复' } }, 100), '兼容回复')
  assert.equal(normalizeGroupVisibleReply(undefined, { seen: true, reply: { mode: 'none' } }, 100), '')
  assert.equal(normalizeGroupVisibleReply({ mode: 'immediate', content: '[表情]' }, undefined, 100), '')
})

test('reply-mode logs distinguish missing live replies from normal background silence', () => {
  assert.equal(visibleReplyMode({}, 'user-message'), '未提供或无效')
  assert.equal(visibleReplyMode({}, 'conversation-follow-up'), '无可见投递')
  assert.equal(visibleReplyMode({}, 'advance'), '无可见投递')
  assert.equal(visibleReplyMode({ crossConversationActions: [{ participantId: 'friend', mode: 'immediate', content: '在吗' }] }, 'advance'), '主动联系')
  assert.equal(visibleReplyMode({ interaction: { seen: true, reply: { mode: 'none' } } }, 'intent-due'), 'none')
})
