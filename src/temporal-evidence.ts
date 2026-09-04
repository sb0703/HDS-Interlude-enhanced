import { UserReportedTime } from './types'
import { storyLocalTimeContext } from './time'

/** Extract evidence, not a guessed daily routine. Ambiguous clocks stay ambiguous. */
export function extractUserReportedTimes(content: string, now: Date, timezone: string): UserReportedTime[] {
  const local = storyLocalTimeContext(now, timezone)
  const current = local.local.slice(0, 16)
  const results: UserReportedTime[] = []
  const pattern = /(?<![\d./:：])(\d{1,2})([:：.]|点)(\d{2}|半)?(?!\d)/gu
  for (const match of content.matchAll(pattern)) {
    const index = match.index!
    const before = content.slice(0, index).split(/[。！？!?;；\n]/u).at(-1) ?? ''
    const after = content.slice(index + match[0].length)
    // A decimal is not a clock merely because it has two decimal places.
    if (/^\s*(?:元|块|角|美元|人民币|%|％|公斤|千克|kg|米|厘米|cm|版本)/iu.test(after)) continue
    if (match[2] !== '点' && !match[3]) continue
    if (match[2] === '.' && !/(?:今天|昨天|明天|今晚|早上|上午|下午|晚上|凌晨|中午|时间|几点|从|到|约|在|我)\s*$/u.test(before)
      && !/^\s*(?:开始|结束|出发|到达|见|开会|吃|睡|起床)/u.test(after)) continue
    if (/\d{4}[-/.年]\s*$/u.test(before) || /^[-/.月]\d/u.test(after)) continue
    let hour = Number(match[1])
    const minute = match[3] === '半' ? 30 : Number(match[3] ?? 0)
    if (hour > 23 || minute > 59) continue
    const dayMatch = [...before.matchAll(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?|前天|昨天|今天|明天|后天|昨晚|今晚|明晚/gu)].at(-1)
    const period = [...before.matchAll(/凌晨|早上|上午|中午|下午|晚上|今晚|昨晚|明晚/gu)].at(-1)?.[0]
    let date = local.date
    if (dayMatch?.[1]) {
      date = `${dayMatch[1]}-${dayMatch[2].padStart(2, '0')}-${dayMatch[3].padStart(2, '0')}`
      const parsed = new Date(`${date}T00:00:00Z`)
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue
    } else if (dayMatch) {
      const offset: Record<string, number> = { 前天: -2, 昨天: -1, 昨晚: -1, 今天: 0, 今晚: 0, 明天: 1, 明晚: 1, 后天: 2 }
      const dateValue = new Date(`${local.date}T00:00:00Z`)
      dateValue.setUTCDate(dateValue.getUTCDate() + offset[dayMatch[0]])
      date = dateValue.toISOString().slice(0, 10)
    }
    const statement = content.slice(Math.max(0, index - 64), Math.min(content.length, index + match[0].length + 96)).trim()
    // Unsupported date frames and bare 12-hour readings are passed to semantic
    // interpretation with their source; never turn them into asserted timestamps.
    const unsupportedDate = /上周|下周|上个月|下个月|去年|明年|周[一二三四五六日天]|星期[一二三四五六日天]/u.test(before)
      || (!dayMatch && /\d{1,2}月\d{1,2}日/u.test(before))
    if (unsupportedDate) { results.push({ relation: 'ambiguous', statement }); continue }
    if (!period && hour > 0 && hour <= 12 && (match[2] !== ':' && match[2] !== '：' || match[1].length < 2)) {
      const alternatives = [hour % 12, hour % 12 + 12].map(value => `${date} ${String(value).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
      results.push({ relation: 'ambiguous', statement, alternatives })
      continue
    }
    if (/下午|晚上|今晚|昨晚|明晚/.test(period ?? '') && hour < 12) hour += 12
    if (period === '中午' && hour < 11) hour += 12
    if (period === '凌晨' && hour === 12) hour = 0
    const localTime = `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    results.push({ localTime, relation: localTime < current ? 'past' : localTime > current ? 'future' : 'current', statement })
  }
  return results.slice(0, 12)
}

/** A conservative clock signal. A live reading may occur anywhere in the
 * narrated interval; only an explicit endpoint claim means "now". */
export function narrativeClockConflict(script: string | undefined, from: Date, now: Date, timezone: string) {
  const text = (script ?? '').replace(/“[^”]*”|「[^」]*」|"[^"]*"/gu, '')
  const endpoint = storyLocalTimeContext(now, timezone)
  const start = storyLocalTimeContext(from, timezone)
  const expected = endpoint.time.slice(0, 5)
  for (const sentence of text.split(/[。！？!?;；\n]/u)) {
    if (/(昨天|明天|前天|后天|之前|刚才|先前|当时|那时|回忆|回想|记录|约在|预约|计划|将于|开始于|发生在)/u.test(sentence)) continue
    if (!/(手机|屏幕|手表|钟|现在|此刻|当前)/u.test(sentence)) continue
    for (const match of sentence.matchAll(/(?<!\d)(?:[01]?\d|2[0-3])[:：][0-5]\d(?!\d)/gu)) {
      const observed = match[0].replace('：', ':').padStart(5, '0')
      const explicitNow = /(?:现在|此刻|当前)(?:的时间)?(?:是|已是|已经是|为)?\s*[—:：]?\s*$/u.test(sentence.slice(0, match.index))
      const inInterval = (now.getTime() - from.getTime() >= 86_400_000)
        || (start.date === endpoint.date ? observed >= start.time.slice(0, 5) && observed <= expected
          : observed >= start.time.slice(0, 5) || observed <= expected)
      if (explicitNow ? observed === expected : inInterval) continue
      const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
      return { observed, expected, elapsedMinutes: minutes(expected) - minutes(observed), from: start.local, explicitNow }
    }
  }
  return undefined
}
