import assert from 'node:assert/strict'
import test from 'node:test'
import { narrativeAutomaticSceneLoop, narrativeClockConflict, narrativeHasProgression, narrativeRecoveryStillSimilar, narrativeScheduleWindowConflict, narrativeSegmentOverlap, narrativeTextSimilarity, narrativeTimelinePlanConflict, normalizeNarrativeComparison } from '../src/service'
import { materializeSchedulePreplan } from '../src/schedule-preplan'
import { SchedulePreplanRecord, SchedulePreplanRegime } from '../src/types'

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

test('same-scene action changes are treated as progression', () => {
  const previous = '十一点五十三分，队伍又往前挪了一位，周川站在队尾等着叫号。'
  const current = '十一点五十四分，轮到周川取餐，他接过餐盘后走到靠窗的位置坐下。'
  assert.equal(narrativeHasProgression(current, previous), true)
  assert.equal(narrativeHasProgression(previous, previous), false)
})

test('a changed incoming quote does not count as scene progression', () => {
  const previous = '周川刚发完“渴得很”，手机还没放下，屏幕又亮了。他低头看了一眼，门锁着，继续想着抽屉里的东西。'
  const current = '周川刚发完“小骚货就小骚货吧”，手机还没放下，屏幕又亮了。他低头看了一眼，门锁着，继续想着抽屉里的东西。'
  assert.equal(narrativeHasProgression(current, previous), false)
  assert.ok(narrativeTextSimilarity(current, previous) >= 0.68)
})

test('repeated physical state remains repetition when the incoming message changes', () => {
  const previous = '周川盯着屏幕，手机刚亮了一下。他低头看了看，门锁着，身体仍保持原来的状态。他想起抽屉里的东西，拿起手机敲了几个字，又删掉。'
  const current = '周川刚发完另一句话，手机屏幕又亮了。他低头看了一眼，门锁着，身体还是原来的状态。他又想起抽屉里的东西，拿起手机敲了几个字，又删掉。'
  assert.equal(narrativeHasProgression(current, previous), false)
  const overlap = narrativeSegmentOverlap(current, previous)
  assert.ok(overlap.ratio >= 0.62)
  assert.ok(overlap.matchedSegments >= 2)
  assert.equal(narrativeRecoveryStillSimilar({
    coreSimilarity: 0.74,
    segmentOverlapRatio: overlap.ratio,
    segmentOverlapCount: overlap.matchedSegments,
  }), true)
})

test('a recovery draft must leave the old scene body instead of adding one small action', () => {
  assert.equal(narrativeRecoveryStillSimilar({
    coreSimilarity: 0.76,
    segmentOverlapRatio: 0.7,
    segmentOverlapCount: 3,
  }), true)
  assert.equal(narrativeRecoveryStillSimilar({
    coreSimilarity: 0.54,
    segmentOverlapRatio: 0.45,
    segmentOverlapCount: 1,
  }), false)
})

test('new messages do not justify replaying most of the unchanged scene', () => {
  const previous = '周川把手机放在桌上，屏幕亮着。他靠在椅背上，桌上的文件没有动。窗外的光已经偏西，走廊安静，门锁着。他低头看了看自己，衣服仍保持整齐。过了一会儿，他又拿起手机，敲了几个字，又删掉。'
  const current = '周川把手机放在桌上，屏幕亮着，两条新消息排在一起。他靠在椅背上，桌上的文件没有动。窗外的光已经偏西，走廊安静，门锁着。他低头看了看自己，衣服仍保持整齐。他拿起手机回复晚饭还没想好，又问对方吃了没有。'
  const overlap = narrativeSegmentOverlap(current, previous)
  assert.ok(overlap.ratio >= 0.7)
  assert.ok(overlap.matchedSegments >= 3)
  assert.ok(overlap.novelRatio <= 0.38)
  assert.equal(narrativeRecoveryStillSimilar({
    coreSimilarity: 0.65,
    segmentOverlapRatio: overlap.ratio,
    segmentOverlapCount: overlap.matchedSegments,
  }), true)
})

test('a compact new exchange with a real scene change is not partial replay', () => {
  const previous = '周川坐在办公室里看手机，桌上的文件没有动，走廊很安静。'
  const current = '周川回完晚饭消息，收起手机和文件，下楼离开办公楼，去街口买晚餐。'
  const overlap = narrativeSegmentOverlap(current, previous)
  assert.ok(overlap.ratio < 0.7 || overlap.matchedSegments < 3)
})

