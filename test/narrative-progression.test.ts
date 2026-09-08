import assert from 'node:assert/strict'
import test from 'node:test'
import { narrativeSegmentOverlap, narrativeTextSimilarity, normalizeNarrativeComparison } from '../src/service'

test('narrative comparison ignores volatile clock details', () => {
  const first = '十点十分，行政楼的走廊安静得能听见空调出风口的低鸣。周川坐在办公桌前，翻看季度质量报告。'
  const second = '十点二十分，行政楼的走廊安静得能听见空调出风口的低鸣。周川坐在办公桌前，翻看季度质量报告。'
  assert.equal(normalizeNarrativeComparison(first), normalizeNarrativeComparison(second))
  assert.equal(narrativeTextSimilarity(first, second), 1)
})

test('narrative comparison keeps a concrete new event distinct', () => {
  const first = '周川坐在行政楼办公室里翻看季度质量报告。'
  const next = '周川合上报告，拿起手机走到楼下，在门口给同事发消息确认午餐地点。'
  assert.ok(narrativeTextSimilarity(first, next) < 0.72)
})

test('narrative comparison is stable for small wording changes', () => {
  const first = '他把红笔放在桌边，继续看着窗外的车流。'
  const next = '他把红笔放在桌边，仍看着窗外缓慢经过的车流。'
  const score = narrativeTextSimilarity(first, next)
  assert.ok(score >= 0.3 && score < 1)
})


test('a changed incoming quote does not count as scene progression', () => {
  const previous = '周川刚发完“渴得很”，手机还没放下，屏幕又亮了。他低头看了一眼，门锁着，继续想着抽屉里的东西。'
  const current = '周川刚发完“小骚货就小骚货吧”，手机还没放下，屏幕又亮了。他低头看了一眼，门锁着，继续想着抽屉里的东西。'
  assert.ok(narrativeTextSimilarity(current, previous) >= 0.68)
})

test('repeated physical state remains repetition when the incoming message changes', () => {
  const previous = '周川盯着屏幕，手机刚亮了一下。他低头看了看，门锁着，身体仍保持原来的状态。他想起抽屉里的东西，拿起手机敲了几个字，又删掉。'
  const current = '周川刚发完另一句话，手机屏幕又亮了。他低头看了一眼，门锁着，身体还是原来的状态。他又想起抽屉里的东西，拿起手机敲了几个字，又删掉。'
  const overlap = narrativeSegmentOverlap(current, previous)
  assert.ok(overlap.ratio >= 0.62)
  assert.ok(overlap.matchedSegments >= 2)
})


test('new messages do not justify replaying most of the unchanged scene', () => {
  const previous = '周川把手机放在桌上，屏幕亮着。他靠在椅背上，桌上的文件没有动。窗外的光已经偏西，走廊安静，门锁着。他低头看了看自己，衣服仍保持整齐。过了一会儿，他又拿起手机，敲了几个字，又删掉。'
  const current = '周川把手机放在桌上，屏幕亮着，两条新消息排在一起。他靠在椅背上，桌上的文件没有动。窗外的光已经偏西，走廊安静，门锁着。他低头看了看自己，衣服仍保持整齐。他拿起手机回复晚饭还没想好，又问对方吃了没有。'
  const overlap = narrativeSegmentOverlap(current, previous)
  assert.ok(overlap.ratio >= 0.7)
  assert.ok(overlap.matchedSegments >= 3)
  assert.ok(overlap.novelRatio <= 0.38)
})

test('a compact new exchange with a real scene change is not partial replay', () => {
  const previous = '周川坐在办公室里看手机，桌上的文件没有动，走廊很安静。'
  const current = '周川回完晚饭消息，收起手机和文件，下楼离开办公楼，去街口买晚餐。'
  const overlap = narrativeSegmentOverlap(current, previous)
  assert.ok(overlap.ratio < 0.7 || overlap.matchedSegments < 3)
})
