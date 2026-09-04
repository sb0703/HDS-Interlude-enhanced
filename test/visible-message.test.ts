import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGroupVisibleReply, InterludeService } from '../src/service'
import { normalizeMessageSeparators } from '../src/visible-message'

test('visible message separators normalize ASCII, full-width, case and spacing variants', () => {
  const source = '一<sep/>二<sep>三<sep />四< SEP / >五＜sep＞六＜ SeP /＞七'
  assert.equal(normalizeMessageSeparators(source), '一<sep/>二<sep/>三<sep/>四<sep/>五<sep/>六<sep/>七')
  assert.equal(normalizeMessageSeparators(source, '|||'), '一|||二|||三|||四|||五|||六|||七')
})

test('private splitting and group reply normalization use the configured separator', () => {
  const split = (InterludeService.prototype as any).splitOutgoingMessage
  const service = { config: { runtime: { splitReplyMessages: true, messageSeparator: '|||' } } }
  assert.deepEqual(split.call(service, '第一句<SEP>第二句＜sep /＞第三句'), ['第一句', '第二句', '第三句'])
  assert.equal(normalizeGroupVisibleReply({ mode: 'immediate', content: '甲＜SEP＞乙' } as any, undefined, 100, '|||'), '甲|||乙')
})