test('stale live clock text is rejected against the interval endpoint', () => {
  const from = new Date('2026-09-02T10:47:09.000Z')
  const now = new Date('2026-09-02T11:32:09.000Z')
  const conflict = narrativeClockConflict('他拿起手机，看了一眼屏幕上的时间，现在是18:47。并不算迟了，但他继续坐在椅子上。', from, now, 'Asia/Shanghai')
  assert.deepEqual(conflict && { observed: conflict.observed, expected: conflict.expected }, { observed: '18:47', expected: '19:32' })
})

test('explicit past clock references remain valid', () => {
  const from = new Date('2026-09-02T10:47:09.000Z')
  const now = new Date('2026-09-02T11:32:09.000Z')
  assert.equal(narrativeClockConflict('他回想起之前18:47时收到的那条消息。', from, now, 'Asia/Shanghai'), undefined)
})

test('automatic narration cannot finish a lifecycle beyond the host timeline ledger', () => {
  const plan = { beats: [{ at: 0.8, kind: 'activity' as const, summary: '在食堂窗口要了午饭，靠窗坐下开始吃饭' }] }
  const conflict = narrativeTimelinePlanConflict('他把最后一口饭吃完，端着餐盘离开食堂，回到办公室。', plan)
  assert.deepEqual(conflict && { lifecycle: conflict.lifecycle, observed: conflict.observed }, { lifecycle: '用餐', observed: '最后一口' })
  assert.equal(narrativeTimelinePlanConflict('他靠窗坐下，夹起一筷子菜，慢慢吃着。', plan), undefined)
})

test('a visible reply cannot claim a lifecycle completed beyond the host ledger', () => {
  const plan = { beats: [{ at: 0.4, kind: 'state' as const, summary: '靠窗坐下，开始吃午饭' }] }
  const conflict = narrativeTimelinePlanConflict('他低头看了一眼手机。', plan, { seen: true, reply: { mode: 'immediate', content: '吃完了。' } })
  assert.equal(conflict?.lifecycle, '用餐')
})

test('automatic narration rejects a short-window round trip across scenes', () => {
  const from = new Date('2026-09-02T12:57:34.000Z')
  const now = new Date('2026-09-02T13:37:34.000Z')
  const loop = narrativeAutomaticSceneLoop('他还在办公室，随后下楼进了地铁。到家后洗了澡，最后又赶回办公室继续坐下。', from, now)
  assert.deepEqual(loop && { locations: loop.locations, transitions: loop.transitions, elapsedMinutes: loop.elapsedMinutes, returnedToStart: loop.returnedToStart }, {
    locations: ['办公室', '通勤', '家中', '办公室'], transitions: 3, elapsedMinutes: 40, returnedToStart: true,
  })
})

test('one practical trip in a short automatic window stays valid', () => {
  const from = new Date('2026-09-02T12:57:34.000Z')
  const now = new Date('2026-09-02T13:37:34.000Z')
  assert.equal(narrativeAutomaticSceneLoop('他收好办公室的文件，乘地铁回到家中，准备吃晚饭。', from, now), undefined)
})

test('automatic narration cannot start a configured meal far beyond its routine window without an observed delay', () => {
  const regime: SchedulePreplanRegime = {
    id: 'weekday', label: '工作日', from: '2026-09-01',
    weekly: { thursday: [{ id: 'lunch', start: '12:00', end: '13:30', label: '午饭与中午缓冲', kind: 'routine' }] },
  }
  const now = new Date('2026-09-03T06:23:00.000Z') // 14:23 Asia/Shanghai
  const schedule: SchedulePreplanRecord = {
    storyId: 'story', revision: 1, timezone: 'Asia/Shanghai', validFrom: '2026-09-03', validThrough: '2026-09-03',
    lastReviewedLocalDate: '2026-09-03', lastEvidenceEntryId: 0, reviewReason: 'configured', regimes: [regime], exceptions: [],
    materializedDays: materializeSchedulePreplan([regime], [], '2026-09-03', 1), createdAt: now, updatedAt: now,
  }
  const conflict = narrativeScheduleWindowConflict('他在餐厅坐下，拿起筷子开始吃午饭。', schedule, now, 'Asia/Shanghai')
  assert.deepEqual(conflict && { routine: conflict.routine, lateByMinutes: conflict.lateByMinutes }, { routine: '午饭', lateByMinutes: 53 })
  assert.equal(narrativeScheduleWindowConflict('上午的会议拖延到刚结束，他才在餐厅坐下吃午饭。', schedule, now, 'Asia/Shanghai'), undefined)
})
